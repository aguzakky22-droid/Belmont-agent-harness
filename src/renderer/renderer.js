'use strict';

const $ = (id) => document.getElementById(id);

let cfg = null;
let providerList = [];
let busy = false; // apakah proyek yang SEDANG DILIHAT sibuk

// Proyek lain boleh bekerja di latar. Kita cuma perlu tahu id-nya, untuk
// menyalakan titik "berjalan" di sidebar.
let busyIds = new Set();

// Kapan giliran tiap proyek dimulai (id -> epoch ms), menurut main process.
// Penghitung "Berjalan · Nd" membaca dari sini, bukan dari saat penandanya
// digambar — kalau tidak, pindah proyek lalu kembali akan mereset detiknya
// ke nol padahal gilirannya sudah jalan lama.
let busyStarts = {};
let runningSince = 0;

// Ketikan yang belum dikirim, per proyek. Kolom chat cuma ada satu di layar,
// jadi tanpa ini draf satu proyek ikut terbawa ke semua proyek lain.
const drafts = new Map(); // sessionId -> { text, attachments }

// Pesan yang sudah dikirim tapi menunggu giliran sekarang selesai. Sumber
// kebenarannya di main process — ini cuma salinan untuk digambar.
let queueItems = []; // milik proyek yang sedang dibuka saja

// Permintaan izin tool yang datang dari proyek yang tidak sedang dibuka
// ditahan di sini, lalu dimunculkan saat proyeknya dibuka. Kalau modalnya
// langsung dipaksa muncul, kamu akan diminta menyetujui perintah untuk proyek
// yang tidak sedang kamu lihat — itu justru berbahaya.
const approvalQueue = new Map(); // sessionId -> payload[]
let shownApprovalId = null;      // permintaan yang modalnya sedang terbuka

// Pertanyaan pilihan dari agen (tool AskUserQuestion) yang belum dijawab,
// per proyek. Disimpan supaya kartunya bisa digambar ulang setelah pindah
// proyek — kalau tidak, agen menunggu jawaban yang kartunya sudah lenyap.
const questionQueue = new Map(); // sessionId -> payload[]

// Ditandai saat kamu membuka proyek yang sedang bekerja: pesan asisten yang
// sedang mengalir hanya tergambar sebagian, jadi layarnya perlu disusun ulang
// begitu pesan itu selesai.
let needsResync = false;

let currentBubble = null;   // gelembung teks asisten yang sedang diisi
let currentThinking = null; // blok thinking yang sedang diisi
const toolCards = new Map();
const hiddenTools = new Set(); // id tool yang sengaja tidak digambar
let currentToolGroup = null; // grup kartu tool yang sedang terkumpul
let runningRow = null;       // penanda "masih berjalan" di dasar chat
let runningTimer = null;

// --- Init --------------------------------------------------------------

let activeSessionId = null;
let activeWorkingDir = '';
let activeTitle = '';
let pendingAttachments = [];
// Folder yang kelompoknya sedang dilipat di sidebar, disimpan huruf kecil.
// Sengaja hanya di memori: ini bacaan sesaat, bukan preferensi yang layak
// ikut tersimpan dan terbawa ke PC lain.
const lipatan = new Set();

/**
 * Satu ikon dari sprite <symbol> di index.html.
 *
 * createElementNS wajib: SVG hidup di namespace lain, dan elemen yang dibuat
 * lewat createElement biasa akan tampil kosong tanpa pesan galat apa pun.
 * Begitu juga setAttribute('class') — properti .className pada elemen SVG
 * bertipe SVGAnimatedString dan tidak bisa ditimpa dengan string.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
function ikon(nama, kelas) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', kelas ? `ikon ${kelas}` : 'ikon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${nama}`);
  svg.append(use);
  return svg;
}

/**
 * Tema yang bisa dipilih di Pengaturan.
 *
 * `id` harus cocok dengan html[data-theme='...'] di theme.css. `contoh` cuma
 * untuk kotak kecil di kartu pilihan — sengaja ditulis ulang di sini alih-alih
 * dibaca dari CSS, karena membaca variabel tema yang BELUM aktif berarti harus
 * menempelkan elemen tersembunyi per tema hanya untuk mengintip warnanya.
 * Empat warna: latar, panel, aksen, teks.
 */
const TEMA = [
  { id: 'catppuccin', nama: 'Catppuccin', contoh: ['#1e1e2e', '#313244', '#cba6f7', '#cdd6f4'] },
  { id: 'tokyo-night', nama: 'Tokyo Night', contoh: ['#1a1b26', '#292e42', '#7aa2f7', '#c0caf5'] },
  { id: 'rose-pine', nama: 'Rosé Pine', contoh: ['#191724', '#26233a', '#c4a7e7', '#e0def4'] },
  { id: 'nord', nama: 'Nord', contoh: ['#2e3440', '#3b4252', '#88c0d0', '#eceff4'] },
  { id: 'gruvbox', nama: 'Gruvbox', contoh: ['#282828', '#3c3836', '#fabd2f', '#ebdbb2'] },
  { id: 'dracula', nama: 'Dracula', contoh: ['#282a36', '#343746', '#bd93f9', '#f8f8f2'] },
  { id: 'one-dark', nama: 'One Dark', contoh: ['#282c34', '#333842', '#61afef', '#c8ccd4'] },
  { id: 'terang', nama: 'Terang', contoh: ['#f7f8fa', '#ffffff', '#3b5bdb', '#1b1e26'] },
];

/** Tema & bahasa sebelum panel Pengaturan dibuka — untuk mengembalikan saat Batal. */
let temaSebelumnya = 'catppuccin';
let bahasaSebelumnya = 'id';

function terapkanTema(id) {
  const dipakai = TEMA.some((x) => x.id === id) ? id : 'catppuccin';
  document.documentElement.dataset.theme = dipakai;
}

// Label disimpan sebagai KUNCI, bukan teks jadi: objek ini dievaluasi saat
// berkas dimuat, jauh sebelum bahasa dibaca dari config.
const PERM_MODES = {
  supervised: { kunci: 'perm.supervised', ikon: 'shield' },
  acceptEdits: { kunci: 'perm.acceptEdits', ikon: 'file-text' },
  // Sengaja tetap emoji. Dua mode lain memang pantas jadi ikon garis yang
  // kalem, tapi mode ini mematikan semua rem — gembok kuning yang mencolok itu
  // justru gunanya, dan ikon monokrom malah menyamarkannya.
  full: { kunci: 'perm.full', emoji: '🔓' },
};

(async function init() {
  providerList = await window.api.listProviders();
  cfg = await window.api.getConfig();
  if (!cfg.model) cfg.model = providerOf(cfg.provider).defaultModel;

  // Sedini mungkin: sampai baris ini jalan, yang tampil adalah Catppuccin dari
  // :root. Jeda itu tak terlihat karena jendelanya baru diperlihatkan setelah
  // halaman siap, tapi urutannya tetap penting kalau nanti ada layar pembuka.
  terapkanTema(cfg.theme);
  setBahasa(cfg.language);
  terapkanBahasa();

  // wireEvents() lebih dulu: di situlah ketiga pemilih di bar komposer dibuat,
  // dan fillProviderSelects() serta syncHeader() langsung mengisinya.
  wireEvents();
  fillProviderSelects();
  syncHeader();
  autoGrow($('input'));

  const { sessions, activeId } = await window.api.listSessions();
  if (activeId) await openSession(activeId);
  else if (sessions.length) await openSession(sessions[0].id);
  else await refreshSessionList(); // biarkan kosong; user pilih folder sendiri lewat "+"
})();

function providerOf(id) {
  return providerList.find((p) => p.id === id) || providerList[0];
}

/** Nilai sementara di dropdown Pengaturan; bukan id provider sungguhan. */
const EP_BARU = '__endpoint_baru__';

/* ---------------------------------------------------------------------------
   Pemilih ala menu, pengganti <select>

   Popup <select> digambar Windows, bukan oleh halaman: latarnya putih walau
   temamu gelap, tidak bisa memuat keterangan, dan popup itulah yang dulu
   menahan fokus keyboard sampai jendelanya perlu di-blur paksa.

   Tiga pemilih di bar komposer memakai pabrik di bawah. Yang di panel
   Pengaturan tetap <select> — di sana popup putih tidak seberapa mengganggu,
   dan mengubahnya berarti menulis ulang alur simpan/batal.
--------------------------------------------------------------------------- */

/** Semua pemilih yang sudah dibuat, supaya bisa ditutup bersamaan. */
const pemilih = new Map();

/** Tingkat effort + keterangan singkatnya. Dulu cuma lima <option> tanpa
 *  penjelasan; menu HTML punya ruang untuk menerangkan bedanya.
 *  Fungsi, bukan konstanta: keterangannya ikut bahasa, dan bahasa baru
 *  diketahui setelah config dibaca. */
function effortOpsi() {
  return ['low', 'medium', 'high', 'xhigh', 'max'].map((v) => ({
    nilai: v,
    label: v === 'xhigh' ? 'XHigh' : v[0].toUpperCase() + v.slice(1),
    ket: t(`effort.${v}`),
  }));
}

// Dibuat sekali di init(), dipakai di seluruh berkas.
let pickProvider = null;
let pickModel = null;
let pickEffort = null;

/**
 * @param {string} idWadah  id elemen .picker
 * @param {(nilai: string) => void} saatPilih  dipanggil saat satu opsi dipilih
 */
function bikinPemilih(idWadah, saatPilih) {
  const wadah = $(idWadah);
  const tombol = wadah.querySelector('.picker-trigger');
  const label = wadah.querySelector('.picker-label');
  const menu = wadah.querySelector('.picker-menu');

  let opsi = [];
  let nilai = '';
  let mati = false;

  function gambar() {
    menu.replaceChildren();
    let grupTerakhir = null;

    for (const o of opsi) {
      // Judul grup hanya muncul kalau memang berganti — daftar tanpa grup
      // tidak menumbuhkan satu baris judul pun.
      if (o.grup && o.grup !== grupTerakhir) {
        menu.append(el('div', 'picker-group', o.grup));
        grupTerakhir = o.grup;
      }

      const baris = el('button', 'picker-option' + (o.nilai === nilai ? ' selected' : ''));
      baris.type = 'button';
      const teks = el('span', 'picker-text');
      teks.append(el('strong', '', o.label));
      if (o.ket) teks.append(el('small', '', o.ket));
      baris.append(teks);

      const centang = el('span', 'picker-check');
      if (o.nilai === nilai) centang.append(ikon('check'));
      baris.append(centang);

      baris.onclick = (e) => {
        e.stopPropagation();
        menu.hidden = true;
        if (o.nilai === nilai) return;
        nilai = o.nilai;
        sinkron();
        saatPilih(o.nilai);
      };
      menu.append(baris);
    }

    if (!opsi.length) menu.append(el('div', 'picker-empty', t('pick.kosong')));
  }

  function sinkron() {
    const aktif = opsi.find((o) => o.nilai === nilai);
    label.textContent = aktif ? aktif.label : '—';
    tombol.disabled = mati;
    wadah.classList.toggle('off', mati);
  }

  tombol.onclick = (e) => {
    e.stopPropagation();
    const mauBuka = menu.hidden;
    tutupSemuaPemilih();
    if (!mauBuka || mati) return;
    gambar();
    menu.hidden = false;
  };

  const api = {
    /** @param {{nilai:string,label:string,ket?:string,grup?:string}[]} daftar */
    isi(daftar, terpilih) {
      opsi = daftar;
      // Nilai yang tidak ada di daftar baru jatuh ke opsi pertama, bukan
      // dibiarkan menggantung menunjuk model yang sudah tidak ditawarkan.
      nilai = daftar.some((o) => o.nilai === terpilih)
        ? terpilih
        : daftar.length
          ? daftar[0].nilai
          : '';
      sinkron();
      return nilai;
    },
    nilai: () => nilai,
    /** Ganti yang terpilih tanpa menyentuh daftarnya. */
    pilih(v) {
      if (!opsi.some((o) => o.nilai === v)) return;
      nilai = v;
      sinkron();
    },
    setMati(v, judul) {
      mati = !!v;
      if (judul) tombol.title = judul;
      sinkron();
    },
    tutup() {
      menu.hidden = true;
    },
  };

  pemilih.set(idWadah, api);
  return api;
}

function tutupSemuaPemilih() {
  for (const p of pemilih.values()) p.tutup();
}

function fillProviderSelects() {
  const bawaan = providerList.filter((p) => !p.custom);
  const custom = providerList.filter((p) => p.custom);

  // Pemilih di bar komposer: satu daftar datar, grup hanya diberi label kalau
  // memang ada endpoint custom.
  pickProvider.isi(
    [
      ...bawaan.map((p) => ({
        nilai: p.id,
        label: p.label,
        grup: custom.length ? t('pick.bawaan') : '',
      })),
      ...custom.map((p) => ({
        nilai: p.id,
        label: p.label,
        ket: p.baseURL,
        grup: t('pick.custom'),
      })),
    ],
    cfg.provider
  );

  for (const sel of [$('s-provider')]) {
    sel.innerHTML = '';
    // Dikelompokkan hanya kalau memang ada endpoint custom — tanpa itu,
    // judul grup "Bawaan" cuma menambah baris yang tidak berguna.
    if (!custom.length) {
      for (const p of bawaan) sel.append(new Option(p.label, p.id));
    } else {
      const g1 = document.createElement('optgroup');
      g1.label = t('pick.bawaan');
      for (const p of bawaan) g1.append(new Option(p.label, p.id));
      const g2 = document.createElement('optgroup');
      g2.label = t('pick.custom');
      for (const p of custom) g2.append(new Option(p.label, p.id));
      sel.append(g1, g2);
    }
  }

  // Pintu masuk formulir; cuma di Pengaturan, tidak di dropdown header.
  $('s-provider').append(new Option(t('set.epBaruOpsi'), EP_BARU));
}

/** Model dari cache (hasil tarik dari API) kalau ada; kalau tidak, daftar bawaan. */
function modelsFor(providerId) {
  const cached = (cfg.modelCache || {})[providerId];
  return cached && cached.length ? cached : providerOf(providerId).models;
}

/**
 * Nama model untuk ditampilkan: "claude-opus-4-8" -> "opus 4.8".
 *
 * Awalan "claude-" dibuang karena seluruh isi dropdown ini sudah jelas milik
 * Claude, dan tanda hubung versinya diubah jadi titik supaya terbaca sebagai
 * nomor versi, bukan bagian dari nama.
 *
 * Polanya sengaja ketat (nama huruf + angka saja) supaya model provider lain
 * tidak ikut terpotong: "deepseek-v4-pro" dan "glm-4.6" tidak cocok, jadi
 * dibiarkan apa adanya. Nilai yang dikirim ke SDK selalu id lengkapnya.
 */
