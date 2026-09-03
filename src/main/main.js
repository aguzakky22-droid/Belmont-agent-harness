'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');

const config = require('./config');
const providers = require('./providers');
const sessions = require('./sessions');
const telegram = require('./telegram');
const { createBridge } = require('./bridge');
const { Agent } = require('./agent');
const { t } = require('./i18n');
const claudeAuth = require('./claude-auth');
const mcp = require('./mcp');

/**
 * Kunci lokasi folder data.
 *
 * Tanpa ini, Electron menurunkannya dari nama aplikasi — sehingga versi yang
 * dipaketkan ("Belmont Tools") dan versi yang dijalankan lewat npm
 * ("belmont-tools") akan memakai dua folder berbeda, dan proyekmu seolah
 * hilang begitu berpindah di antara keduanya. Harus dipanggil sebelum app siap.
 */
app.setPath('userData', path.join(app.getPath('appData'), 'belmont-tools'));

let win = null;

/**
 * Proyek yang sedang DITAMPILKAN di jendela. Ini murni soal fokus tampilan
 * dan tujuan default pesan Telegram — bukan lagi penentu siapa yang boleh
 * berjalan. Beberapa proyek bisa bekerja bersamaan (lihat `runtimes`).
 */
let activeSessionId = null;

/**
 * Satu runtime per proyek: { id, agent, busy, tgTurn }.
 *
 * Dulu aplikasi ini hanya punya SATU instance Agent, sehingga berpindah proyek
 * berarti mereset agen itu — giliran yang sedang berjalan ikut mati. Sekarang
 * tiap proyek memegang agennya sendiri (riwayat, AbortController, dan sesi
 * Claude Code sendiri), jadi pindah proyek tidak menyentuh pekerjaan yang lain.
 */
const runtimes = new Map();

// id permintaan -> { resolve, tgMessageId, sessionId }
const pendingApprovals = new Map();

// id pertanyaan -> { resolve, sessionId }. Pertanyaan pilihan dari agen
// (tool AskUserQuestion) menunggu di sini sampai kamu menjawabnya.
const pendingQuestions = new Map();

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;

/**
 * Baca satu file lampiran. Gambar jadi base64; sisanya dicoba sebagai teks.
 * File biner selain gambar ditolak dengan pesan, bukan dikirim sebagai sampah.
 */
function readAttachment(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const base = { path: filePath, name };

  try {
    const stat = fs.statSync(filePath);

    if (IMAGE_TYPES[ext]) {
      if (stat.size > MAX_IMAGE_BYTES) {
        return { ...base, kind: 'image', error: `gambar terlalu besar (${Math.round(stat.size / 1024)} KB, batas 4 MB)` };
      }
      return {
        ...base,
        kind: 'image',
        mediaType: IMAGE_TYPES[ext],
        data: fs.readFileSync(filePath).toString('base64'),
      };
    }

    const buf = fs.readFileSync(filePath);
    // Byte NUL di awal file = hampir pasti biner.
    if (buf.subarray(0, 4096).includes(0)) {
      return { ...base, kind: 'binary', error: t('galat.biner') };
    }
    let text = buf.toString('utf8');
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS) + '\n\n[...dipotong]';
    }
    return { ...base, kind: 'text', text };
  } catch (err) {
    return { ...base, kind: 'error', error: err.message };
  }
}

// --- Runtime per proyek -------------------------------------------------

/** Kirim ke jendela kalau memang ada jendelanya. */
function toWin(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Beri tahu UI proyek mana saja yang sedang bekerja, untuk titik di sidebar. */
function broadcastBusy() {
  const aktif = [...runtimes.values()].filter((r) => r.busy);
  toWin('sessions:busy', {
    ids: aktif.map((r) => r.id),
    // Waktu mulai ikut dikirim supaya penghitung "Berjalan · Nd" di UI
    // menunjukkan umur giliran yang sebenarnya, bukan umur tampilannya.
    mulai: Object.fromEntries(aktif.map((r) => [r.id, r.mulai])),
  });
}

/** Tandai satu proyek mulai bekerja, sekaligus catat kapan gilirannya dimulai. */
function mulaiSibuk(rt) {
  rt.busy = true;
  rt.mulai = Date.now();
  broadcastBusy();
}

function selesaiSibuk(rt) {
  rt.busy = false;
  rt.mulai = 0;
  broadcastBusy();
}

// --- Antrean pesan ------------------------------------------------------
//
// Mengirim chat saat agen masih bekerja tidak lagi ditolak. Pesannya masuk
// antrean milik proyek itu, lalu:
//   - otomatis dikirim sebagai giliran baru begitu yang sekarang selesai, atau
//   - kalau kamu menekan "Kirim sekarang", diselipkan ke giliran yang sedang
//     berjalan tanpa menghentikannya (lihat Agent.inject).

function broadcastQueue(rt) {
  toWin('agent:queue', {
    sessionId: rt.id,
    items: rt.antre.map((it) => ({ id: it.id, text: it.text, jumlahLampiran: it.attachments.length })),
  });
}

function bikinAntrean(text, asal, attachments) {
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    asal: asal || 'desktop',
    attachments: attachments || [],
  };
}

function antrikan(rt, text, asal, attachments) {
  const item = bikinAntrean(text, asal, attachments);
  rt.antre.push(item);
  broadcastQueue(rt);
  return item;
}

/** Buang satu pesan dari antrean sebelum sempat terkirim. */
function batalAntrean(sessionId, itemId) {
  const rt = runtimes.get(sessionId);
  if (!rt) return false;
  const i = rt.antre.findIndex((it) => it.id === itemId);
  if (i === -1) return false;
  rt.antre.splice(i, 1);
  broadcastQueue(rt);
  return true;
}