function modelLabel(id) {
  const nama = String(id).replace(/^claude-/, '');
  const m = /^([a-z]+)-(\d+)(?:-(\d+))?$/.exec(nama);
  if (!m) return nama;
  return m[3] ? `${m[1]} ${m[2]}.${m[3]}` : `${m[1]} ${m[2]}`;
}

function fillModelSelect(sel, providerId, selected) {
  const models = modelsFor(providerId) || [];
  sel.innerHTML = '';
  // Endpoint custom yang baru dibuat belum punya daftar apa pun. Dropdown
  // kosong tanpa keterangan terlihat seperti aplikasi yang rusak.
  if (!models.length) {
    sel.append(new Option(t('set.modelKosong'), ''));
    return;
  }
  for (const m of models) sel.append(new Option(modelLabel(m), m));
  sel.value = models.includes(selected) ? selected : models[0];
}

function syncHeader() {
  const p = providerOf(cfg.provider);
  pickProvider.pilih(cfg.provider);

  const models = modelsFor(cfg.provider) || [];
  cfg.model = pickModel.isi(
    models.map((m) => ({ nilai: m, label: modelLabel(m), ket: m !== modelLabel(m) ? m : '' })),
    cfg.model
  );

  // Effort tidak berlaku di semua provider; yang tidak mendukung dimatikan
  // beserta alasannya, bukan sekadar diredupkan tanpa penjelasan.
  pickEffort.isi(effortOpsi(), cfg.effort || 'high');
  pickEffort.setMati(
    !p.supportsEffort,
    p.supportsEffort ? t('pick.effort') : t('pick.effortTidak', { provider: p.label })
  );
  const label = $('cwd-label');
  label.textContent = activeWorkingDir || t('header.belumAdaProyek');
  label.disabled = !activeSessionId;

  const title = $('project-title');
  title.textContent = activeTitle || '—';
  title.disabled = !activeSessionId;

  syncPermButton();
}

function syncPermButton() {
  const mode = cfg.permissionMode || 'supervised';
  const info = PERM_MODES[mode] || PERM_MODES.supervised;
  $('perm-icon').replaceChildren(info.emoji ? info.emoji : ikon(info.ikon));
  $('perm-label').textContent = t(info.kunci);
  for (const btn of document.querySelectorAll('.perm-option')) {
    btn.classList.toggle('selected', btn.dataset.mode === mode);
  }
}

function folderName(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// --- Event wiring ------------------------------------------------------

function wireEvents() {
  // Bungkus dalam lambda: kalau `send` dipasang langsung, klik mengirim objek
  // MouseEvent sebagai argumen overrideText dan tombolnya diam saja.
  $('send').onclick = () => send();
  $('stop').onclick = () => window.api.stop(activeSessionId);
  $('compact-btn').onclick = () => compactNow();
  // Bukan `= newChat`: handler menerima MouseEvent sebagai argumen pertama, dan
  // objek itu tidak bisa melewati IPC — sesi barunya gagal dibuat tanpa pesan.
  $('new-chat').onclick = () => newChat();

  const input = $('input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', () => autoGrow(input));

  // Ketiganya kini menu HTML, bukan <select>. Karena itu tidak ada lagi popup
  // asli Windows yang bisa menahan fokus keyboard — pemulihan fokus yang dulu
  // dipasang di sini sudah tidak diperlukan. (Fungsi konfirmasi() masih
  // memakainya untuk dialog confirm(), yang memang masih dialog sistem.)
  const kembaliKeKetikan = () => {
    if ($('settings-overlay').hidden && $('approval-overlay').hidden) $('input').focus();
  };

  pickProvider = bikinPemilih('pick-provider', async (id) => {
    cfg.provider = id;
    cfg.model = providerOf(id).defaultModel;
    await window.api.saveConfig({ provider: cfg.provider, model: cfg.model });
    syncHeader();
    kembaliKeKetikan();
  });

  pickModel = bikinPemilih('pick-model', async (m) => {
    cfg.model = m;
    await window.api.saveConfig({ model: m });
    kembaliKeKetikan();
  });

  pickEffort = bikinPemilih('pick-effort', async (v) => {
    cfg.effort = v;
    await window.api.saveConfig({ effort: v });
    kembaliKeKetikan();
  });

  // Jaring pengaman untuk keadaan yang sama. Syarat "tidak ada yang terfokus"
  // penting: tanpa itu, tiap kali kamu kembali ke jendela ini fokusnya
  // dirampas ke kolom ketik — mengganggu kalau kamu sebenarnya mau mengklik
  // sesuatu yang lain. Alt+Tab keluar-masuk sekali kini cukup untuk pulih.
  window.addEventListener('focus', () => {
    const fokus = document.activeElement;
    if (fokus && fokus !== document.body) return;
    if (!$('settings-overlay').hidden || !$('approval-overlay').hidden) return;
    $('input').focus();
  });

  // Pengaturan
  $('open-settings').onclick = openSettings;
  $('s-cancel').onclick = tutupSettings;

  // Klik di area gelap sekitar panel ikut menutup. Pemeriksaan target penting:
  // tanpa itu, klik apa pun DI DALAM panel ikut menggelembung ke overlay dan
  // pengaturannya tertutup di tengah pengisian.
  $('settings-overlay').onclick = (e) => {
    if (e.target === $('settings-overlay')) tutupSettings();
  };

  // Esc: jalan keluar tercepat, dan satu-satunya yang tetap bekerja saat
  // kursor kebetulan berada di atas panel.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('settings-overlay').hidden) tutupSettings();
  });
  $('s-save').onclick = saveSettings;
  $('s-refresh-models').onclick = refreshModels;
  $('s-pick-folder').onclick = async () => {
    const dir = await window.api.pickFolder();
    if (dir) $('s-cwd').value = dir;
  };
  $('s-tg-detect').onclick = () => telegramAction('detect');
  $('s-tg-test').onclick = () => telegramAction('test');

  $('s-provider').onchange = (e) => {
    if (e.target.value === EP_BARU) {
      bukaFormEndpoint(null);
      return;
    }
    const p = providerOf(e.target.value);
    // Endpoint custom membuka formulirnya sendiri: di situlah satu-satunya
    // tempat untuk mengubah alamat atau menghapusnya.
    if (p.custom) bukaFormEndpoint(p);
    else tutupFormEndpoint();
    fillModelSelect($('s-model'), e.target.value, '');
    syncKeyField(p);
    ringkasanBagian();
    segarkanStatusClaude();
  };
  $('s-model').onchange = ringkasanBagian;
  $('s-tg-enabled').onchange = ringkasanBagian;

  // --- Login Claude Code ---
  const kirimKode = () => {
    const kode = $('s-cc-code').value.trim();
    if (!kode) return;
    window.api.claudeLoginInput(kode);
    $('s-cc-code').value = '';
  };
  $('s-cc-send').onclick = kirimKode;
  $('s-cc-code').onkeydown = (e) => {
    if (e.key === 'Enter') kirimKode();
  };
  $('s-cc-cancel').onclick = async () => {
    await window.api.claudeLoginCancel();
    ccSedangLogin = false;
    $('s-cc-login').hidden = true;
    segarkanStatusClaude();
  };

  // --- Panel pemasangan Claude Code ---
  $('cc-install-close').onclick = () => ($('cc-install-overlay').hidden = true);
  $('cc-install-recheck').onclick = async () => {
    const s = await window.api.claudeAuthStatus();
    if (s.tersedia) {
      $('cc-install-overlay').hidden = true;
      segarkanStatusClaude();
      return;
    }
    $('cc-install-overlay').querySelector('.note').textContent = t('ccInstall.belumKetemu');
  };
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.onclick = () => navigator.clipboard.writeText($(b.dataset.copy).textContent);
  }

  window.api.onClaudeLoginEvent((ev) => {
    if (ev.type === 'keluar') return catatLogClaude(ev.teks);
    if (ev.type === 'url') return catatLogClaude(`\n${t('cc.browserDibuka', { url: ev.url })}\n`);
    if (ev.type !== 'selesai') return;

    ccSedangLogin = false;
    catatLogClaude(`\n${ev.ok ? t('cc.berhasil') : t('cc.gagal')}\n`);
    // Kotak konsolnya dibiarkan terbuka sebentar kalau gagal, supaya pesan
    // terakhir dari alat resminya masih sempat terbaca.
    if (ev.ok) $('s-cc-login').hidden = true;
    segarkanStatusClaude();
  });

  $('s-ep-save').onclick = simpanEndpoint;
  $('s-ep-cancel').onclick = () => {
    tutupFormEndpoint();
    // Kembalikan pilihan ke provider yang benar-benar aktif — kalau tidak,
    // dropdown tertinggal di "+ Tambah endpoint baru…" yang bukan provider.
    $('s-provider').value = cfg.provider;
    syncKeyField(providerOf(cfg.provider));
  };
  $('s-ep-delete').onclick = hapusEndpoint;

  $('s-mcp-add').onclick = () => bukaFormMcp(null);
  $('s-mcp-save').onclick = simpanMcp;
  $('s-mcp-cancel').onclick = tutupFormMcp;
  $('s-mcp-delete').onclick = hapusMcp;
  $('s-mcp-refresh').onclick = sambungkanSemuaMcp;
  $('s-mcp-paste').onclick = bukaFormJsonMcp;
  $('s-mcp-json-ok').onclick = imporJsonMcp;
  $('s-mcp-json-cancel').onclick = () => ($('s-mcp-json-box').hidden = true);
  // Bentuk formulir mengikuti isi kolom perintah: URL menyembunyikan argumen.
  $('s-mcp-cmd').oninput = syncBentukMcp;

  $('toggle-sidebar').onclick = () => setSidebar(false);
  $('show-sidebar').onclick = () => setSidebar(true);

  // --- Lampiran ---
  $('attach').onclick = async () => {
    const files = await window.api.pickFiles();
    if (files && files.length) {
      pendingAttachments.push(...files);
      renderAttachments();
    }
  };

  wireDragAndDrop();
  wirePasteImage();

  // --- Mode izin ---
  const menu = $('perm-menu');
  $('perm-trigger').onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  for (const btn of document.querySelectorAll('.perm-option')) {
    btn.onclick = async () => {
      menu.hidden = true;
      cfg = await window.api.saveConfig({ permissionMode: btn.dataset.mode });
      syncPermButton();
    };
  }
  // Satu klik di mana pun menutup semua menu melayang. Tiap trigger memanggil
  // stopPropagation, jadi membuka salah satunya tidak langsung menutup dirinya.
  document.addEventListener('click', () => {
    menu.hidden = true;
    tutupSemuaPemilih();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    menu.hidden = true;
    tutupSemuaPemilih();
  });

  // --- Nama proyek ---
  $('project-title').onclick = () => renameActiveProject();

  $('cwd-label').onclick = async () => {
    if (!activeSessionId) return;
    const dir = await window.api.setSessionFolder(activeSessionId);
    if (!dir) return;
    activeWorkingDir = dir;
    syncHeader();
    await refreshSessionList();
  };

  jagaGulir();

  window.api.onEvent(handleAgentEvent);
  window.api.onApprovalRequest(queueApproval);
  window.api.onQuestion(receiveQuestion);
  window.api.onSessionsChanged(refreshSessionList);
  window.api.onQueue(({ sessionId, items }) => {
    // Antrean proyek lain tetap jalan di main; yang digambar hanya milik
    // proyek yang sedang dibuka.
    if (sessionId !== activeSessionId) return;
    queueItems = items || [];
    renderQueue();
  });
  window.api.onSessionsBusy(({ ids, mulai }) => {
    busyIds = new Set(ids || []);
    busyStarts = mulai || {};
    // Giliran yang baru saja dimulai dari sini: pakai waktu mulai versi main,
    // supaya sumber waktunya cuma satu.
    // Main process yang berwenang soal sibuk/tidak — UI cuma mengikutinya.
    // Ini yang menutup dua celah: penanda "Berjalan…" yang berputar selamanya
    // karena event 'done'-nya hilang, dan giliran yang berangkat sendiri dari
    // antrean tanpa ada yang menyalakan penandanya.
    const sibuk = !!(activeSessionId && busyIds.has(activeSessionId));
    const ts = busyStarts[activeSessionId];
    if (sibuk !== busy) setBusy(sibuk, ts);
    else if (sibuk && ts && ts !== runningSince) startRunning(ts);
    markBusyRows();
  });

  // Pesan yang dikirim dari HP: tampilkan gelembungnya di sini juga, supaya
  // desktop dan HP tidak menunjukkan percakapan yang berbeda.
  window.api.onRemoteUser(({ text, sessionId }) => {
    if (sessionId && sessionId !== activeSessionId) return;
    $('empty-state')?.remove();
    addUserMessage(text, [], { dariHp: true });
    setBusy(true);
  });

  // Izin yang sudah dijawab lewat tombol di Telegram — tutup modalnya di sini,
  // kalau tidak ia menggantung meminta jawaban yang sudah diberikan.
  window.api.onApprovalResolved(({ id, sessionId }) => {
    dropQueuedApproval(sessionId, id);
    if (shownApprovalId === id) {
      $('approval-overlay').hidden = true;
      shownApprovalId = null;
      showNextApproval();
    }
  });

  window.api.onSessionSwitched(({ id }) => {
    if (id !== activeSessionId) openSession(id);
  });

  window.api.onTelegramStatus(({ error }) => {
    if (!error) return;
    append(el('div', 'error-line', error));
    scroll();
  });
}

/** Ganti nama proyek aktif lewat edit inline di header. */
function renameActiveProject() {
  if (!activeSessionId) return;
  const btn = $('project-title');
  if (btn.hidden) return;

  const input = document.createElement('input');
  input.className = 'title-edit';
  input.value = activeTitle;
  btn.hidden = true;
  btn.after(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = async (save) => {
    if (settled) return;
    settled = true;
    const next = input.value.trim();
    input.remove();
    btn.hidden = false;
    if (save && next && next !== activeTitle) {
      await window.api.renameSession(activeSessionId, next);
      activeTitle = next;
      await refreshSessionList();
    }
    syncHeader();
  };

  input.onblur = () => commit(true);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
  };
}

// --- Lampiran ------------------------------------------------------------

/**
 * Seret-lepas file ke mana pun di jendela.
 *
 * Dua hal yang mudah salah:
 *  - dragenter/dragleave menyala berulang saat kursor melewati elemen anak,
 *    jadi dipakai penghitung kedalaman, bukan boolean.
 *  - Electron 34 sudah menghapus File.path; jalur resminya webUtils.getPathForFile.
 */
function wireDragAndDrop() {
  const veil = $('drop-veil');
  let depth = 0;

  const show = () => (veil.hidden = false);
  const hide = () => {
    depth = 0;
    veil.hidden = true;
  };

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    show();
  });

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (--depth <= 0) hide();
  });

  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();

    const paths = [...e.dataTransfer.files]
      .map((f) => {
        try {
          return window.api.pathForFile(f);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!paths.length) return;
    const files = await window.api.readFiles(paths);
    pendingAttachments.push(...files);
    renderAttachments();
    $('input').focus();
  });
}

/**
 * Tempel gambar langsung ke kolom chat (Ctrl+V), termasuk hasil tangkapan
 * layar yang tidak pernah menyentuh disk.
 *
 * Dipasang di seluruh dokumen, bukan cuma di textarea: setelah menekan Print
 * Screen atau Win+Shift+S, fokusnya sering belum kembali ke kolom ketik.
 */
function wirePasteImage() {
  document.addEventListener('paste', async (e) => {
    // Jangan ganggu tempelan di kolom lain (mis. ganti nama proyek, pengaturan).
    const fokus = document.activeElement;
    if (fokus && fokus !== $('input') && /^(INPUT|TEXTAREA)$/.test(fokus.tagName)) return;

    const gambar = [...(e.clipboardData?.items || [])].filter(
      (it) => it.kind === 'file' && it.type.startsWith('image/')
    );
    // Tempelan teks biasa: biarkan browser menanganinya seperti biasa.
    if (!gambar.length) return;
    e.preventDefault();

    for (const it of gambar) {
      const file = it.getAsFile();
      if (!file) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const att = await window.api.pasteImage(file.type, bytes);
      if (att) pendingAttachments.push(att);
    }
    renderAttachments();
    $('input').focus();
  });
}

/** Yang diseret benar-benar file, bukan teks atau seleksi dari halaman. */
function hasFiles(e) {
  return [...(e.dataTransfer?.types || [])].includes('Files');
}

function renderAttachments() {
  const box = $('attachments');
  box.innerHTML = '';
  box.hidden = !pendingAttachments.length;

  pendingAttachments.forEach((a, i) => {
    const chip = el('div', 'chip' + (a.error ? ' bad' : ''));
    const ci = el('span', 'chip-icon');
    ci.append(ikon(a.kind === 'image' ? 'image' : 'file-text'));
    chip.append(ci);
    const name = el('span', 'chip-name', a.name);
    if (a.error) name.title = a.error;
    chip.append(name);

    const x = el('button', 'chip-x', '×');
    x.onclick = () => {
      pendingAttachments.splice(i, 1);
      renderAttachments();
    };
    chip.append(x);
    box.append(chip);
  });
}

function setSidebar(visible) {
  $('sidebar').hidden = !visible;
  $('show-sidebar').hidden = visible;
}

// --- Sidebar sesi ------------------------------------------------------

/**
 * Tandai baris sidebar milik proyek yang sedang bekerja atau sedang menunggu
 * izin. Dipisah dari refreshSessionList supaya perubahan status tidak perlu
 * menggambar ulang seluruh daftar (dan membatalkan rename yang sedang diketik).
 */
function markBusyRows() {
  for (const row of $('session-list').querySelectorAll('.session[data-id]')) {
    const id = row.dataset.id;
    row.classList.toggle('running', busyIds.has(id));
    const menunggu =
      (approvalQueue.get(id) || []).length > 0 || (questionQueue.get(id) || []).length > 0;
    row.classList.toggle('needs-approval', menunggu);
  }
}

async function refreshSessionList() {
  const { sessions, busyIds: ids, busyStarts: starts } = await window.api.listSessions();
  if (ids) busyIds = new Set(ids);
  if (starts) busyStarts = starts;
  const list = $('session-list');
  list.innerHTML = '';

  if (!sessions.length) {
    list.append(el('div', 'session-empty', t('sidebar.kosong')));
    return;
  }

  // Kelompokkan per folder. Kunci peta memakai huruf kecil supaya "C:\Users" dan
  // "c:\users" tidak jadi dua kelompok terpisah di Windows, tapi yang ditampilkan
  // tetap ejaan asli dari sesi pertama kelompok itu.
  const kelompok = new Map();
  for (const s of sessions) {
    const kunci = (s.workingDir || '').toLowerCase();
    if (!kelompok.has(kunci)) kelompok.set(kunci, { dir: s.workingDir || '', isi: [] });
    kelompok.get(kunci).isi.push(s);
  }

  for (const { dir, isi } of kelompok.values()) {
    list.append(bikinKepalaKelompok(dir, isi));
    for (const s of isi) list.append(bikinBarisSesi(s, isi.length > 1));
  }
  markBusyRows();
}

/**
 * Kepala kelompok: nama folder + tombol menambah sesi di folder yang sama.
 *
 * Kelompok yang dilipat disimpan di `lipatan`, bukan di config — status lipat
 * itu bacaan sesaat, bukan preferensi yang layak ikut ke PC lain.
 */
function bikinKepalaKelompok(dir, isi) {
  const kunci = dir.toLowerCase();
  const tertutup = lipatan.has(kunci);
  // Kelasnya "folder-*", bukan "group-*": nama itu sudah dipakai grup kartu tool
  // di area chat, dan memakainya di sini membuat judul grup tool ikut mengecil
  // dan berubah jadi HURUF BESAR.
  const head = el('div', 'folder-head' + (tertutup ? ' closed' : ''));

  const panah = el('span', 'folder-caret');
  panah.append(ikon('chevron-down'));
  head.append(panah);

  const nama = el('span', 'folder-name', dir ? folderName(dir) : t('sidebar.tanpaFolder'));
  nama.title = dir || t('sidebar.tanpaFolderTip');
  head.append(nama);

  head.append(el('span', 'folder-count', String(isi.length)));

  const tambah = el('button', 'folder-add', '+');
  tambah.title = t('sidebar.sesiBaru', { dir: dir || t('sidebar.sesiBaruUmum') });
  tambah.onclick = (e) => {
    e.stopPropagation(); // jangan ikut melipat kelompoknya
    newChat(dir || undefined);
  };
  head.append(tambah);

  head.onclick = () => {
    if (tertutup) lipatan.delete(kunci);
    else lipatan.add(kunci);
    refreshSessionList();
  };
  return head;
}

/**
 * Judul bawaan yang sempat DITULIS harfiah ke berkas sesi oleh versi lama.
 * Diperlakukan sama dengan judul kosong, supaya sesi yang dibuat sebelum 0.3.4
 * ikut berganti bahasa alih-alih terkunci selamanya di bahasa saat itu.
 * Kembarannya ada di sessions.js — kalau salah satu berubah, ubah keduanya.
 */
const JUDUL_BAWAAN_LAMA = new Set(['Percakapan baru', 'New conversation', 'Tanpa judul']);

/** Judul sesi untuk ditampilkan: yang kosong diisi teks sesuai bahasa aktif. */
function judulSesi(s) {
  const j = String((s && s.title) || '').trim();
  return !j || JUDUL_BAWAAN_LAMA.has(j) ? t('sidebar.baru') : j;
}

function bikinBarisSesi(s, dalamKelompok) {
  const row = el(
    'div',
    'session' +
      (s.id === activeSessionId ? ' active' : '') +
      (dalamKelompok ? ' nested' : '') +
      // Sesi yang sedang dibuka tidak pernah ikut tersembunyi, walau kelompoknya
      // dilipat — kalau tidak, sidebar seolah kehilangan jejak posisimu.
      (lipatan.has((s.workingDir || '').toLowerCase()) && s.id !== activeSessionId
        ? ' hidden-row'
        : '')
  );
  row.dataset.id = s.id;

  // Titik status: menyala saat proyek ini bekerja di latar.
  row.append(el('span', 'session-dot'));

  const text = el('div', 'session-text');
  const label = el('span', 'label', judulSesi(s));
  text.append(label);
  // Nama folder sengaja tidak diulang di sini — sudah jadi judul kelompoknya.
  row.append(text);
  row.append(el('span', 'time', relativeTime(s.updatedAt)));

  const del = el('button', 'del', '×');
  del.title = t('sidebar.hapusSesi');
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!konfirmasi(t('tanya.hapusSesi', { judul: judulSesi(s) }))) return;
    const rest = await window.api.deleteSession(s.id);
    drafts.delete(s.id); // jangan menyimpan ketikan milik proyek yang sudah hilang
    if (s.id === activeSessionId) {
      // Kosongkan kolomnya dulu, kalau tidak simpanDraf() di openSession
      // menghidupkan lagi draf proyek yang barusan dihapus.
      $('input').value = '';
      pendingAttachments = [];
      // Pindah ke proyek lain yang tersisa, jangan paksa dialog folder.
      if (rest.length) return openSession(rest[0].id);
      activeSessionId = null;
      activeWorkingDir = '';
      renderAttachments();
      renderHistory([]);
      syncHeader();
    }
    await refreshSessionList();
  };
  row.append(del);

  row.onclick = () => openSession(s.id);
  // Klik ganda pada judul -> ubah nama langsung di tempat.
  row.ondblclick = (e) => {
    e.stopPropagation();
    startRename(row, label, s);
  };

  return row;
}

function startRename(row, label, session) {
  if (row.querySelector('input')) return;

  const input = document.createElement('input');
  input.className = 'rename';
  input.value = judulSesi(session);
  label.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = async (save) => {
    if (settled) return;
    settled = true;
    if (save && input.value.trim() && input.value.trim() !== judulSesi(session)) {
      await window.api.renameSession(session.id, input.value.trim());
    }
    await refreshSessionList();
  };

  input.onclick = (e) => e.stopPropagation();
  input.onblur = () => commit(true);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
  };
}

/**
 * confirm() yang tidak meninggalkan keyboard tersangkut.
 *
 * confirm() bawaan di Electron bukan elemen halaman melainkan dialog asli
 * Windows. Dialog itu mengambil fokus keyboard dari jendela aplikasi, dan
 * sering menutup tanpa benar-benar mengembalikannya. Gejalanya: mouse tetap
 * bekerja — kamu bisa menggulir, membuka Pengaturan, berpindah proyek — tapi
 * tidak ada satu pun tombol yang sampai ke halaman, bahkan setelah Ctrl+R.
 *
 * Tidak bisa diperbaiki dari sini: focus() cuma memindahkan fokus DI DALAM
 * dokumen yang jendelanya sendiri sedang tidak aktif menurut Windows. Jadi
 * proses main yang diminta merebutnya kembali — meniru trik klik-desktop-
 * lalu-kembali. Dijalankan tanpa syarat karena setelah dialog asli menutup,
 * document.hasFocus() bisa terlanjur melaporkan true padahal keyboardnya belum
 * kembali.
 */
function konfirmasi(pesan) {
  const ya = confirm(pesan);
  setTimeout(async () => {
    await window.api.refocusWindow();
    if ($('settings-overlay').hidden && $('approval-overlay').hidden) $('input').focus();
  }, 60);
  return ya;
}

/** Titipkan ketikan proyek yang sedang dibuka sebelum berpindah. */
function simpanDraf() {
  if (!activeSessionId) return;
  const text = $('input').value;
  if (text.trim() || pendingAttachments.length) {
    drafts.set(activeSessionId, { text, attachments: pendingAttachments });
  } else {
    drafts.delete(activeSessionId);
  }
}

/** Kembalikan ketikan milik proyek yang baru dibuka (kosong kalau tidak ada). */
function pulihkanDraf(id) {
  const d = drafts.get(id) || { text: '', attachments: [] };
  const input = $('input');
  input.value = d.text;
  autoGrow(input);
  pendingAttachments = d.attachments;
  renderAttachments();
}

async function openSession(id) {
  // Disimpan sebelum menunggu balasan main — kalau tidak, activeSessionId bisa
  // sudah berganti saat kita sempat menengok isi kolomnya.
  simpanDraf();

  const s = await window.api.openSession(id);
  if (!s) return;

  // Modal izin milik proyek yang ditinggal ditutup, bukan dijawab — ia tetap
  // mengantre dan muncul lagi kalau kamu kembali ke proyek itu.
  if (shownApprovalId) {
    $('approval-overlay').hidden = true;
    shownApprovalId = null;
  }

  activeSessionId = s.id;
  activeWorkingDir = s.workingDir || '';
  activeTitle = judulSesi(s);
  // Ketikan dan lampiran milik proyek INI, bukan sisa dari proyek sebelumnya.
  pulihkanDraf(s.id);
  // Pemakaian token giliran terakhir ikut dipulihkan — jangan kembali ke nol
  // hanya karena aplikasi sempat ditutup.
  if (s.lastUsage) renderUsage(s.lastUsage);
  else resetUsage();
  renderHistory(s.messages);
  // Proyek baru dibuka: mulai dari pesan terakhir, dan lupakan posisi baca
  // yang tertinggal dari proyek sebelumnya.
  scrollPaksa();
  syncHeader();
  // Proyek ini mungkin masih bekerja sejak sebelum kamu pindah — pulihkan
  // penanda "Berjalan…" alih-alih memaksanya terlihat menganggur.
  setBusy(!!s.busy, s.mulai);
  // Kalau proyek ini sedang bekerja, kita hampir pasti masuk di tengah sebuah
  // pesan — susun ulang layarnya begitu pesan itu selesai.
  needsResync = !!s.busy;
  await refreshSessionList();
  // Yang menunggu selama proyek ini ditinggal, tampilkan sekarang.
  await refreshQueue();
  renderPendingQuestions();
  showNextApproval();
}

/**
 * Ambil riwayat terkini dari main lalu gambar ulang chat.
 *
 * Dipakai setelah kembali ke proyek yang sedang bekerja. Penanda "Berjalan…"
 * dipasang lagi karena renderHistory mengosongkan seluruh area chat.
 */