/**
 * "Kirim sekarang": selipkan ke giliran yang sedang berjalan.
 *
 * Lampiran tidak bisa ikut di tengah giliran, jadi yang diteruskan adalah
 * path-nya — Claude Code membacanya sendiri, provider lain diberi tahu lokasinya.
 */
function kirimSekarang(sessionId, itemId) {
  const rt = runtimes.get(sessionId);
  if (!rt || !rt.busy) return false;
  const i = rt.antre.findIndex((it) => it.id === itemId);
  if (i === -1) return false;

  const item = rt.antre[i];
  const paths = item.attachments.map((a) => a.path).filter(Boolean);
  const teks = paths.length
    ? `${item.text}\n\nFile terlampir (baca dengan tool Read):\n${paths.map((p) => `- ${p}`).join('\n')}`
    : item.text;

  if (!rt.agent.inject(teks)) return false; // gilirannya keburu selesai
  rt.antre.splice(i, 1);
  broadcastQueue(rt);
  emitFor(rt, { type: 'queued_sent', id: item.id, text: item.text });
  return true;
}

/**
 * Setelah satu giliran selesai: pungut sisipan yang keburu ketinggalan, lalu
 * jalankan pesan antrean berikutnya.
 */
async function lanjutkanAntrean(rt) {
  // Kamu menekan "Kirim sekarang" tepat saat gilirannya berakhir — pesannya
  // tidak sempat terbaca, jadi kembalikan ke depan antrean.
  const sisa = rt.agent.ambilSisipanSisa();
  if (sisa.length) rt.antre.unshift(...sisa.map((teks) => bikinAntrean(teks, 'desktop', [])));

  const item = rt.antre.shift();
  broadcastQueue(rt);
  if (!item) return;
  // Gelembungnya digambar sekarang: giliran ini tidak kamu ketik barusan, jadi
  // tanpa ini pesannya muncul entah dari mana di tengah percakapan.
  emitFor(rt, { type: 'queued_sent', id: item.id, text: item.text });
  await runTurn(item.text, item.asal, item.attachments, rt.id);
}

/**
 * Ambil (atau buat) runtime milik satu proyek.
 *
 * Riwayat dimuat dari disk sekali saja, saat runtime dibuat. Sesudah itu
 * salinan di memori-lah yang berwenang — memuat ulang tiap kali proyek dibuka
 * akan membuang sesi Claude Code yang masih hangat tanpa alasan.
 */
function getRuntime(id) {
  if (!id) return null;
  const existing = runtimes.get(id);
  if (existing) return existing;

  const s = sessions.read(id);
  if (!s) return null;

  const rt = { id, agent: null, busy: false, mulai: 0, tgTurn: null, antre: [] };
  rt.agent = new Agent({
    emit: (event) => emitFor(rt, event),
    requestApproval: (payload) => requestApprovalFor(rt, payload),
    askQuestion: (payload) => askQuestionFor(rt, payload),
    persist: (messages, firstUserText, extra) => persistFor(id, messages, firstUserText, extra),
  });
  rt.agent.load(s.messages || [], s.approvedTools || []);
  runtimes.set(id, rt);
  return rt;
}

/**
 * Semua event dari agen dilabeli sessionId sebelum dikirim ke UI. Tanpa label
 * ini, giliran proyek latar akan menulis ke chat proyek yang sedang dibuka.
 */
function emitFor(rt, event) {
  // Simpan pemakaian token ke proyek pemiliknya, bukan ke "yang aktif".
  if (event.type === 'usage') sessions.save(rt.id, { lastUsage: event.usage });

  // Kumpulkan bahan laporan ke Telegram. Teks dikumpulkan, bukan dikirim per
  // potongan: Telegram membatasi laju pesan, dan notifikasi yang berdentang
  // puluhan kali per giliran tidak ada gunanya di HP.
  if (rt.tgTurn) {
    if (event.type === 'text') rt.tgTurn.teks.push(event.text);
    else if (event.type === 'tool_start') rt.tgTurn.tools.push(event.name);
    else if (event.type === 'error') rt.tgTurn.galat.push(event.message);
    else if (event.type === 'done') laporkanGiliran(rt);
  }

  toWin('agent:event', { ...event, sessionId: rt.id });
}

function requestApprovalFor(rt, payload) {
  return new Promise((resolve) => {
    const entry = { resolve, tgMessageId: null, sessionId: rt.id };
    pendingApprovals.set(payload.id, entry);
    toWin('agent:approval-request', { ...payload, sessionId: rt.id });
    kirimPersetujuanKeTelegram(payload, entry, rt);
  });
}

/**
 * Ajukan pertanyaan pilihan dari agen ke pengguna, dan tunggu jawabannya.
 *
 * Berbeda dari permintaan izin: tidak ada jalur "tolak otomatis" dan tidak ada
 * batas waktu. Agen HARUS menunggu — diam yang dianggap jawaban adalah persis
 * bug yang diperbaiki di sini.
 */
function askQuestionFor(rt, payload) {
  return new Promise((resolve) => {
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    pendingQuestions.set(id, { resolve, sessionId: rt.id });
    toWin('agent:question', { id, sessionId: rt.id, questions: payload.questions });

    // Di HP tidak ada UI-nya; beri tahu supaya kamu tidak menunggu sia-sia.
    if (bridge.isRunning()) {
      const s = sessions.read(rt.id);
      const nama = s ? ` [${sessions.judulSesi(s)}]` : '';
      bridge
        .kirim(
          `${t('bot.adaPertanyaan', { nama })}\n\n` +
            (payload.questions || []).map((q) => `• ${q.question}`).join('\n')
        )
        .catch(() => {});
    }
  });
}