async function resyncHistory() {
  const id = activeSessionId;
  const messages = await window.api.sessionHistory(id);
  // Kamu bisa saja sudah pindah lagi selama menunggu balasan ini.
  if (id !== activeSessionId) return;

  // renderHistory mengosongkan chat, jadi gulirannya lompat ke atas dan
  // "lengket" jadi false karena disangka kamu yang menggulir. Ingat dulu
  // keadaan sebenarnya, lalu pulihkan.
  const ikutKeBawah = lengket;
  renderHistory(messages);
  if (ikutKeBawah) scrollPaksa();
  renderPendingQuestions();
  // renderHistory mengosongkan chat, jadi penandanya dipasang ulang — dengan
  // waktu mulai yang sama, bukan dari nol.
  if (busy) startRunning(runningSince || busyStarts[id]);
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('waktu.baru');
  if (min < 60) return t('waktu.menit', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('waktu.jam', { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('waktu.hari', { n: day });
  return new Date(ts).toLocaleDateString(t('waktu.locale'), { day: 'numeric', month: 'short' });
}

/** Gambar ulang percakapan tersimpan ke area chat. */
function renderHistory(messages) {
  const inner = $('chat-inner');
  inner.innerHTML = '';
  currentBubble = null;
  currentThinking = null;
  currentToolGroup = null;
  toolCards.clear();

  if (!messages || !messages.length) {
    inner.innerHTML = emptyStateHTML();
    return;
  }

  // Hasil tool ada di pesan user berikutnya — kumpulkan dulu supaya
  // tiap kartu tool bisa langsung ditampilkan lengkap dengan output-nya.
  const resultById = new Map();
  for (const m of messages) {
    for (const b of m.content || []) {
      if (b.type === 'tool_result') resultById.set(b.tool_use_id, b);
    }
  }

  for (const m of messages) {
    // Gambar milik satu pesan user digabung ke gelembung teksnya.
    const images = (m.content || [])
      .filter((b) => b.type === 'image' && b.source?.data)
      .map((b) => ({ kind: 'image', name: b.name || 'gambar', mediaType: b.source.media_type, data: b.source.data }));
    let imagesUsed = false;

    for (const b of m.content || []) {
      if (b.type === 'text') {
        closeToolGroup(); // teks memisahkan satu rentetan tool dari berikutnya
        if (m.role === 'user') {
          addUserMessage(b.text, imagesUsed ? [] : images);
          imagesUsed = true;
        } else {
          const wrap = el('div', 'msg assistant');
          const bubble = el('div', 'bubble');
          bubble.dataset.raw = b.text;
          wrap.append(bubble);
          append(wrap);
          finalizeAssistant(bubble);
        }
      } else if (b.type === 'tool_use') {
        // Pertanyaan yang sudah lewat: tampilkan jawabannya, bukan kartu tool.
        if (b.name === 'AskUserQuestion') {
          closeToolGroup();
          append(riwayatPertanyaan(b, resultById.get(b.id)));
          continue;
        }
        addToolCard({ id: b.id, name: b.name, input: b.input });
        const res = resultById.get(b.id);
        if (res) {
          finishToolCard({
            id: b.id,
            ok: !res.is_error,
            output: typeof res.content === 'string' ? res.content : JSON.stringify(res.content),
          });
        }
      }
    }
  }
  closeToolGroup();
  scroll();
}

/**
 * Ringkasan satu pertanyaan yang sudah dijawab, untuk riwayat yang dimuat dari
 * disk. Jawabannya diambil dari `input.answers` — itu yang benar-benar dikirim
 * ke model, jadi yang kamu baca di sini sama dengan yang dilihat agen.
 */
function riwayatPertanyaan(block, result) {
  const card = el('div', 'qcard answered');
  card.append(el('div', 'qcard-title', 'Pertanyaan agen'));
  const answers = (block.input && block.input.answers) || {};

  for (const q of (block.input && block.input.questions) || []) {
    const blok = el('div', 'qblock');
    if (q.header) blok.append(el('span', 'qchip', q.header));
    blok.append(el('div', 'qtext', q.question));
    const jawab = answers[q.question];
    blok.append(el('div', 'qdone', jawab ? `✓ ${jawab}` : t('chat.tidakDijawab')));
    card.append(blok);
  }

  // Jawaban tidak terekam di input (mis. ditolak): pakai teks hasil tool.
  if (!card.querySelector('.qblock') && result) {
    const teks = typeof result.content === 'string' ? result.content : '';
    card.append(el('div', 'qdone', teks.slice(0, 300)));
  }
  return card;
}

function emptyStateHTML() {
  if (!activeSessionId) {
    return (
      `<div class="empty" id="empty-state"><h2>${t('chat.kosongJudul')}</h2>` +
      `<p>${t('chat.kosongIsiHtml')}</p></div>`
    );
  }
  return (
    `<div class="empty" id="empty-state"><h2>${t('chat.siapJudul')}</h2>` +
    `<p>${t('chat.siapIsi')}</p></div>`
  );
}

// --- Kirim pesan -------------------------------------------------------

async function send(overrideText) {
  const input = $('input');
  // Hanya terima string; apa pun selain itu dianggap "pakai isi kolom".
  const useOverride = typeof overrideText === 'string';
  const text = (useOverride ? overrideText : input.value).trim();
  if (!text) return;

  // Diambil sebelum newChat(), yang mengosongkan kolom untuk proyek barunya.
  const attachments = pendingAttachments;

  // Tidak ada proyek aktif -> minta buat dulu (termasuk pilih foldernya).
  if (!activeSessionId && !(await newChat())) return;

  pendingAttachments = [];
  renderAttachments();
  // Sudah terkirim — jangan sampai muncul lagi saat proyek ini dibuka nanti.
  drafts.delete(activeSessionId);

  if (!useOverride) {
    input.value = '';
    autoGrow(input);
  }

  // Agen masih bekerja: pesannya mengantre, bukan ditolak. Gelembungnya belum
  // digambar — main process yang menggambarnya saat pesan ini benar-benar
  // dibaca, entah sebagai giliran berikutnya atau lewat "Kirim sekarang".
  if (busy) {
    await window.api.send(activeSessionId, text, attachments);
    return;
  }

  $('empty-state')?.remove();
  addUserMessage(text, attachments);
  // Kamu baru saja mengirim: pasti mau melihat balasannya, bukan tetap
  // tertinggal di bagian percakapan yang sedang kamu baca tadi.
  scrollPaksa();
  setBusy(true);

  // Kunci id-nya sekarang: kalau kamu pindah proyek selagi giliran ini jalan,
  // pesannya tetap masuk ke proyek yang kamu maksud.
  await window.api.send(activeSessionId, text, attachments);
}

// --- Antrean -----------------------------------------------------------

function renderQueue() {
  const box = $('queue');
  box.innerHTML = '';
  box.hidden = !queueItems.length;
  if (!queueItems.length) return;

  for (const item of queueItems) {
    const row = el('div', 'queue-item');
    const qi = el('span', 'queue-icon');
    qi.append(ikon('clock'));
    row.append(qi);

    const teks = el('span', 'queue-text', item.text);
    teks.title = item.text; // teks panjang dipotong CSS; ini tetap bisa dibaca
    row.append(teks);

    if (item.jumlahLampiran) {
      row.append(el('span', 'queue-files', `+${item.jumlahLampiran} file`));
    }

    const now = el('button', 'queue-now', t('antre.sekarang'));
    now.title = t('antre.sekarangTip');
    now.onclick = async () => {
      now.disabled = true;
      // Gagal berarti gilirannya keburu selesai — main mengantrekannya ulang
      // dan ia berangkat sendiri sebagai giliran berikutnya.
      await window.api.queueNow(activeSessionId, item.id);
    };
    row.append(now);

    const del = el('button', 'queue-cancel', '×');
    del.title = t('antre.batal');
    del.onclick = () => window.api.queueCancel(activeSessionId, item.id);
    row.append(del);

    box.append(row);
  }
}

async function refreshQueue() {
  const id = activeSessionId;
  queueItems = id ? await window.api.queueList(id) : [];
  if (id !== activeSessionId) return; // sudah pindah lagi selama menunggu
  renderQueue();
}

/**
 * Buat sesi baru.
 *
 * Tanpa argumen: main process membuka dialog folder dulu, dan kalau kamu
 * membatalkan, tidak ada yang dibuat. Dengan `folder`: dialognya dilewati dan
 * sesi barunya menempel di folder itu — dipakai tombol "+" tiap kelompok.
 */
async function newChat(folder) {
  const s = await window.api.createSession(folder);
  if (!s) return false;
  activeSessionId = s.id;
  activeWorkingDir = s.workingDir || '';
  activeTitle = judulSesi(s);
  pulihkanDraf(s.id); // proyek baru: kolomnya kosong
  queueItems = [];
  renderQueue();
  resetUsage();
  renderHistory([]);
  scrollPaksa();
  syncHeader();
  setBusy(false);
  await refreshSessionList();
  $('input').focus();
  return true;
}

function setBusy(v, mulai) {
  busy = v;
  // Tombol kirim TIDAK lagi disembunyikan saat agen bekerja — mengirim pesan
  // sekarang berarti mengantre, bukan hal terlarang. Labelnya yang berubah,
  // supaya jelas pesannya tidak langsung dibaca.
  $('send').textContent = v ? t('komposer.antre') : t('komposer.kirim');
  $('stop').hidden = !v;
  $('input').placeholder = v ? t('komposer.ketikSibuk') : t('komposer.ketik');
  // Meringkas di tengah giliran akan menyisipkan pesan ke sesi yang sedang
  // bekerja — matikan tombolnya selama agen jalan.
  $('compact-btn').disabled = v;
  if (v) startRunning(mulai);
  else stopRunning();
}

/**
 * Ringkas percakapan: tukar isi jendela konteks dengan ringkasannya.
 *
 * Chat di layar sengaja TIDAK dihapus. Yang mengecil adalah apa yang dibawa ke
 * model pada giliran berikutnya — jadi angka di status bar turun, sementara
 * yang bisa kamu baca ulang tetap utuh.
 */
async function compactNow() {
  if (busy || !activeSessionId) return;
  setBusy(true);
  $('empty-state')?.remove();
  const label = el('div', 'compact-line');
  const ci = el('span', 'compact-icon');
  ci.append(ikon('sparkles'));
  label.append(ci);
  label.append(el('span', '', t('chat.meringkas')));
  append(label);
  scroll();

  try {
    await window.api.compact(activeSessionId);
  } finally {
    label.remove(); // diganti baris hasil dari event 'compacted'
  }
}

/** Batas kompaksi di dalam chat, memakai angka sungguhan dari provider. */
function showCompacted(ev) {
  closeToolGroup();
  const row = el('div', 'compact-line done');
  // Centang, bukan ✧: baris ini menandai kompaksi yang SUDAH selesai, sementara
  // ✧ dipakai baris "Meringkas…" yang masih berjalan.
  row.append(el('span', 'compact-icon', '✓'));
  row.append(
    el(
      'span',
      '',
      ev.trigger === 'auto' ? 'Compact is completed (otomatis)' : 'Compact is completed'
    )
  );
  if (ev.pre && ev.post) {
    const tanda = ev.estimated ? '≈' : '';
    row.append(el('span', 'compact-note', `${tanda}${fmtTokens(ev.pre)} → ${tanda}${fmtTokens(ev.post)}`));
  }
  append(row);
  scroll();
}

/**
 * Penanda "masih berjalan" dengan penghitung waktu.
 *
 * Tanpa ini, giliran yang mendelegasikan ke subagent (tool Task) terlihat
 * mati total: subagent bisa berjalan menit-menitan tanpa memancarkan event
 * apa pun ke layar.
 */
function startRunning(mulai) {
  stopRunning();
  // Kalau main process tahu kapan gilirannya dimulai, pakai angkanya — giliran
  // yang sudah jalan 10 menit harus tetap terbaca 10 menit setelah kamu
  // meninggalkan proyeknya dan kembali.
  runningSince = mulai || Date.now();
  runningRow = el('div', 'running');
  runningRow.append(el('span', 'running-dot'));
  const label = el('span', 'running-label', t('chat.berjalan'));
  runningRow.append(label);
  $('chat-inner').append(runningRow);

  const tulisWaktu = () => {
    const d = Math.round((Date.now() - runningSince) / 1000);
    if (d < 1) return;
    const m = Math.floor(d / 60);
    // Satuan menit/detik sengaja tetap "m" dan "s": sama pendeknya di kedua
    // bahasa, dan penghitung yang berubah tiap detik tidak boleh melebar.
    label.textContent = t('chat.berjalanLama', {
      waktu: `${m ? m + 'm ' : ''}${d % 60}s`,
    });
  };
  tulisWaktu(); // jangan tunggu satu detik untuk menunjukkan umur yang benar
  runningTimer = setInterval(tulisWaktu, 1000);
  scroll();
}

function stopRunning() {
  clearInterval(runningTimer);
  runningTimer = null;
  runningSince = 0;
  runningRow?.remove();
  runningRow = null;
}

// --- Render event dari agen -------------------------------------------

function handleAgentEvent(ev) {
  // Event milik proyek lain tidak boleh menulis ke chat yang sedang terbuka.
  // Kemajuannya tidak hilang: tiap langkah sudah dipersist ke disk, jadi saat
  // proyek itu dibuka lagi riwayatnya lengkap sampai langkah terakhir.
  if (ev.sessionId && ev.sessionId !== activeSessionId) return;

  switch (ev.type) {
    case 'assistant_start':
      currentBubble = null;
      currentThinking = startThinking();
      scroll();
      break;

    case 'thinking':
      if (!currentThinking) currentThinking = startThinking();
      currentThinking.body.textContent += ev.text;
      currentThinking.chars += ev.text.length;
      scroll();
      break;

    case 'text':
      finishThinking(currentThinking);
      currentThinking = null;
      closeToolGroup();
      if (!currentBubble) {
        const wrap = el('div', 'msg assistant');
        currentBubble = el('div', 'bubble');
        wrap.append(currentBubble);
        append(wrap);
      }
      currentBubble.dataset.raw = (currentBubble.dataset.raw || '') + ev.text;
      renderMarkdown(currentBubble, currentBubble.dataset.raw);
      scroll();
      break;

    case 'assistant_end':
      if (currentBubble) finalizeAssistant(currentBubble);
      finishThinking(currentThinking);
      currentBubble = null;
      currentThinking = null;
      // Kamu masuk di tengah pesan ini, jadi yang tergambar cuma ekornya.
      // Sekarang pesannya utuh di sisi main — ambil dan susun ulang layarnya.
      if (needsResync) {
        needsResync = false;
        resyncHistory();
      }
      break;

    case 'usage':
      renderUsage(ev.usage);
      break;

    case 'compacted':
      showCompacted(ev);
      break;

    case 'tool_start':
      // Pertanyaan sudah punya kartunya sendiri yang jauh lebih berguna —
      // jangan tampilkan juga sebagai kartu tool "AskUserQuestion" kosong.
      if (ev.name === 'AskUserQuestion') {
        hiddenTools.add(ev.id);
        break;
      }
      addToolCard(ev);
      break;

    case 'tool_end':
      if (hiddenTools.has(ev.id)) {
        hiddenTools.delete(ev.id);
        break;
      }
      finishToolCard(ev);
      break;

    case 'error':
      // Penanda khusus dari proses main, bukan kalimat untuk dibaca: binary
      // Claude Code tidak ada. Ditangani dengan panduan pemasangan, bukan
      // baris merah yang tidak memberi tahu apa yang harus dilakukan.
      if (ev.message === 'CLAUDE_CODE_TIDAK_ADA') {
        bukaPanelPasangClaude();
        break;
      }
      append(el('div', 'error-line', ev.message));
      scroll();
      break;

    // Pesan antrean baru saja benar-benar dibaca agen — sekarang, dan baru
    // sekarang, gelembungnya pantas muncul di posisi yang benar.
    case 'queued_sent':
      closeToolGroup();
      $('empty-state')?.remove();
      addUserMessage(ev.text, []);
      // Disisipkan di tengah giliran: penanda "Berjalan…" harus tetap paling
      // bawah, bukan tertinggal di atas gelembung yang baru muncul.
      if (runningRow) $('chat-inner').append(runningRow);
      scroll();
      break;

    case 'done':
      closeToolGroup();
      setBusy(false);
      break;
  }
}

// --- Blok penalaran (thinking) -------------------------------------------

/**
 * Blok penalaran dibuat TERLIPAT sejak awal. Isinya tetap terkumpul di
 * belakang layar; yang terlihat hanya satu baris ringkas, jadi chat tidak
 * penuh teks penalaran. Klik untuk membuka.
 */
function startThinking() {
  const wrap = el('div', 'think collapsed active');

  const head = el('button', 'think-head');
  head.append(el('span', 'think-chevron', '›'));
  const label = el('span', 'think-label', t('chat.berpikir'));
  head.append(label);
  head.onclick = () => wrap.classList.toggle('collapsed');

  const body = el('div', 'think-body');
  wrap.append(head, body);
  append(wrap);

  return { wrap, label, body, chars: 0, startedAt: Date.now() };
}

/** Tutup blok: ganti label jadi durasi, atau buang kalau tidak ada isinya. */
function finishThinking(info) {
  if (!info) return;
  info.wrap.classList.remove('active');

  // Model tidak berpikir sama sekali — jangan tinggalkan baris kosong.
  if (!info.chars) {
    info.wrap.remove();
    return;
  }

  const detik = Math.max(1, Math.round((Date.now() - info.startedAt) / 1000));
  info.label.textContent = t('chat.penalaran', { detik });
}

/**
 * Pendekkan nama file dari tengah, bukan dari ekor: akhiran nama justru bagian
 * yang paling membedakan (ekstensi, dan pada tempelan juga kode acaknya).
 * "tempelan-2026-09-02-15-19-25-1xlk.png" -> "tempelan-2026…-1xlk.png"
 */
function namaPendek(nama, batas) {
  const n = String(nama || '');
  if (n.length <= batas) return n;
  const ekor = Math.max(6, Math.floor(batas / 3));
  return `${n.slice(0, batas - ekor - 1)}…${n.slice(-ekor)}`;
}

function addUserMessage(text, attachments, opts) {
  const wrap = el('div', 'msg user');
  const bubble = el('div', 'bubble');

  // Semua lampiran — termasuk gambar — tampil sebagai satu baris teks.
  // Pratinjau gambar sempat dipakai, tapi begitu satu pesan membawa lebih dari
  // satu gambar, tingginya berbeda-beda dan gelembungnya jadi berantakan.
  // Isinya toh tetap utuh dikirim ke model; yang hilang cuma pratinjaunya.
  const daftar = attachments || [];
  // Satu lampiran boleh tampil utuh — yang bikin gelembung melebar adalah
  // tumpukan nama panjang yang sejajar, jadi pemotongan baru berlaku dari dua.
  const batas = daftar.length > 1 ? 24 : 60;
  for (const a of daftar) {
    const baris = el('div', 'msg-file');
    baris.append(ikon(a.kind === 'image' ? 'image' : 'file-text'));
    baris.append(el('span', '', `${namaPendek(a.name, batas)}${a.error ? ` — ${a.error}` : ''}`));
    // Nama utuhnya tetap bisa dilihat lewat tooltip.
    baris.title = a.name;
    bubble.append(baris);
  }

  const isi = el('div', 'msg-text');
  // Pesan yang datang dari Telegram diberi penanda kecil, supaya jelas ini
  // bukan sesuatu yang kamu ketik di jendela ini.
  if (opts && opts.dariHp) isi.append(ikon('smartphone', 'dari-hp'));
  isi.append(text);
  bubble.append(isi);
  wrap.append(bubble);
  append(wrap);
  scroll();
}

// --- Indikator konteks ---------------------------------------------------

/** Status bar di bawah komposer: sisa konteks + rincian token giliran terakhir. */
function renderUsage(u) {
  const used = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
  const win = u.contextWindow || 0;
  const bar = $('statusbar');

  if (win > 0) {
    const leftPct = Math.max(0, Math.round((1 - used / win) * 100));
    $('sb-left').textContent = `${leftPct}% left`;
    $('sb-used').textContent = `${fmtTokens(used)} / ${fmtTokens(win)}`;
    bar.classList.toggle('warn', leftPct <= 20);
  } else {
    $('sb-left').textContent = '—';
    $('sb-used').textContent = fmtTokens(used);
    bar.classList.remove('warn');
  }

  $('sb-fresh').textContent = fmtTokens(u.input || 0);
  $('sb-cread').textContent = fmtTokens(u.cacheRead || 0);
  $('sb-cwrite').textContent = fmtTokens(u.cacheWrite || 0);
  $('sb-out').textContent = fmtTokens(u.output || 0);
}

/** Kembalikan status bar ke placeholder (dipakai saat ganti / buat proyek). */
function resetUsage() {
  $('statusbar').classList.remove('warn');
  for (const id of ['sb-left', 'sb-used', 'sb-fresh', 'sb-cread', 'sb-cwrite', 'sb-out']) {
    $(id).textContent = '—';
  }
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}

/**
 * Kartu tool dikumpulkan ke satu grup selama tidak diselingi teks. Grupnya
 * punya kepala yang bisa diklik, dan menutup sendiri saat giliran selesai
 * kalau isinya banyak — supaya belasan kartu tidak memenuhi layar.
 */
function toolGroup() {
  if (currentToolGroup) return currentToolGroup;

  const wrap = el('div', 'tool-group');
  const head = el('button', 'group-head');
  head.append(el('span', 'think-chevron', '›'));
  const label = el('span', 'group-label', '');
  head.append(label);
  const total = el('span', 'group-total', '');
  head.append(total);
  head.onclick = () => wrap.classList.toggle('collapsed');

  const list = el('div', 'group-list');
  wrap.append(head, list);
  append(wrap);

  currentToolGroup = { wrap, label, total, list, count: 0, tokens: 0 };
  return currentToolGroup;
}

/** Tutup grup yang sedang berjalan; lipat otomatis kalau isinya banyak. */
function closeToolGroup() {
  const g = currentToolGroup;
  currentToolGroup = null;
  if (!g) return;

  // Jangan sembunyikan grup yang masih punya tool berjalan (mis. subagent
  // Task yang lama) — kartunya yang belum selesai justru satu-satunya
  // petunjuk bahwa prosesnya masih hidup.
  const masihJalan = g.list.querySelector('.tool:not(.ok):not(.fail)');
  if (g.count > 2 && !masihJalan) g.wrap.classList.add('collapsed');
}

function addToolCard(ev) {
  finishThinking(currentThinking);
  currentBubble = null;
  currentThinking = null;

  const group = toolGroup();
  group.count++;
  group.label.textContent = t('chat.langkahTool', { jumlah: group.count });

  const card = el('div', 'tool');
  const head = el('div', 'tool-head');
  head.append(el('span', 'dot'));
  head.append(el('span', 'name', ev.name));
  head.append(el('span', 'summary', summarize(ev.input)));
  head.onclick = () => card.classList.toggle('open');

  const body = el('div', 'tool-body');
  body.append(el('span', 'label', 'input'));
  body.append(document.createTextNode(JSON.stringify(ev.input, null, 2)));

  card.append(head, body);
  group.list.append(card);
  toolCards.set(ev.id, { card, body, group });
  scroll();
}

function finishToolCard(ev) {
  const entry = toolCards.get(ev.id);
  if (!entry) return;
  entry.card.classList.add(ev.ok ? 'ok' : 'fail');

  // Tunjukkan seberapa besar hasil tool ini — biang konteks boros biasanya
  // kelihatan di sini (perkiraan kasar: ~4 karakter per token).
  const chars = String(ev.output || '').length;
  const est = Math.round(chars / 4);
  const size = el('span', 'tool-size', `~${fmtTokens(est)} tok`);
  if (est >= 5000) size.classList.add('big');
  size.title = `${chars.toLocaleString('id-ID')} karakter hasil tool`;
  entry.card.querySelector('.tool-head').append(size);

  // Jumlahkan ke kepala grup, supaya saat terlipat totalnya tetap terlihat.
  if (entry.group) {
    entry.group.tokens += est;
    entry.group.total.textContent = `~${fmtTokens(entry.group.tokens)} tok`;
  }
  entry.body.append(el('span', 'label', ev.ok ? 'output' : 'error'));
  entry.body.append(document.createTextNode(ev.output));
  if (!ev.ok) entry.card.classList.add('open');
  scroll();
}

/**
 * Setelah pesan asisten selesai: tambahkan tombol salin, dan ubah daftar
 * pilihan jadi tombol yang bisa langsung diklik.
 *
 * Yang dikenali sebagai pilihan (tiap baris berdiri sendiri):
 *   - [] teks        <- format Traycer
 *   - [ ] teks
 *   1. teks / - teks  <- hanya di dalam blok <options>...</options>
 */
function finalizeAssistant(bubble) {
  const raw = bubble.dataset.raw || '';
  const { body, options } = extractOptions(raw);

  renderMarkdown(bubble, body);

  if (!options.length) return;

  const box = el('div', 'suggestions');
  for (const opt of options) {
    const row = el('div', 'suggestion');

    const go = el('button', 'suggestion-send');
    go.append(el('span', 'arrow', '→'));
    go.append(el('span', '', opt));
    go.title = t('opsi.klik');
    go.onclick = () => send(opt);
    row.append(go);

    row.append(makeCopyButton(opt, t('opsi.salin')));
    box.append(row);
  }
  bubble.append(box);
}

function makeCopyButton(text, title) {
  const btn = el('button', 'copy-btn', t('opsi.salin'));
  btn.title = title;
  btn.onclick = async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    const before = btn.textContent;
    btn.textContent = 'Tersalin';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = before;
      btn.classList.remove('done');
    }, 1200);
  };
  return btn;
}

/** Pisahkan daftar pilihan dari badan jawaban. */
function extractOptions(raw) {
  const options = [];

  // Blok <options>…</options>: tiap baris daftar di dalamnya jadi pilihan.
  let body = raw.replace(/<options>([\s\S]*?)<\/options>/gi, (_m, inner) => {
    for (const line of inner.split('\n')) {
      const baris = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim();
      if (baris) options.push(baris);
    }
    return '';
  });

  // Baris "- [] teks" / "- [ ] teks" di mana pun.
  body = body
    .split('\n')
    .filter((line) => {
      const m = /^\s*[-*]\s*\[\s*\]\s+(.*\S)\s*$/.exec(line);
      if (!m) return true;
      options.push(m[1].trim());
      return false;
    })
    .join('\n');

  return { body: body.trim(), options };
}

function summarize(input) {
  if (!input) return '';
  const v = input.command || input.path || input.query || input.url || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 90);
}

// --- Konfirmasi tool ---------------------------------------------------

// --- Pertanyaan pilihan dari agen ---------------------------------------

/**
 * Kartu pertanyaan dirender INLINE di chat, bukan sebagai modal.
 *
 * Alasannya: pertanyaan ini milik satu percakapan tertentu dan agen benar-benar
 * berhenti menunggu jawabannya. Modal melayang akan hilang begitu kamu pindah
 * proyek dan pertanyaannya jadi tak terjawab selamanya — persis keluhan yang
 * diperbaiki di sini.
 */
function receiveQuestion(payload) {
  const id = payload.sessionId || activeSessionId;
  const antrean = questionQueue.get(id) || [];
  antrean.push(payload);
  questionQueue.set(id, antrean);
  markBusyRows();
  if (id === activeSessionId) renderQuestionCard(payload);
}

/** Gambar ulang pertanyaan yang masih menunggu di proyek yang baru dibuka. */
function renderPendingQuestions() {
  for (const p of questionQueue.get(activeSessionId) || []) renderQuestionCard(p);
}

function dropQuestion(sessionId, questionId) {
  const antrean = questionQueue.get(sessionId) || [];
  const sisa = antrean.filter((p) => p.id !== questionId);
  if (sisa.length) questionQueue.set(sessionId, sisa);
  else questionQueue.delete(sessionId);
  markBusyRows();
}

function renderQuestionCard(payload) {
  const card = el('div', 'qcard');
  card.dataset.qid = payload.id;
  card.append(el('div', 'qcard-title', t('tanya.judul')));

  // Satu entri per pertanyaan: { question, pilih: Set<string>, lainnya: string }
  const state = [];

  for (const q of payload.questions || []) {
    const blok = el('div', 'qblock');
    if (q.header) blok.append(el('span', 'qchip', q.header));
    blok.append(el('div', 'qtext', q.question));

    const entri = { question: q.question, multi: !!q.multiSelect, pilih: new Set(), lainnya: '' };
    state.push(entri);

    const opsi = el('div', 'qoptions');
    for (const o of q.options || []) {
      const btn = el('button', 'qopt');
      btn.append(el('span', 'qopt-label', o.label));
      if (o.description) btn.append(el('span', 'qopt-desc', o.description));
      btn.onclick = () => {
        if (entri.multi) {
          // Pilihan ganda: klik = nyalakan/matikan.
          if (entri.pilih.has(o.label)) entri.pilih.delete(o.label);
          else entri.pilih.add(o.label);
          btn.classList.toggle('picked', entri.pilih.has(o.label));
        } else {
          entri.pilih = new Set([o.label]);
          for (const lain of opsi.querySelectorAll('.qopt')) lain.classList.remove('picked');
          btn.classList.add('picked');
        }
        syncKirim();
      };
      opsi.append(btn);
    }
    blok.append(opsi);

    // "Lainnya": tool ini sengaja tidak menyertakan opsi bebas, jadi kita yang
    // menyediakannya — jawaban yang benar sering kali bukan salah satu opsi.
    const lain = document.createElement('input');
    lain.className = 'qother';
    lain.placeholder = 'Atau tulis jawabanmu sendiri…';
    lain.oninput = () => {
      entri.lainnya = lain.value.trim();
      syncKirim();
    };
    lain.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!kirim.disabled) kirim.click();
      }
    };
    blok.append(lain);

    card.append(blok);
  }

  const aksi = el('div', 'qactions');
  const kirim = el('button', 'qsend', t('tanya.kirim'));
  const lewati = el('button', 'qskip', 'Lewati');
  aksi.append(kirim, lewati);
  card.append(aksi);

  // Jawaban satu pertanyaan = teks bebas kalau diisi, kalau tidak label pilihan.
  const jawabanUntuk = (e) => (e.lainnya ? e.lainnya : [...e.pilih].join(', '));
  function syncKirim() {
    kirim.disabled = !state.every((e) => jawabanUntuk(e));
  }
  syncKirim();

  const selesai = async (answers) => {
    card.classList.add('answered');
    for (const b of card.querySelectorAll('button, input')) b.disabled = true;
    dropQuestion(payload.sessionId || activeSessionId, payload.id);
    await window.api.answer(payload.id, answers);
  };

  kirim.onclick = () => {
    const answers = {};
    for (const e of state) answers[e.question] = jawabanUntuk(e);
    // Tampilkan yang dipilih, supaya riwayat chat tetap terbaca nanti.
    aksi.replaceChildren(el('span', 'qdone', `✓ ${Object.values(answers).join(' · ')}`));
    selesai(answers);
  };

  lewati.onclick = () => {
    aksi.replaceChildren(el('span', 'qdone', '— dilewati'));
    selesai(null);
  };

  closeToolGroup();
  append(card);
  scroll();
}