/** Jawaban dari UI. `answers` null = ditutup tanpa menjawab. */
function resolveQuestion(id, answers) {
  const entry = pendingQuestions.get(id);
  if (!entry) return false;
  pendingQuestions.delete(id);
  entry.resolve(answers);
  return true;
}

/**
 * Tutup sesi Claude Code milik proyek yang ditinggal dan sedang menganggur.
 *
 * Proyek yang MASIH bekerja tidak disentuh — itu inti dari perbaikan ini.
 * Yang idle dilepas supaya tiap proyek yang pernah dibuka tidak menahan satu
 * subprocess CLI selamanya.
 */
function releaseIdleLive(rt) {
  if (!rt || rt.busy || rt.id === activeSessionId) return;
  // Masih ada pesan antrean yang sebentar lagi berangkat — membuang sesinya
  // sekarang berarti membuang prompt cache yang detik berikutnya dipakai lagi.
  if (rt.antre.length) return;
  rt.agent.closeLive();
}

// --- Jembatan Telegram --------------------------------------------------

const bridge = createBridge({
  onError: (pesan) => {
    if (win && !win.isDestroyed()) win.webContents.send('telegram:status', { error: pesan });
  },

  /** Pesan biasa dari HP = pesan pengguna untuk proyek yang sedang aktif. */
  onText: (text) => runTurn(text, 'telegram'),

  onProjects: async (argumen) => {
    const daftar = sessions.list();
    if (!daftar.length) return t('bot.belumAdaProyek');

    // "/proyek 2" = pindah ke nomor 2 pada daftar yang barusan ditampilkan.
    const nomor = parseInt(argumen, 10);
    if (nomor >= 1 && nomor <= daftar.length) {
      const target = daftar[nomor - 1];
      bukaSesi(target.id);
      // Desktop ikut berpindah, supaya kedua layar tidak menunjuk proyek beda.
      toWin('session:switched', { id: target.id });
      return t('bot.pindah', {
        judul: sessions.judulSesi(target),
        folder: target.workingDir || t('bot.defaultFolder'),
      });
    }

    return [
      t('bot.daftarJudul'),
      '',
      ...daftar.map((s, i) => {
        const rt = runtimes.get(s.id);
        // ● = sedang ditampilkan, ⏳ = sedang bekerja (bisa keduanya).
        const tanda = (s.id === activeSessionId ? '●' : ' ') + (rt && rt.busy ? '⏳' : ' ');
        return `${tanda} ${i + 1}. ${sessions.judulSesi(s)}`;
      }),
    ].join('\n');
  },

  onStatus: async () => {
    const s = activeSessionId ? sessions.read(activeSessionId) : null;
    if (!s) return t('bot.belumAdaAktif');
    const cfg = config.load();
    const rt = runtimes.get(activeSessionId);
    // Proyek lain bisa ikut bekerja di latar — sebutkan supaya tidak kaget.
    const lain = [...runtimes.values()].filter((r) => r.busy && r.id !== activeSessionId);
    const u = s.lastUsage;
    const konteks =
      u && u.contextWindow
        ? t('bot.sisaKonteks', {
            persen: Math.max(
              0,
              Math.round(
                (1 -
                  ((u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0)) / u.contextWindow) *
                  100
              )
            ),
          })
        : t('bot.belumTerukur');
    return [
      `${t('bot.statusProyek')}: ${sessions.judulSesi(s)}`,
      `${t('bot.statusFolder')}: ${s.workingDir || t('bot.defaultFolder')}`,
      `${t('bot.statusModel')}: ${cfg.model || 'default'} (${cfg.provider})`,
      `${t('bot.statusIzin')}: ${cfg.permissionMode}`,
      `${t('bot.statusKonteks')}: ${konteks}`,
      `${t('bot.statusStatus')}: ${rt && rt.busy ? t('bot.sedangBekerja') : t('bot.menganggur')}`,
      ...(lain.length
        ? [`${t('bot.statusLatar')}: ${t('bot.latarLain', { jumlah: lain.length })}`]
        : []),
    ].join('\n');
  },

  onStop: async () => {
    const rt = runtimes.get(activeSessionId);
    if (!rt || !rt.busy) return t('bot.takAdaBerjalan');
    rt.agent.stop();
    return t('bot.dihentikan');
  },

  onCompact: async () => {
    if (!activeSessionId) return bridge.kirim(t('bot.belumAdaAktif'));
    const rt = runtimes.get(activeSessionId);
    if (rt && rt.busy) return bridge.kirim(t('bot.masihBekerja'));
    await bridge.kirim(t('bot.meringkas'));
    await jalankanCompact(activeSessionId);
  },

  /** Tombol Izinkan / Tolak / Selalu dari HP. */
  onCallback: async (data, ctx) => {
    const [tag, id, keputusan] = String(data).split('|');
    if (tag !== 'ap') return;

    const label = { allow: 'Diizinkan', deny: 'Ditolak', always: 'Selalu diizinkan' }[keputusan];
    if (!resolveApproval(id, keputusan, 'telegram')) {
      await ctx.edit(t('bot.sudahDijawab'));
      return;
    }
    await ctx.edit(`${label} lewat Telegram.`);
  },
});