/**
 * Terima permintaan izin dari proyek mana pun.
 *
 * Yang datang dari proyek latar tidak langsung memunculkan modal — ia mengantre
 * dan sidebar menandai proyeknya, supaya kamu tidak menyetujui perintah untuk
 * proyek yang tidak sedang kamu lihat. Agennya menunggu di sana sampai dijawab.
 */
function queueApproval(payload) {
  const id = payload.sessionId || activeSessionId;
  const antrean = approvalQueue.get(id) || [];
  antrean.push(payload);
  approvalQueue.set(id, antrean);
  markBusyRows();
  showNextApproval();
}

function dropQueuedApproval(sessionId, approvalId) {
  const antrean = approvalQueue.get(sessionId);
  if (!antrean) return;
  const sisa = antrean.filter((p) => p.id !== approvalId);
  if (sisa.length) approvalQueue.set(sessionId, sisa);
  else approvalQueue.delete(sessionId);
  markBusyRows();
}

/** Munculkan permintaan izin berikutnya milik proyek yang sedang dibuka. */
function showNextApproval() {
  if (shownApprovalId) return; // satu modal saja pada satu waktu
  const antrean = approvalQueue.get(activeSessionId);
  if (!antrean || !antrean.length) return;
  showApproval(antrean[0]);
}

function showApproval(payload) {
  const overlay = $('approval-overlay');
  shownApprovalId = payload.id;
  $('approval-desc').textContent = `Tool: ${payload.name}`;
  $('approval-body').textContent =
    payload.input.command || JSON.stringify(payload.input, null, 2);
  overlay.hidden = false;

  const decide = async (decision) => {
    overlay.hidden = true;
    shownApprovalId = null;
    dropQueuedApproval(payload.sessionId || activeSessionId, payload.id);
    await window.api.approve(payload.id, decision);
    // Proyek yang sama bisa menumpuk beberapa permintaan dalam satu giliran.
    showNextApproval();
  };
  $('a-allow').onclick = () => decide('allow');
  $('a-deny').onclick = () => decide('deny');
  $('a-always').onclick = () => decide('always');
}

// --- Pengaturan --------------------------------------------------------

/** Provider berbasis login tidak punya field API key. */
// --- Endpoint custom (OpenAI-compatible) --------------------------------

/** Entri mentah dari settings.json, bukan objek provider hasil olahan. */
function endpointTersimpan() {
  return Array.isArray(cfg.customProviders) ? cfg.customProviders : [];
}

/** null = bikin baru; selain itu = ubah endpoint yang sudah ada. */
function bukaFormEndpoint(p) {
  const ada = p ? endpointTersimpan().find((c) => c.id === p.id) : null;

  // Formulirnya ada di dalam bagian "Provider & model". Kalau bagian itu sedang
  // terlipat, formulirnya terbuka di tempat yang tidak terlihat — jadi bagiannya
  // ikut dibuka.
  const sec = $('sec-provider');
  if (sec) sec.open = true;

  $('s-ep-box').dataset.editId = ada ? ada.id : '';
  $('s-ep-title').textContent = ada
    ? t('set.epJudulUbah', { nama: ada.label })
    : t('set.epJudulBaru');
  // Endpoint baru sengaja dibiarkan kosong. Contoh ONToken-nya muncul sebagai
  // teks bayangan (placeholder) di index.html, bukan nilai yang ikut tersimpan.
  $('s-ep-label').value = ada ? ada.label || '' : '';
  $('s-ep-url').value = ada ? ada.baseURL || '' : '';
  $('s-ep-key').value = ada ? (cfg.keys && cfg.keys[ada.id]) || '' : '';
  $('s-ep-delete').hidden = !ada;
  $('s-ep-box').hidden = false;
  $('s-ep-label').focus();
}

function tutupFormEndpoint() {
  $('s-ep-box').hidden = true;
  $('s-ep-box').dataset.editId = '';
}

/**
 * Rapikan base URL sebelum disimpan.
 * Kesalahan paling sering: menempelkan "/chat/completions" di ujung, yang
 * membuat aplikasi memanggil ".../chat/completions/chat/completions".
 */
function rapikanBaseURL(raw) {
  let u = String(raw || '').trim().replace(/\s+/g, '');
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/(chat\/completions|completions|models)$/i, '');
  return u;
}

/** "Server Kantor" -> "custom-server-kantor", dijamin belum terpakai. */
function bikinIdEndpoint(label) {
  const dasar =
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'endpoint';
  const terpakai = new Set(providerList.map((p) => p.id));
  let id = `custom-${dasar}`;
  for (let n = 2; terpakai.has(id); n++) id = `custom-${dasar}-${n}`;
  return id;
}

async function simpanEndpoint() {
  const note = $('s-ep-note');
  const label = $('s-ep-label').value.trim();
  const baseURL = rapikanBaseURL($('s-ep-url').value);

  if (!label) return void (note.textContent = t('ep.namaKosong'));
  if (!/^https?:\/\/.+/i.test(baseURL)) {
    note.textContent = t('ep.urlSalah');
    return;
  }

  const editId = $('s-ep-box').dataset.editId;
  const daftar = endpointTersimpan();
  const lama = daftar.find((c) => c.id === editId);
  const entri = {
    // Saat mengubah, id lama dipertahankan meski namanya berganti — id inilah
    // kunci penyimpanan API key, jadi menggantinya membuat key jadi yatim.
    id: editId || bikinIdEndpoint(label),
    label,
    baseURL,
    // Tidak ada kolomnya di formulir: nilai bawaan (8192 / 128000) dipakai oleh
    // providers/index.js. Tetap diteruskan kalau entri lama sempat punya nilai
    // sendiri, supaya menyunting nama tidak diam-diam mengubah perilakunya.
    ...(lama && lama.maxTokens ? { maxTokens: lama.maxTokens } : {}),
    ...(lama && lama.contextWindow ? { contextWindow: lama.contextWindow } : {}),
  };

  const baru = editId
    ? daftar.map((c) => (c.id === entri.id ? entri : c))
    : [...daftar, entri];

  // Key ikut disimpan di sini supaya "Muat ulang" langsung bisa dipakai —
  // kolom API Key di bawah baru terisi setelah provider ini jadi yang aktif.
  cfg = await window.api.saveConfig({
    customProviders: baru,
    keys: { [entri.id]: $('s-ep-key').value.trim() },
  });
  providerList = await window.api.listProviders();
  fillProviderSelects();

  $('s-provider').value = entri.id;
  fillModelSelect($('s-model'), entri.id, cfg.model);
  syncKeyField(providerOf(entri.id));
  bukaFormEndpoint(providerOf(entri.id));
  note.textContent = t('ep.tersimpan');
}

async function hapusEndpoint() {
  const id = $('s-ep-box').dataset.editId;
  if (!id) return;
  const p = providerOf(id);
  if (!konfirmasi(t('tanya.hapusEndpoint', { nama: p.label }))) return;

  // Dikosongkan, bukan dihapus: config.save memakai deepMerge, jadi field yang
  // sekadar dihilangkan dari patch akan tetap hidup dari nilai lamanya.
  const keys = { ...(cfg.keys || {}), [id]: '' };
  const patch = {
    customProviders: endpointTersimpan().filter((c) => c.id !== id),
    keys,
  };
  // Provider yang sedang dipakai baru saja lenyap — pindahkan ke bawaan,
  // kalau tidak proyek berikutnya dibuka dengan provider yang tidak ada.
  if (cfg.provider === id) {
    patch.provider = 'claude-code';
    patch.model = '';
  }

  cfg = await window.api.saveConfig(patch);
  providerList = await window.api.listProviders();
  fillProviderSelects();
  tutupFormEndpoint();

  $('s-provider').value = cfg.provider;
  fillModelSelect($('s-model'), cfg.provider, cfg.model);
  syncKeyField(providerOf(cfg.provider));
  syncHeader();
}

// --- Server MCP --------------------------------------------------------

/** Keadaan server dari proses main, disegarkan tiap panel dibuka. */
let mcpStatus = [];

function mcpTersimpan() {
  return Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
}

/**
 * "npx -y @scope/paket C:\folder kerja" -> ['-y', '@scope/paket', 'C:\folder kerja']
 * Dipisah spasi, tapi menghormati tanda kutip: path Windows berspasi itu lumrah.
 */
function pecahArgs(raw) {
  const keluar = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(raw || '')))) keluar.push(m[1] ?? m[2] ?? m[3]);
  return keluar;
}