/** Jalankan compact pada satu proyek (dipakai dari IPC maupun Telegram). */
async function jalankanCompact(sessionId) {
  const rt = getRuntime(sessionId);
  if (!rt || rt.busy) return;

  const cfg = config.load();
  const session = sessions.read(sessionId);
  mulaiSibuk(rt);
  try {
    await rt.agent.compact({
      ...cfg,
      workingDir: (session && session.workingDir) || cfg.workingDir,
      resumeId: session ? session.resumeId : undefined,
    });
  } finally {
    selesaiSibuk(rt);
    releaseIdleLive(rt);
  }

  // Meringkas juga membuat proyek ini "sibuk", jadi pesan bisa menumpuk di
  // antrean selama itu. Tanpa baris ini pesannya menggantung selamanya.
  await lanjutkanAntrean(rt);
}

/**
 * Satu giliran agen, dari mana pun asalnya.
 *
 * `asal` menentukan ke mana hasilnya dilaporkan: giliran dari HP selalu
 * dibalas ke Telegram, sedangkan giliran dari desktop hanya dikirim kalau
 * kamu menyalakannya di Pengaturan.
 */
async function runTurn(text, asal, attachments, sessionId) {
  // Giliran dari desktop membawa id proyeknya sendiri; dari Telegram, tujuannya
  // adalah proyek yang sedang ditampilkan.
  const id = sessionId || activeSessionId;
  if (!id) {
    if (asal === 'telegram') {
      await bridge.kirim(t('bot.belumAdaAktifPilih'));
    }
    return;
  }

  const rt = getRuntime(id);
  if (!rt) return;

  // Antrean per proyek, bukan per aplikasi: proyek lain boleh jalan bersamaan.
  // Pesan yang datang selagi proyek ini sibuk tidak lagi ditolak — ia mengantre
  // dan berangkat sendiri setelah giliran sekarang selesai.
  if (rt.busy) {
    antrikan(rt, text, asal, attachments);
    if (asal === 'telegram') {
      await bridge.kirim(t('bot.diantrekan'));
    }
    return;
  }

  const cfg = config.load();
  const session = sessions.read(id);
  const workingDir = (session && session.workingDir) || cfg.workingDir;

  if (asal === 'telegram') {
    // Tampilkan juga di desktop, supaya kedua layar menunjukkan hal yang sama.
    toWin('agent:remote-user', { text, sessionId: id });
    await bridge.kirim('Diterima, sedang dikerjakan…');
  }

  rt.tgTurn = { asal, teks: [], tools: [], galat: [] };
  mulaiSibuk(rt);
  try {
    await rt.agent.send(
      text,
      { ...cfg, workingDir, resumeId: session ? session.resumeId : undefined },
      attachments
    );
  } finally {
    selesaiSibuk(rt);
    releaseIdleLive(rt);
  }

  // Di luar finally: kalau ada pesan antrean, ia menjadi giliran berikutnya.
  await lanjutkanAntrean(rt);
}

/** Susun dan kirim rangkuman giliran ke Telegram. */
async function laporkanGiliran(rt) {
  // Bukan `t`: nama itu milik fungsi penerjemah yang diimpor di berkas ini.
  const giliran = rt.tgTurn;
  rt.tgTurn = null;
  if (!giliran || !bridge.isRunning()) return;

  const kirimJugaDariDesktop = !!(config.load().telegram || {}).notifyDesktop;
  if (giliran.asal !== 'telegram' && !kirimJugaDariDesktop) return;

  // Beberapa proyek bisa selesai bergantian — sebut namanya kalau yang selesai
  // bukan proyek yang sedang kamu lihat, supaya laporannya tidak ambigu.
  let judul = '';
  if (rt.id !== activeSessionId) {
    const s = sessions.read(rt.id);
    if (s) judul = `[${sessions.judulSesi(s)}]`;
  }

  const bagian = [];
  const jawaban = giliran.teks.join('').trim();
  if (jawaban) bagian.push(jawaban);

  if (giliran.tools.length) {
    // Ringkas jadi "Read ×3, Bash" — daftar mentah 20 tool tidak terbaca di HP.
    const hitung = new Map();
    for (const n of giliran.tools) hitung.set(n, (hitung.get(n) || 0) + 1);
    const ringkas = [...hitung].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
    bagian.push(t('bot.langkahTool', { jumlah: giliran.tools.length, daftar: ringkas }));
  }
  for (const g of giliran.galat) bagian.push(`Error: ${g}`);

  if (!bagian.length) bagian.push(t('bot.selesaiTanpaTeks'));
  if (judul) bagian.unshift(judul);
  await bridge.kirim(bagian.join('\n\n'));
}

/**
 * Selesaikan satu permintaan persetujuan, dari sisi mana pun yang menjawab
 * lebih dulu. Sisi yang kalah cepat diberi tahu supaya tidak menggantung.
 */
function resolveApproval(id, decision, dari) {
  const entry = pendingApprovals.get(id);
  if (!entry) return false;
  pendingApprovals.delete(id);
  entry.resolve(decision);

  if (dari === 'telegram') {
    toWin('agent:approval-resolved', { id, decision, sessionId: entry.sessionId });
  } else if (entry.tgMessageId) {
    const cfg = config.load().telegram || {};
    telegram
      .editMessage(cfg.botToken, cfg.chatId, entry.tgMessageId, t('bot.sudahDijawabPendek'))
      .catch(() => {});
  }
  return true;
}

/** Simpan riwayat ke proyek pemiliknya; beri judul dari pesan pertama. */
function persistFor(sessionId, messages, firstUserText, extra) {
  if (!sessionId) return;
  const current = sessions.read(sessionId);
  const patch = { messages, ...(extra || {}) };
  const untitled = !current || sessions.belumBerjudul(current.title);
  if (firstUserText && untitled) patch.title = sessions.titleFromText(firstUserText);
  sessions.save(sessionId, patch);
  kabariSidebar();
}

/**
 * Beri tahu sidebar bahwa daftar proyek berubah — tapi tidak lebih sering dari
 * sekali per detik. Sejak kemajuan disimpan tiap langkah, sinyal ini bisa
 * datang berkali-kali dalam sedetik, dan tiap sinyal menggambar ulang seluruh
 * daftar (yang antara lain membatalkan ganti-nama yang sedang kamu ketik).
 */
let sidebarTimer = null;
function kabariSidebar() {
  if (sidebarTimer) return;
  sidebarTimer = setTimeout(() => {
    sidebarTimer = null;
    toWin('sessions:changed');
  }, 1000);
}

/**
 * Apakah jendela di koordinat ini masih terjangkau mouse?
 * Penting saat monitor kedua dicabut: koordinat yang tersimpan bisa menunjuk ke
 * layar yang sudah tidak ada, dan jendelanya muncul di luar area terlihat.
 */
function posisiTerlihat(x, y, width, height) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const potongX = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    const potongY = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
    // Sebagian kecil saja tidak cukup — bilah judulnya harus bisa diseret.
    return potongX >= 160 && potongY >= 80;
  });
}

/**
 * Ukuran DAN posisi jendela: pakai yang terakhir dipakai kalau ada, kalau tidak
 * ambil porsi besar dari area kerja layar. Default lama (1180px) terlalu sempit
 * di layar lebar — kolom chat jadi mengecil padahal ruangnya ada.
 */
function initialBounds() {
  const saved = config.load().windowBounds;

  if (saved && saved.width > 700 && saved.height > 500) {
    // Dibatasi terhadap layar tempat jendelanya terakhir berada, bukan layar
    // utama: kalau kamu memakainya di monitor kedua yang lebih besar,
    // mengukurnya dengan layar utama justru memaksanya mengecil.
    const layar = posisiTerlihat(saved.x, saved.y, saved.width, saved.height)
      ? screen.getDisplayMatching({
          x: saved.x,
          y: saved.y,
          width: saved.width,
          height: saved.height,
        })
      : screen.getPrimaryDisplay();
    const area = layar.workAreaSize;
    const width = Math.min(saved.width, area.width);
    const height = Math.min(saved.height, area.height);

    return {
      width,
      height,
      // x/y hanya dipakai kalau masih masuk akal; kalau tidak, dibiarkan
      // undefined supaya Electron menaruhnya di tengah seperti dulu.
      ...(posisiTerlihat(saved.x, saved.y, width, height)
        ? { x: saved.x, y: saved.y }
        : {}),
      maximize: !!saved.maximized,
    };
  }
  // Belum pernah dipakai: buka maximize. Menebak ukuran dalam piksel tidak
  // bisa diandalkan (area kerja versi Electron ≠ versi Windows saat DPI diskalakan).
  return { width: 1400, height: 900, maximize: true };
}

/**
 * Menu klik-kanan.
 *
 * Electron TIDAK punya menu konteks bawaan — menu Chromium yang biasa kamu lihat
 * di browser tidak ikut diteruskan. Tanpa handler ini, klik kanan di mana pun
 * tidak melakukan apa-apa, termasuk pada teks yang sudah disorot.
 *
 * Dipakai `role`, bukan clipboard.writeText(params.selectionText): role bekerja
 * pada elemen yang sedang fokus, jadi Potong/Tempel berperilaku benar di dalam
 * kolom ketik — sedangkan menulis manual ke clipboard tidak bisa menempel.
 *
 * editFlags datang dari Chromium dan sudah tahu apa yang mungkin saat itu
 * (mis. Tempel mati kalau clipboard kosong), jadi tidak perlu ditebak sendiri.
 */
function pasangMenuKlikKanan(w) {
  w.webContents.on('context-menu', (_e, params) => {
    const bendera = params.editFlags || {};
    let isi = [];

    if (params.isEditable) {
      isi = [
        { label: t('menu.potong'), role: 'cut', enabled: !!bendera.canCut },
        { label: t('menu.salin'), role: 'copy', enabled: !!bendera.canCopy },
        { label: t('menu.tempel'), role: 'paste', enabled: !!bendera.canPaste },
        { type: 'separator' },
        { label: t('menu.pilihSemua'), role: 'selectAll', enabled: bendera.canSelectAll !== false },
      ];
    } else if (String(params.selectionText || '').trim()) {
      isi = [{ label: t('menu.salin'), role: 'copy' }];
    }

    // Klik kanan di ruang kosong tanpa seleksi: jangan munculkan menu kosong.
    if (!isi.length) return;
    Menu.buildFromTemplate(isi).popup({ window: w });
  });
}

function createWindow() {
  const bounds = initialBounds();

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#12141a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  if (bounds.maximize) win.maximize();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  pasangMenuKlikKanan(win);

  // Ingat ukuran, posisi, dan status maximize supaya jendelanya kembali ke
  // tempat yang sama saat aplikasi dibuka lagi.
  let saveTimer = null;
  const rememberSize = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    clearTimeout(saveTimer);
    const maximized = win.isMaximized();
    // getNormalBounds = ukuran/posisi sebelum di-maximize. Memakai getBounds()
    // saat jendela sedang maximize akan menyimpan koordinat layar penuh, jadi
    // saat di-restore nanti jendelanya tidak punya posisi asli untuk dituju.
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    saveTimer = setTimeout(
      () =>
        config.save({
          windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized },
        }),
      400
    );
  };
  win.on('resize', rememberSize);
  win.on('move', rememberSize);
  win.on('maximize', rememberSize);
  win.on('unmaximize', rememberSize);
  win.on('close', rememberSize);

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