function gabungArgs(args) {
  return (args || []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
}

function pecahEnv(raw) {
  const keluar = {};
  for (const potong of pecahArgs(raw)) {
    const i = potong.indexOf('=');
    if (i > 0) keluar[potong.slice(0, i)] = potong.slice(i + 1);
  }
  return keluar;
}

function gabungEnv(env) {
  return Object.entries(env || {})
    .map(([k, v]) => (/\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`))
    .join(' ');
}

/** URL di kolom perintah = server HTTP; selain itu program yang dijalankan. */
function mcpLewatHttp(cmd) {
  return /^https?:\/\//i.test(String(cmd || '').trim());
}

/**
 * Bentuk formulir mengikuti isi kolom perintah.
 * Server HTTP tidak punya argumen baris perintah, dan kolom ketiganya berganti
 * makna: variabel lingkungan untuk stdio, header HTTP untuk yang lain.
 */
function syncBentukMcp() {
  const http = mcpLewatHttp($('s-mcp-cmd').value);
  $('s-mcp-args-row').hidden = http;
  $('s-mcp-env').placeholder = http ? t('set.mcpHeaderPh') : t('set.mcpEnvPh');
}

function bikinIdMcp(label) {
  const dasar =
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'server';
  const terpakai = new Set(mcpTersimpan().map((s) => s.id));
  let id = dasar;
  for (let n = 2; terpakai.has(id); n++) id = `${dasar}-${n}`;
  return id;
}

function teksStatusMcp(spec) {
  if (spec.enabled === false) return { teks: t('set.mcpNonaktif'), kelas: 'mati' };
  const st = mcpStatus.find((s) => s.id === spec.id);
  if (!st) return { teks: t('set.mcpMati'), kelas: 'mati' };
  if (st.status === 'siap')
    return { teks: t('set.mcpSiap', { jumlah: st.tools.length }), kelas: 'siap' };
  if (st.status === 'menyala') return { teks: t('set.mcpMenyala'), kelas: 'mati' };
  if (st.status === 'galat') return { teks: t('set.mcpGalat'), kelas: 'galat', pesan: st.error };
  return { teks: t('set.mcpMati'), kelas: 'mati' };
}

function gambarDaftarMcp() {
  const wrap = $('s-mcp-list');
  if (!wrap) return;
  wrap.textContent = '';

  const daftar = mcpTersimpan();
  if (!daftar.length) {
    wrap.append(el('div', 'note', t('set.mcpBelumAda')));
    return;
  }

  for (const spec of daftar) {
    const st = teksStatusMcp(spec);
    const baris = el('div', 'mcp-row');

    // Saklar aktif/mati per server, supaya server yang sedang tidak dipakai bisa
    // ditidurkan tanpa kehilangan setelannya.
    const saklar = document.createElement('input');
    saklar.type = 'checkbox';
    saklar.checked = spec.enabled !== false;
    saklar.onclick = (e) => e.stopPropagation();
    saklar.onchange = async () => {
      cfg = await window.api.saveConfig({
        mcpServers: mcpTersimpan().map((s) =>
          s.id === spec.id ? { ...s, enabled: saklar.checked } : s
        ),
      });
      if (!saklar.checked) await window.api.mcpDisconnect(spec.id);
      await segarkanMcp();
    };
    baris.append(saklar);

    const nama = el('span', 'mcp-nama', spec.label || spec.id);
    baris.append(nama);

    const status = el('span', `mcp-status ${st.kelas}`, st.teks);
    if (st.pesan) status.title = st.pesan;
    baris.append(status);

    const ubah = el('button', 'btn kecil', t('set.mcpJudul'));
    ubah.onclick = () => bukaFormMcp(spec);
    baris.append(ubah);

    wrap.append(baris);

    // Pesan galat ditampilkan utuh, bukan cuma sebagai tooltip: isinya biasanya
    // stderr dari servernya sendiri, dan di situlah sebab sebenarnya tertulis.
    if (st.kelas === 'galat' && st.pesan) {
      wrap.append(el('div', 'note mcp-galat', st.pesan));
    }
  }
}

/** Semua nilai env/header harus string — JSON orang lain sering berisi angka. */
function petaTeks(obj) {
  const keluar = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && typeof v !== 'object') keluar[k] = String(v);
    }
  }
  return keluar;
}

/** Id yang stabil dari nama, supaya mengimpor ulang MEMPERBARUI, bukan menggandakan. */
function idDariNama(nama) {
  return (
    String(nama)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'server'
  );
}

/**
 * Baca blok konfigurasi MCP milik ekosistem lain.
 *
 * Tidak ada satu bentuk baku. Yang beredar setidaknya:
 *   { "mcpServers": { "nama": {…} } }   — Claude Desktop, Cursor, dsb.
 *   { "servers":    { "nama": {…} } }   — VS Code
 *   { "nama": {…} }                     — potongan tanpa pembungkus
 *   { "url": … } / { "command": … }     — satu server telanjang
 * Keempatnya diterima; yang tidak punya url/command diabaikan diam-diam.
 */
function bacaJsonMcp(teks) {
  const data = JSON.parse(teks);
  if (!data || typeof data !== 'object') throw new Error('bukan objek');

  let peta = data.mcpServers || data.servers || data;
  // Satu server telanjang tanpa nama — beri nama sementara.
  if (peta && (peta.url || peta.command)) peta = { server: peta };

  const keluar = [];
  const dipakai = new Set();
  for (const [nama, isi] of Object.entries(peta || {})) {
    if (!isi || typeof isi !== 'object' || Array.isArray(isi)) continue;

    // Nama field URL berbeda-beda antar klien.
    const url = isi.url || isi.httpUrl || isi.serverUrl || isi.endpoint || '';
    const command = String(url || isi.command || '').trim();
    if (!command) continue;

    const http = mcpLewatHttp(command);
    let id = idDariNama(nama);
    // Tabrakan DI DALAM satu tempelan; tabrakan dengan yang sudah tersimpan
    // justru disengaja — itulah cara memperbarui entri lama.
    for (let n = 2; dipakai.has(id); n++) id = `${idDariNama(nama)}-${n}`;
    dipakai.add(id);

    keluar.push({
      id,
      label: String(nama),
      command,
      args: http || !Array.isArray(isi.args) ? [] : isi.args.map(String),
      env: http ? {} : petaTeks(isi.env),
      headers: http ? petaTeks(isi.headers) : {},
      // VS Code memakai "disabled", yang lain "enabled". Bawaannya menyala.
      enabled: isi.enabled !== false && isi.disabled !== true,
    });
  }
  return keluar;
}

function bukaFormJsonMcp() {
  const sec = $('sec-mcp');
  if (sec) sec.open = true;
  tutupFormMcp();
  $('s-mcp-json').value = '';
  $('s-mcp-json-note').textContent = t('set.mcpJsonNote');
  $('s-mcp-json-box').hidden = false;
  $('s-mcp-json').focus();
}

async function imporJsonMcp() {
  const note = $('s-mcp-json-note');
  let masuk;
  try {
    masuk = bacaJsonMcp($('s-mcp-json').value);
  } catch (err) {
    note.textContent = t('set.mcpJsonSalah', { pesan: err?.message || String(err) });
    return;
  }
  if (!masuk.length) {
    note.textContent = t('set.mcpJsonKosong');
    return;
  }

  // Entri stdio menjalankan program di komputer ini begitu tersambung. Yang
  // ditempel dari internet belum tentu dibaca isinya lebih dulu, jadi
  // perintahnya ditunjukkan dan dimintakan persetujuan sebelum disimpan.
  const lokal = masuk.filter((s) => !mcpLewatHttp(s.command));
  if (lokal.length) {
    const daftar = lokal
      .map((s) => `• ${s.command} ${gabungArgs(s.args)}`.trimEnd())
      .join('\n');
    if (!konfirmasi(t('set.mcpTanyaJalankan', { daftar }))) return;
  }

  // Id yang sama = server yang sama: diperbarui di tempatnya, bukan digandakan.
  const lama = mcpTersimpan();
  const idBaru = new Set(masuk.map((s) => s.id));
  const gabungan = [...lama.filter((s) => !idBaru.has(s.id)), ...masuk];

  cfg = await window.api.saveConfig({ mcpServers: gabungan });
  $('s-mcp-json-box').hidden = true;

  for (const s of masuk) {
    if (s.enabled === false) continue;
    try {
      await window.api.mcpConnect(s.id);
    } catch {
      /* sebabnya tampil di daftar sebagai status galat */
    }
  }
  await segarkanMcp();
}

/** null = bikin baru; selain itu = ubah server yang sudah ada. */
function bukaFormMcp(spec) {
  const sec = $('sec-mcp');
  if (sec) sec.open = true;
  // Dua formulir di bagian yang sama — hanya satu yang boleh terbuka.
  $('s-mcp-json-box').hidden = true;

  $('s-mcp-box').dataset.editId = spec ? spec.id : '';
  $('s-mcp-title').textContent = spec
    ? t('set.mcpJudulUbah', { nama: spec.label || spec.id })
    : t('set.mcpJudulBaru');
  $('s-mcp-label').value = spec ? spec.label || '' : '';
  $('s-mcp-cmd').value = spec ? spec.command || '' : '';
  $('s-mcp-args').value = spec ? gabungArgs(spec.args) : '';
  // Kolom ketiga dipakai bergantian: env untuk stdio, header untuk HTTP.
  $('s-mcp-env').value = spec
    ? gabungEnv(mcpLewatHttp(spec.command) ? spec.headers : spec.env)
    : '';
  syncBentukMcp();
  $('s-mcp-delete').hidden = !spec;
  $('s-mcp-box').hidden = false;
  $('s-mcp-label').focus();
}

function tutupFormMcp() {
  $('s-mcp-box').hidden = true;
  $('s-mcp-box').dataset.editId = '';
}

async function simpanMcp() {
  const note = $('s-mcp-note');
  const label = $('s-mcp-label').value.trim();
  const command = $('s-mcp-cmd').value.trim();

  if (!label || !command) {
    note.textContent = t('set.mcpNamaKosong');
    return;
  }

  const editId = $('s-mcp-box').dataset.editId;
  const http = mcpLewatHttp(command);
  const pasangan = pecahEnv($('s-mcp-env').value);
  const entri = {
    // id dipertahankan saat mengubah: nama tool yang dilihat model dibangun dari
    // id ini, jadi menggantinya membuat semua tool servernya berganti nama.
    id: editId || bikinIdMcp(label),
    label,
    command,
    // Keduanya selalu ditulis, yang tidak dipakai dikosongkan — supaya entri
    // yang diubah dari HTTP ke stdio (atau sebaliknya) tidak menyimpan sisa
    // setelan lamanya yang sudah tidak berarti.
    args: http ? [] : pecahArgs($('s-mcp-args').value),
    env: http ? {} : pasangan,
    headers: http ? pasangan : {},
    enabled: true,
  };

  const daftar = mcpTersimpan();
  cfg = await window.api.saveConfig({
    mcpServers: editId ? daftar.map((s) => (s.id === entri.id ? entri : s)) : [...daftar, entri],
  });

  // Langsung dicoba sambungkan: kalau perintahnya salah ketik, kamu tahu
  // sekarang juga, bukan nanti di tengah giliran agen.
  await sambungkanMcp(entri.id, note);
  bukaFormMcp(entri);
}

async function hapusMcp() {
  const id = $('s-mcp-box').dataset.editId;
  if (!id) return;
  const spec = mcpTersimpan().find((s) => s.id === id);
  if (!konfirmasi(t('set.mcpTanyaHapus', { nama: (spec && spec.label) || id }))) return;

  await window.api.mcpDisconnect(id);
  cfg = await window.api.saveConfig({
    mcpServers: mcpTersimpan().filter((s) => s.id !== id),
  });
  tutupFormMcp();
  await segarkanMcp();
}

async function sambungkanMcp(id, note) {
  if (note) note.textContent = t('set.mcpMenyala');
  try {
    const hasil = await window.api.mcpConnect(id);
    if (note) note.textContent = t('set.mcpSiap', { jumlah: hasil.tools.length });
  } catch (err) {
    if (note) note.textContent = err?.message || String(err);
  }
  await segarkanMcp();
}

async function sambungkanSemuaMcp() {
  const btn = $('s-mcp-refresh');
  btn.disabled = true;
  try {
    for (const spec of mcpTersimpan()) {
      if (spec.enabled === false) continue;
      try {
        await window.api.mcpConnect(spec.id);
      } catch {
        /* sebabnya sudah tercatat di status server */
      }
    }
  } finally {
    btn.disabled = false;
  }
  await segarkanMcp();
}

async function segarkanMcp() {
  try {
    mcpStatus = await window.api.mcpStatus();
  } catch {
    mcpStatus = [];
  }
  gambarDaftarMcp();
  ringkasanBagian();
}

/**
 * Petunjuk "di mana ambil API key"-nya.
 *
 * Teksnya datang dari proses main (providers/index.js), tapi yang dibaca di
 * sini adalah versi terjemahannya kalau ada — provider bawaan punya kunci
 * `hint.<id>` di i18n.js. Kalau kuncinya tidak ada, t() mengembalikan nama
 * kuncinya sendiri; itulah yang dipakai sebagai penanda "pakai teks asli".
 */
function teksHint(p) {
  if (String(p.id).startsWith('custom-')) {
    const url = (endpointTersimpan().find((c) => c.id === p.id) || {}).baseURL || '';
    return t('hint.custom', { url });
  }
  const kunci = `hint.${p.id}`;
  const teks = t(kunci);
  return teks === kunci ? p.keyHint || '' : teks;
}

function syncKeyField(p) {
  const usesKey = !!p.keyField;
  const hint = teksHint(p);
  $('s-key-field').hidden = !usesKey;
  if (usesKey) {
    $('s-login-note').hidden = true;
    $('s-key').value = (cfg.keys && cfg.keys[p.keyField]) || '';
    $('s-key-hint').textContent = hint;
  } else {
    // Kotak kosong tetap menyisakan bingkai dan jarak; sembunyikan kalau
    // providernya memang tidak punya catatan apa pun.
    $('s-login-note').textContent = hint;
    $('s-login-note').hidden = !hint;
  }
}

/**
 * Deteksi Chat ID / tes kirim.
 *
 * Keduanya digabung karena bentuknya sama: matikan tombol, laporkan hasilnya di
 * baris keterangan, dan tampilkan pesan asli dari Telegram kalau gagal — pesan
 * itu ("chat not found", "Unauthorized") jauh lebih menolong daripada
 * "gagal" yang tidak menjelaskan apa pun.
 */
async function telegramAction(what) {
  const note = $('s-tg-note');
  const tombol = [$('s-tg-detect'), $('s-tg-test')];
  const token = $('s-tg-token').value.trim();

  if (!token) {
    note.textContent = t('tg.isiToken');
    return;
  }

  for (const b of tombol) b.disabled = true;
  note.textContent = what === 'detect' ? t('tg.mencari') : t('tg.mengirim');

  try {
    if (what === 'detect') {
      const hasil = await window.api.telegramDetect(token);
      $('s-tg-chat').value = hasil.chatId;
      const siapa = hasil.username ? `@${hasil.username}` : hasil.name || 'chat ini';
      note.textContent = t('tg.ketemu', { siapa, chatId: hasil.chatId });
    } else {
      const bot = await window.api.telegramTest(token, $('s-tg-chat').value.trim());
      note.textContent = `Terkirim lewat @${bot.username}. Cek Telegram di HP-mu.`;
    }
  } catch (err) {
    note.textContent = t('tg.gagal', { pesan: err?.message || err });
  } finally {
    for (const b of tombol) b.disabled = false;
  }
}

/** Tutup panel tanpa menyimpan. Formulir endpoint ikut ditutup supaya
 *  isian setengah jadi tidak menyambut kamu saat panel dibuka lagi. */
function tutupSettings() {
  tutupFormEndpoint();
  // Tema dan bahasa dicoba secara langsung, jadi Batal harus mengembalikan
  // keduanya. Kalau tidak, "batal" cuma membatalkan sebagian — yang lebih
  // membingungkan daripada tidak ada pratinjau sama sekali.
  terapkanTema(temaSebelumnya);
  if (bahasaSebelumnya !== bahasaTerpilih()) {
    setBahasa(bahasaSebelumnya);
    terapkanBahasa();
    syncPermButton();
    syncHeader();
    setBusy(busy);
    refreshSessionList();
  }
  $('settings-overlay').hidden = true;
}

/** Kartu-kartu pilihan tema. Dibangun ulang tiap panel dibuka. */
function isiPilihanTema(terpilih) {
  const kotak = $('s-theme-grid');
  kotak.replaceChildren();

  for (const tema of TEMA) {
    const kartu = el('button', 'theme-card' + (tema.id === terpilih ? ' selected' : ''));
    kartu.type = 'button';
    kartu.dataset.theme = tema.id;

    const strip = el('span', 'theme-swatch');
    for (const warna of tema.contoh) {
      const petak = el('span', 'theme-dot');
      petak.style.background = warna;
      strip.append(petak);
    }
    kartu.append(strip);
    kartu.append(el('span', 'theme-name', tema.nama));

    kartu.onclick = () => {
      terapkanTema(tema.id);
      for (const lain of kotak.querySelectorAll('.theme-card')) {
        lain.classList.toggle('selected', lain.dataset.theme === tema.id);
      }
      ringkasanBagian();
    };
    kotak.append(kartu);
  }
}

/** Tema yang sedang dipilih di panel — dibaca dari kartu, bukan dari config,
 *  karena pilihannya belum tentu sudah disimpan. */
function temaTerpilih() {
  const aktif = $('s-theme-grid').querySelector('.theme-card.selected');
  return aktif ? aktif.dataset.theme : 'catppuccin';
}

/* --- Login Claude Code ------------------------------------------------------
   Menggantikan "buka terminal, ketik claude login". Aplikasi menjalankan alat
   login RESMI yang sudah ikut dibawa SDK, membuka URL-nya di browser, lalu
   meneruskan kode yang kamu tempel ke stdin proses itu. Alur OAuth-nya tetap
   milik Anthropic — kita cuma yang mengetikkan. */

let ccSedangLogin = false;

/**
 * Perintah pemasangan resmi Claude Code untuk Windows.
 *
 * Langkah "setx PATH" yang biasa menyertainya sengaja TIDAK dicantumkan:
 * aplikasi ini sudah mencari langsung ke %USERPROFILE%\.local\bin, tempat
 * installer itu menaruh binary-nya. Satu langkah lebih sedikit, dan tidak ada
 * risiko pengguna merusak PATH-nya sendiri dengan setx.
 */
const CC_PERINTAH_PASANG =
  'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd';

/** Panel "belum terpasang". Dipanggil dari galat kirim dan dari Pengaturan. */
function bukaPanelPasangClaude() {
  $('cc-cmd-1').textContent = CC_PERINTAH_PASANG;
  $('cc-install-overlay').hidden = false;
}

async function segarkanStatusClaude() {
  const kotak = $('s-cc-box');
  // Hanya relevan untuk provider berbasis langganan.
  kotak.hidden = $('s-provider').value !== 'claude-code';
  if (kotak.hidden) return;

  const titik = $('s-cc-dot');
  const teks = $('s-cc-text');
  const aksi = $('s-cc-action');

  teks.textContent = t('cc.memeriksa');
  titik.className = 'cc-dot';
  aksi.hidden = true;

  // Jembatan preload berubah bersama fitur ini. Kalau aplikasinya cuma di-Ctrl+R
  // dan bukan direstart penuh, fungsinya belum ada — tanpa penjagaan ini
  // statusnya menggantung selamanya di "Memeriksa…" tanpa sebab yang kelihatan.
  let s;
  try {
    if (!window.api.claudeAuthStatus) throw new Error('preload lama');
    s = await window.api.claudeAuthStatus();
  } catch {
    titik.className = 'cc-dot bad';
    teks.textContent = t('cc.perluRestart');
    return;
  }

  if (!s.tersedia) {
    titik.className = 'cc-dot bad';
    teks.textContent = t('cc.takAdaExe');
    aksi.hidden = false;
    aksi.textContent = t('ccInstall.periksa');
    aksi.onclick = bukaPanelPasangClaude;
    return;
  }

  aksi.hidden = false;
  if (s.loggedIn) {
    titik.className = 'cc-dot ok';
    teks.textContent = t('cc.tersambung', { email: s.email, langganan: s.langganan });
    aksi.textContent = t('cc.keluar');
    aksi.onclick = async () => {
      await window.api.claudeLogout();
      segarkanStatusClaude();
    };
  } else {
    titik.className = 'cc-dot warn';
    teks.textContent = t('cc.belumLogin');
    aksi.textContent = t('cc.hubungkan');
    aksi.onclick = mulaiLoginClaude;
  }
}

async function mulaiLoginClaude() {
  if (ccSedangLogin) return;
  ccSedangLogin = true;

  $('s-cc-login').hidden = false;
  $('s-cc-log').textContent = '';
  $('s-cc-text').textContent = t('cc.menghubungkan');
  $('s-cc-action').hidden = true;
  $('s-cc-code').value = '';
  $('s-cc-code').focus();

  const hasil = await window.api.claudeLogin();
  if (!hasil.ok) {
    ccSedangLogin = false;
    $('s-cc-login').hidden = true;
    segarkanStatusClaude();
  }
}

function catatLogClaude(teks) {
  const log = $('s-cc-log');
  log.textContent += teks;
  // Selalu memperlihatkan baris terbaru; keluarannya bisa panjang.
  log.scrollTop = log.scrollHeight;
}

/** Kartu pilihan bahasa. Bentuknya sama dengan kartu tema, tanpa contoh warna. */
function isiPilihanBahasa(terpilih) {
  const kotak = $('s-lang-grid');
  kotak.replaceChildren();

  for (const b of BAHASA) {
    const kartu = el('button', 'theme-card lang-card' + (b.id === terpilih ? ' selected' : ''));
    kartu.type = 'button';
    kartu.dataset.lang = b.id;
    kartu.append(el('span', 'theme-name', b.nama));

    kartu.onclick = () => {
      setBahasa(b.id);
      // Seluruh panel digambar ulang di tempat — termasuk judul bagian dan
      // tombol Batal/Simpan, jadi hasilnya langsung terlihat utuh.
      terapkanBahasa();
      for (const lain of kotak.querySelectorAll('.lang-card')) {
        lain.classList.toggle('selected', lain.dataset.lang === b.id);
      }
      // Teks yang dibuat dari JS tidak ikut terapkanBahasa(); disegarkan sendiri.
      syncPermButton();
      syncHeader();
      setBusy(busy);
      refreshSessionList();
      ringkasanBagian();
    };
    kotak.append(kartu);
  }
}

function bahasaTerpilih() {
  const aktif = $('s-lang-grid').querySelector('.lang-card.selected');
  return aktif ? aktif.dataset.lang : 'id';
}

async function openSettings() {
  cfg = await window.api.getConfig();
  const p = providerOf(cfg.provider);

  temaSebelumnya = cfg.theme || 'catppuccin';
  bahasaSebelumnya = cfg.language || 'id';
  isiPilihanTema(temaSebelumnya);
  isiPilihanBahasa(bahasaSebelumnya);

  // Semua bagian ditutup tiap panel dibuka. Kalau statusnya dibiarkan bertahan,
  // panel yang tadi kamu bongkar akan menyambutmu terbuka lebar lagi.
  for (const sec of document.querySelectorAll('.sec')) sec.open = false;

  $('s-provider').value = cfg.provider;
  fillModelSelect($('s-model'), cfg.provider, cfg.model);
  syncKeyField(p);
  // Panel dibuka ulang: formulir endpoint ikut disetel dari nol, kalau tidak
  // ia masih memajang isian dari kunjungan sebelumnya.
  if (p.custom) bukaFormEndpoint(p);
  else tutupFormEndpoint();
  $('s-cwd').value = cfg.workingDir;
  $('s-system').value = cfg.systemPrompt;
  $('s-tavily').value = cfg.tavilyKey || '';
  $('s-lean').checked = !!cfg.leanContext;
  const tg = cfg.telegram || {};
  $('s-tg-token').value = tg.botToken || '';
  $('s-tg-chat').value = tg.chatId || '';
  $('s-tg-enabled').checked = !!tg.enabled;
  $('s-tg-notify').checked = !!tg.notifyDesktop;

  tutupFormMcp();
  $('s-mcp-json-box').hidden = true;
  // Tidak ditunggu: menanyakan keadaan server MCP tidak boleh menahan panel
  // terbuka. Daftarnya menyusul beberapa milidetik kemudian.
  segarkanMcp();

  ringkasanBagian();
  segarkanStatusClaude();
  $('settings-overlay').hidden = false;
}

/**
 * Ringkasan di kanan judul tiap bagian.
 *
 * Melipat pengaturan menyembunyikan isinya — termasuk jawaban atas pertanyaan
 * yang paling sering kamu bawa ke sini: "sekarang pakai provider apa?".
 * Ringkasan ini mengembalikan jawaban itu tanpa perlu membuka apa-apa.
 */
function ringkasanBagian() {
  const p = providerOf($('s-provider').value);
  const model = $('s-model').value;
  $('sec-provider-hint').textContent = model ? `${p.label} · ${model}` : p.label;

  // Jangan pernah menamai variabel lokal `t` di berkas ini: nama itu milik
  // fungsi penerjemah global dari i18n.js, dan menutupinya membuat panggilan
  // t('...') di baris berikutnya gagal sebagai "t is not a function".
  const tema = TEMA.find((x) => x.id === temaTerpilih());
  $('sec-tema-hint').textContent = tema ? tema.nama : '';

  const server = mcpTersimpan().filter((s) => s.enabled !== false);
  const siap = mcpStatus.filter((s) => s.status === 'siap').length;
  const hintMcp = $('sec-mcp-hint');
  if (hintMcp) {
    hintMcp.textContent = server.length
      ? t('set.mcpHint', { siap, total: server.length })
      : t('set.belumDisetel');
  }

  $('sec-telegram-hint').textContent = $('s-tg-enabled').checked
    ? t('set.aktif')
    : $('s-tg-token').value.trim()
      ? t('set.nonaktif')
      : t('set.belumDisetel');
}

/** Tarik daftar model asli dari provider dan simpan ke cache. */
async function refreshModels() {
  const providerId = $('s-provider').value;
  const btn = $('s-refresh-models');
  const note = $('s-model-note');

  // Endpoint baru belum punya identitas: providerOf() akan jatuh ke provider
  // pertama dan kita malah menarik daftar model milik provider yang salah.
  if (providerId === EP_BARU) {
    note.textContent = t('ep.simpanDulu');
    return;
  }

  btn.disabled = true;
  btn.textContent = t('model.memuat');
  note.textContent = t('model.menghubungi');

  try {
    // Simpan key dulu supaya fetch di main process memakai key terbaru.
    const p = providerOf(providerId);
    if (p.keyField) {
      // Endpoint custom punya kolom key sendiri di dalam formulirnya. Saat
      // formulir itu terbuka, kolom API Key di bawah bisa belum tersinkron —
      // memakainya berarti menimpa key yang benar dengan string kosong.
      const formEndpoint =
        !$('s-ep-box').hidden && $('s-ep-box').dataset.editId === providerId;
      const key = (formEndpoint ? $('s-ep-key').value : $('s-key').value).trim();
      cfg = await window.api.saveConfig({ keys: { [p.keyField]: key } });
    }
    const models = await window.api.fetchModels(providerId);
    cfg = await window.api.getConfig();
    fillModelSelect($('s-model'), providerId, $('s-model').value);
    // Pemilih di bar komposer memakai daftar yang sama — tanpa ini ia masih
    // memajang daftar bawaan sampai aplikasinya dibuka ulang.
    syncHeader();
    note.textContent = t('model.berhasil', { jumlah: models.length, provider: p.label });
  } catch (err) {
    note.textContent = t('model.gagal', { pesan: err?.message || err });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Muat ulang';
  }
}

async function saveSettings() {
  // Formulir endpoint masih terbuka dan belum disimpan: "+ Tambah endpoint
  // baru…" bukan provider, menyimpannya apa adanya akan merusak konfigurasi.
  if ($('s-provider').value === EP_BARU) {
    $('s-ep-note').textContent =
      t('ep.simpanDuluTombol');
    return;
  }

  const providerId = $('s-provider').value;
  const p = providerOf(providerId);

  cfg = await window.api.saveConfig({
    provider: providerId,
    model: $('s-model').value,
    workingDir: $('s-cwd').value.trim(),
    theme: temaTerpilih(),
    language: bahasaTerpilih(),
    systemPrompt: $('s-system').value,
    tavilyKey: $('s-tavily').value.trim(),
    leanContext: $('s-lean').checked,
    telegram: {
      botToken: $('s-tg-token').value.trim(),
      chatId: $('s-tg-chat').value.trim(),
      enabled: $('s-tg-enabled').checked,
      notifyDesktop: $('s-tg-notify').checked,
    },
    // Provider berbasis login tidak menyimpan key apa pun.
    ...(p.keyField ? { keys: { [p.keyField]: $('s-key').value.trim() } } : {}),
  });

  $('settings-overlay').hidden = true;
  syncHeader();

  // Terapkan sekarang juga — tidak perlu tutup-buka aplikasi hanya untuk
  // menyalakan atau mematikan jembatannya.
  try {
    const hasil = $('s-tg-enabled').checked
      ? await window.api.telegramStart()
      : await window.api.telegramStop();
    if ($('s-tg-enabled').checked && hasil && hasil.ok === false) {
      append(el('div', 'error-line', t('tg.gagalAktif', { alasan: hasil.reason })));
      scroll();
    }
  } catch (err) {
    append(el('div', 'error-line', `Telegram: ${err?.message || err}`));
    scroll();
  }
}

// --- Helper DOM --------------------------------------------------------

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function append(node) {
  const inner = $('chat-inner');
  // Sisipkan SEBELUM penanda berjalan, supaya penandanya tetap paling bawah.
  if (runningRow && runningRow.parentNode === inner) inner.insertBefore(node, runningRow);
  else inner.append(node);
}

/**
 * Apakah chat masih "menempel" di dasar?
 *
 * Selama true, tiap tambahan isi ikut menggulir turun. Begitu kamu menggulir
 * ke atas untuk membaca, ia jadi false dan agen boleh menulis sepanjang apa
 * pun tanpa menyeret layarmu kembali ke bawah.
 */
let lengket = true;

// Jarak dari dasar yang masih dianggap "di bawah". Longgar sedikit supaya
// pembulatan pecahan piksel dan baris yang baru tumbuh tidak salah dibaca
// sebagai "pengguna sengaja menggulir ke atas".
const AMBANG_DASAR = 48;

function jagaGulir() {
  const c = $('chat');
  c.addEventListener('scroll', () => {
    const jarak = c.scrollHeight - c.scrollTop - c.clientHeight;
    lengket = jarak <= AMBANG_DASAR;
    $('to-bottom').hidden = lengket;
  });
  $('to-bottom').onclick = () => scrollPaksa();
}

function scroll() {
  // Kamu sedang membaca ke atas — jangan diseret.
  if (!lengket) return;
  const c = $('chat');
  c.scrollTop = c.scrollHeight;
}

/** Turun ke dasar apa pun keadaannya: kamu sendiri yang memintanya. */
function scrollPaksa() {
  lengket = true;
  $('to-bottom').hidden = true;
  const c = $('chat');
  c.scrollTop = c.scrollHeight;
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  // Batas atas ikut .composer textarea di app.css; min-height di sana yang
  // menahan tinggi awalnya, jadi nilai kecil dari scrollHeight tidak mengecilkan.
  ta.style.height = Math.min(ta.scrollHeight, 360) + 'px';
}

/**
 * Markdown minimal: blok kode, inline code, bold, italic.
 * Semua teks di-escape dulu, jadi tidak ada HTML dari model yang dieksekusi.
 */
function renderMarkdown(node, raw) {
  node.innerHTML = markdownToHtml(raw);
}

/**
 * Markdown secukupnya: blok kode, tabel, judul, daftar, kutipan, garis,
 * plus format inline. Seluruh teks di-escape lebih dulu, jadi tidak ada HTML
 * dari model yang pernah dieksekusi.
 */
function markdownToHtml(raw) {
  const escaped = String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Blok kode disimpan dulu supaya isinya tidak ikut diproses sebagai markdown.
  const blocks = [];
  const withoutCode = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000BLOK${blocks.length - 1}\u0000`;
  });

  const lines = withoutCode.split('\n');
  const out = [];
  let paragraph = [];
  let list = null; // { tag: 'ul'|'ol', items: [] }

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ');
    paragraph = [];

    // Baris tunggal yang SELURUHNYA tebal = judul semu. Model sering menulis
    // "**Judul**" alih-alih "## Judul"; tanpa ini judulnya seukuran teks badan
    // dan halaman kehilangan hierarki.
    //
    // Dipetakan ke h2, bukan h3: baris seperti ini dipakai sebagai judul
    // TINGKAT ATAS, setara "## Judul". h3 hanya 1,24x teks badan — selisih
    // sekecil itu praktis tidak terlihat.
    const pseudoHeading = /^\*\*([^*]+)\*\*[:：]?$/.exec(text.trim());
    if (pseudoHeading) {
      const title = pseudoHeading[1].trim().replace(/[:：]$/, '');
      out.push(`<h2>${inline(title)}</h2>`);
      return;
    }
    out.push(`<p>${inline(text)}</p>`);
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Penanda blok kode yang tadi disimpan.
    if (/^\u0000BLOK\d+\u0000$/.test(line.trim())) {
      flushAll();
      out.push(blocks[Number(line.trim().match(/\d+/)[0])]);
      continue;
    }

    // Tabel: baris berpipa yang diikuti baris pemisah |---|---|
    if (line.trim().startsWith('|') && isTableSeparator(lines[i + 1])) {
      flushAll();
      const header = splitRow(line);
      const rows = [];
      i += 2; // lewati baris pemisah
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      out.push(
        '<table><thead><tr>' +
          header.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows
            .map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
            .join('') +
          '</tbody></table>'
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      // "#" dan "##" sama-sama jadi h2. Model hampir selalu memakai "##" untuk
      // judul utama; kalau dipetakan ke h3 semua judul jadi kecil.
      const level = Math.max(2, heading[1].length);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushAll();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return out.join('');
}

function isTableSeparator(line) {
  return !!line && /^\s*\|?[\s:-]*\|[\s|:-]*$/.test(line) && line.includes('-');
}

/** Pecah satu baris tabel jadi sel-selnya. */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Format inline: `code`, **tebal**, *miring*, [teks](url). */
function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