/**
 * Tawarkan persetujuan tool lewat tombol di Telegram.
 *
 * Ini yang membuat mode Supervised tetap masuk akal saat kamu jauh dari PC:
 * tanpa ini, giliran akan menggantung sampai kamu kembali ke depan komputer.
 */
async function kirimPersetujuanKeTelegram(payload, entry, rt) {
  if (!bridge.isRunning()) return;

  // Sebut proyeknya kalau permintaannya datang dari proyek latar — di HP tidak
  // ada petunjuk lain soal siapa yang sedang minta izin.
  let asal = '';
  if (rt && rt.id !== activeSessionId) {
    const s = sessions.read(rt.id);
    if (s) asal = ` [${sessions.judulSesi(s)}]`;
  }

  const rinci = payload.input?.command || JSON.stringify(payload.input || {});
  const pesan = await bridge.kirim(
    `Minta izin menjalankan: ${payload.name}${asal}\n\n${String(rinci).slice(0, 900)}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Izinkan', callback_data: `ap|${payload.id}|allow` },
            { text: 'Tolak', callback_data: `ap|${payload.id}|deny` },
          ],
          [{ text: 'Selalu izinkan tool ini', callback_data: `ap|${payload.id}|always` }],
        ],
      },
    }
  );
  // Kalau sudah dijawab dari desktop selagi pesan ini terkirim, entry-nya
  // sudah dibuang — jangan hidupkan kembali.
  if (pesan && pendingApprovals.has(payload.id)) entry.tgMessageId = pesan.message_id;
}

app.whenReady().then(async () => {
  createWindow();
  sapuTempelanLama();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Nyalakan jembatan kalau kamu sudah mengaktifkannya. Kegagalan di sini
  // (token dicabut, tanpa internet) tidak boleh menghalangi aplikasi terbuka.
  const tgCfg = config.load().telegram || {};
  if (tgCfg.enabled && tgCfg.botToken && tgCfg.chatId) {
    const hasil = await bridge.start(tgCfg).catch((err) => ({ ok: false, reason: String(err) }));
    if (!hasil.ok && win && !win.isDestroyed()) {
      win.webContents.send('telegram:status', { error: `Telegram: ${hasil.reason}` });
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Long poll yang menggantung bisa menahan proses tetap hidup setelah jendela
// ditutup — hentikan jembatannya lebih dulu.
app.on('before-quit', () => {
  bridge.stop();
  // Sesi Claude Code yang masih hidup juga menahan proses — tutup semuanya.
  for (const rt of runtimes.values()) {
    rt.agent.stop();
    rt.agent.closeLive();
  }
  // Server MCP adalah proses anak — tanpa ini mereka jadi yatim dan tetap
  // berjalan setelah aplikasinya ditutup.
  mcp.stopAll();
  // Penulisan riwayat ditunda demi kelancaran; pastikan tidak ada yang hangus.
  sessions.flushAll();
});

// --- IPC ---------------------------------------------------------------

ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:save', (_e, patch) => config.save(patch));
ipcMain.handle('providers:list', () => providers.list());

// --- MCP ---------------------------------------------------------------
// Keadaan server dibaca dari mcp.js, bukan dari config: yang menarik justru
// selisih antara apa yang tercatat di pengaturan dan apa yang benar-benar hidup.
ipcMain.handle('mcp:status', () => mcp.status());
ipcMain.handle('mcp:connect', async (_e, id) => mcp.sambungkan(id));
ipcMain.handle('mcp:disconnect', (_e, id) => {
  mcp.putuskan(id);
  return true;
});

/**
 * Rebut kembali fokus keyboard untuk jendela ini.
 *
 * Di Windows, popup <select> digambar sebagai menu asli sistem. Kadang menu itu
 * menutup tanpa mengembalikan fokus keyboard ke jendela, sehingga mouse tetap
 * bekerja tapi tidak ada tombol yang sampai ke halaman. Ini tidak bisa
 * diperbaiki dari renderer: focus() di dalam halaman hanya memindahkan fokus DI
 * DALAM dokumen yang jendelanya sendiri sedang tidak dianggap aktif oleh
 * Windows. blur() lalu focus() di sisi main meniru persis trik yang kamu
 * temukan — klik desktop, lalu kembali ke aplikasi.
 */
ipcMain.handle('window:refocus', () => {
  if (!win || win.isDestroyed()) return;
  win.blur();
  win.focus();
  win.webContents.focus();
});

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

/** Pilih file untuk dilampirkan, lalu baca isinya di sini (renderer tanpa akses fs). */
ipcMain.handle('dialog:pickFiles', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: t('dialog.pilihFile'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Teks & kode', extensions: ['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'csv', 'yml', 'yaml'] },
      { name: 'Semua file', extensions: ['*'] },
    ],
  });
  if (res.canceled) return [];
  return res.filePaths.map(readAttachment);
});

/** Baca file yang dijatuhkan (drag-and-drop) — renderer tidak punya akses fs. */
ipcMain.handle('files:read', (_e, paths) =>
  (Array.isArray(paths) ? paths : []).map(readAttachment)
);

/**
 * Gambar yang ditempel (Ctrl+V) disimpan dulu sebagai file sungguhan.
 *
 * Bukan sekadar kerapian: provider Claude Code tidak menerima base64 — ia
 * diberi PATH lalu membaca sendiri dengan tool Read. Tanpa file nyata,
 * tempelan akan hilang diam-diam di provider itu.
 */
ipcMain.handle('files:paste', (_e, { mediaType, bytes }) => {
  const ext = Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k] === mediaType);
  if (!ext) {
    return { name: 'tempelan', kind: 'error', error: t('galat.formatTempelan', { mediaType }) };
  }

  const buf = Buffer.from(bytes);
  if (buf.length > MAX_IMAGE_BYTES) {
    return {
      name: 'tempelan',
      kind: 'image',
      error: `gambar terlalu besar (${Math.round(buf.length / 1024)} KB, batas 4 MB)`,
    };
  }

  try {
    const dir = path.join(app.getPath('temp'), 'belmont-tools-tempelan');
    fs.mkdirSync(dir, { recursive: true });
    const cap = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = path.join(dir, `tempelan-${cap}-${Math.random().toString(36).slice(2, 6)}${ext}`);
    fs.writeFileSync(file, buf);
    return readAttachment(file);
  } catch (err) {
    return { name: 'tempelan', kind: 'error', error: err.message };
  }
});

/**
 * Buang tempelan lama. Filenya cuma perlu hidup selama percakapannya masih
 * berjalan; menyimpannya selamanya membuat folder temp tumbuh tanpa batas.
 */
function sapuTempelanLama() {
  const dir = path.join(app.getPath('temp'), 'belmont-tools-tempelan');
  const batas = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        if (fs.statSync(p).mtimeMs < batas) fs.unlinkSync(p);
      } catch {
        /* file sedang dipakai atau sudah hilang — abaikan */
      }
    }
  } catch {
    /* folder belum pernah dibuat */
  }
}

ipcMain.handle('providers:fetchModels', async (_e, providerId) => {
  const provider = providers.get(providerId);
  if (!provider.fetchModels) {
    throw new Error(t('galat.tanpaDaftarModel', { provider: provider.label }));
  }
  const cfg = config.load();
  const apiKey = provider.keyField ? (cfg.keys || {})[provider.keyField] : null;
  // keyOpsional: endpoint custom boleh tanpa key — "Muat ulang" tetap jalan,
  // karena /models di server lokal memang terbuka.
  if (provider.keyField && !provider.keyOpsional && !apiKey) {
    throw new Error(t('galat.isiKeyDulu'));
  }

  const models = await provider.fetchModels(apiKey);
  config.save({ modelCache: { [providerId]: models } });
  return models;
});

// --- Telegram ---

/** Tebak Chat ID dari pesan terakhir yang dikirim ke bot. */
ipcMain.handle('telegram:detect', async (_e, token) => telegram.detectChatId(token));

/** Uji sungguhan: kirim satu pesan, supaya ketahuan sekarang kalau salah. */
ipcMain.handle('telegram:test', async (_e, { token, chatId }) => {
  const bot = await telegram.test(token, chatId);
  return { username: bot.username, name: bot.name };
});

// --- Login Claude Code ---

ipcMain.handle('claude:authStatus', () => claudeAuth.status());

ipcMain.handle('claude:login', () =>
  claudeAuth.mulaiLogin((payload) => toWin('claude:login-event', payload))
);

ipcMain.handle('claude:loginInput', (_e, teks) => claudeAuth.kirimKeLogin(teks));
ipcMain.handle('claude:loginCancel', () => claudeAuth.batalkanLogin());
ipcMain.handle('claude:logout', () => claudeAuth.logout());

// --- Sesi ---

ipcMain.handle('sessions:list', () => ({
  sessions: sessions.list(),
  activeId: activeSessionId,
  // Proyek yang sedang bekerja, supaya sidebar bisa menandainya.
  busyIds: [...runtimes.values()].filter((r) => r.busy).map((r) => r.id),
  busyStarts: Object.fromEntries(
    [...runtimes.values()].filter((r) => r.busy).map((r) => [r.id, r.mulai])
  ),
}));

// Tiap proyek dikunci ke satu folder — dipilih saat dibuat, dan itu yang
// membatasi semua akses file agen selama sesi tersebut.
// `folder` opsional. Kalau diisi, dialognya dilewati — dipakai tombol "+" di
// tiap kelompok sidebar untuk membuat sesi kedua di folder yang sudah dibuka.
// Beberapa sesi boleh berbagi satu folder; masing-masing punya riwayat,
// antrean, dan sesi Claude Code sendiri.
ipcMain.handle('sessions:create', async (_e, folder) => {
  let dir = typeof folder === 'string' ? folder.trim() : '';

  // Folder yang dikirim renderer tetap diperiksa. Ia berasal dari sesi yang ada,
  // tapi sesi itu bisa saja menunjuk folder yang sudah dihapus atau dipindah —
  // dan kalau dibiarkan, sesi barunya lahir menunjuk tempat yang tidak ada.
  if (dir && !fs.existsSync(dir)) dir = '';

  if (!dir) {
    const res = await dialog.showOpenDialog(win, {
      title: t('dialog.pilihFolder'),
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: config.load().workingDir,
      buttonLabel: t('dialog.pakaiFolder'),
    });
    if (res.canceled) return null;
    dir = res.filePaths[0];
  }

  // Proyek baru TIDAK menghentikan yang lain — cuma memindahkan fokus.
  const s = sessions.create({ workingDir: dir });
  pindahFokus(s.id);
  getRuntime(s.id);
  return { id: s.id, title: s.title, workingDir: s.workingDir, messages: [], busy: false };
});

/**
 * Pindahkan fokus tampilan ke satu proyek, dan lepaskan sesi Claude Code milik
 * proyek yang ditinggal kalau proyek itu sedang menganggur.
 */
function pindahFokus(id) {
  const sebelumnya = activeSessionId;
  activeSessionId = id;
  if (sebelumnya && sebelumnya !== id) releaseIdleLive(runtimes.get(sebelumnya));
}

/**
 * Jadikan satu proyek sebagai proyek yang ditampilkan. Dipakai IPC maupun
 * Telegram — karena itu dipisah dari handler-nya.
 *
 * Perhatikan: tidak ada `agent.stop()` di sini. Dulu ada, dan itulah sebabnya
 * pindah proyek membunuh giliran yang sedang berjalan.
 */
function bukaSesi(id) {
  const s = sessions.read(id);
  if (!s) return null;
  pindahFokus(s.id);
  getRuntime(s.id);
  return s;
}

ipcMain.handle('sessions:open', (_e, id) => {
  const s = bukaSesi(id);
  if (!s) return null;
  const rt = runtimes.get(id);
  return {
    id: s.id,
    title: s.title,
    workingDir: s.workingDir || config.load().workingDir,
    // Termasuk kemajuan giliran yang masih berjalan, supaya proyek latar tidak
    // tampak berhenti di posisi sebelum gilirannya dimulai.
    messages: (rt && rt.agent.viewMessages()) || s.messages || [],
    lastUsage: s.lastUsage || null,
    busy: !!(rt && rt.busy),
    // Kapan gilirannya dimulai — penghitung waktu di UI melanjutkan dari sini
    // alih-alih mulai dari nol tiap kali proyeknya dibuka lagi.
    mulai: (rt && rt.busy && rt.mulai) || 0,
  };
});

/**
 * Riwayat terkini satu proyek, tanpa memindahkan fokus.
 *
 * Dipakai UI untuk menyusun ulang layar setelah kembali ke proyek yang sedang
 * bekerja: potongan pesan yang terlanjur mengalir saat kamu tidak melihat tidak
 * bisa direkonstruksi dari aliran event, tapi bisa diambil utuh dari sini.
 */
ipcMain.handle('sessions:history', (_e, id) => {
  const rt = runtimes.get(id);
  if (rt) return rt.agent.viewMessages();
  const s = sessions.read(id);
  return (s && s.messages) || [];
});

/** Ganti folder proyek yang sedang terbuka. */
ipcMain.handle('sessions:setFolder', async (_e, id) => {
  const current = sessions.read(id);
  if (!current) return null;
  const res = await dialog.showOpenDialog(win, {
    title: t('dialog.gantiFolder'),
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current.workingDir || config.load().workingDir,
    buttonLabel: t('dialog.pakaiFolder'),
  });
  if (res.canceled) return null;
  const updated = sessions.save(id, { workingDir: res.filePaths[0] });
  return updated ? updated.workingDir : null;
});

ipcMain.handle('sessions:rename', (_e, { id, title }) => sessions.rename(id, title));

ipcMain.handle('sessions:delete', (_e, id) => {
  // Hanya runtime proyek ini yang dibongkar; yang lain tetap bekerja.
  const rt = runtimes.get(id);
  if (rt) {
    rt.agent.stop();
    rt.agent.closeLive();
    runtimes.delete(id);
  }
  // Permintaan izin yang menggantung milik proyek ini ikut dibatalkan, kalau
  // tidak, promise-nya tidak pernah selesai.
  for (const [pid, entry] of [...pendingApprovals]) {
    if (entry.sessionId === id) {
      pendingApprovals.delete(pid);
      entry.resolve('deny');
    }
  }
  for (const [qid, entry] of [...pendingQuestions]) {
    if (entry.sessionId === id) {
      pendingQuestions.delete(qid);
      entry.resolve(null);
    }
  }

  sessions.remove(id);
  if (activeSessionId === id) activeSessionId = null;
  broadcastBusy();
  return sessions.list();
});

// --- Agen ---

ipcMain.handle('agent:send', async (_e, { sessionId, text, attachments }) =>
  runTurn(text, 'desktop', attachments, sessionId)
);

/** Ringkas percakapan satu proyek supaya konteksnya mengecil. */
ipcMain.handle('agent:compact', async (_e, sessionId) => {
  const id = sessionId || activeSessionId;
  if (!id) return;
  await jalankanCompact(id);
});

ipcMain.handle('agent:stop', (_e, sessionId) => {
  const rt = runtimes.get(sessionId || activeSessionId);
  if (!rt) return;
  // Antrean ikut dikosongkan. Kalau tidak, menekan Stop justru langsung
  // menyalakan giliran berikutnya — kebalikan dari yang kamu maksud.
  rt.antre = [];
  broadcastQueue(rt);
  rt.agent.stop();
});

/** Isi antrean satu proyek — dipakai UI saat proyeknya dibuka kembali. */
ipcMain.handle('agent:queue-list', (_e, sessionId) => {
  const rt = runtimes.get(sessionId);
  if (!rt) return [];
  return rt.antre.map((it) => ({
    id: it.id,
    text: it.text,
    jumlahLampiran: it.attachments.length,
  }));
});

ipcMain.handle('agent:queue-now', (_e, { sessionId, itemId }) =>
  kirimSekarang(sessionId, itemId)
);

ipcMain.handle('agent:queue-cancel', (_e, { sessionId, itemId }) =>
  batalAntrean(sessionId, itemId)
);

ipcMain.handle('agent:approve', (_e, { id, decision }) =>
  resolveApproval(id, decision, 'desktop')
);

/** Jawaban pertanyaan pilihan; `answers` null berarti ditutup tanpa menjawab. */
ipcMain.handle('agent:answer', (_e, { id, answers }) => resolveQuestion(id, answers));

// --- Kendali jembatan Telegram ---

ipcMain.handle('telegram:start', async () => {
  const hasil = await bridge.start(config.load().telegram);
  return { ...hasil, running: bridge.isRunning() };
});

ipcMain.handle('telegram:stop', async () => {
  await bridge.stop();
  return { running: false };
});

ipcMain.handle('telegram:state', () => ({ running: bridge.isRunning() }));
