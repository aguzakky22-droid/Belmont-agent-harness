'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { t } = require('./i18n');

/**
 * Penyimpanan sesi percakapan. Satu sesi = satu file JSON di
 * <userData>/sessions/<id>.json, berisi riwayat dalam format blok internal
 * (netral provider), jadi sesi lama tetap bisa dibuka setelah ganti model.
 */

function dir() {
  const d = path.join(app.getPath('userData'), 'sessions');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function fileFor(id) {
  // id dibuat sendiri di sini, tapi tetap disaring supaya tidak pernah bisa
  // dipakai untuk keluar dari folder sessions.
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`id sesi tidak valid: ${id}`);
  return path.join(dir(), `${id}.json`);
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sesi yang sedang dipegang di memori: id -> { data, dirty, timer, kotorSejak }.
 *
 * Kenapa perlu lapisan ini? Riwayat satu proyek bisa mencapai megabyte, dan
 * kemajuan kini disimpan tiap langkah agar proyek latar tidak tampak membeku.
 * Tanpa penyangga, tiap hasil tool memicu satu tulis SINKRON sebesar seluruh
 * riwayat — dan karena itu terjadi di proses main, SEMUA proyek yang sedang
 * berjalan ikut tertahan selama penulisan. Persis gejala yang mau dihindari.
 */
const store = new Map();

/** Ringkasan sidebar untuk proyek yang tidak sedang dibuka: id -> { mtimeMs, meta }. */
const metaCache = new Map();

// Tulis paling lambat 400 ms setelah perubahan terakhir, tapi jangan pernah
// menunda lebih dari 2 detik — rentetan langkah yang rapat bisa menggeser
// tenggatnya terus-menerus kalau tidak dibatasi.
const FLUSH_DELAY = 400;
const FLUSH_MAX = 2000;

function readFromDisk(id) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

function read(id) {
  const live = store.get(id);
  // Yang di memori selalu lebih baru daripada di disk saat masih ada tunggakan.
  if (live) return live.data;

  const data = readFromDisk(id);
  if (data) store.set(id, { data, dirty: false, timer: null, kotorSejak: 0 });
  return data;
}

function tulisSekarang(id) {
  const live = store.get(id);
  if (!live) return;
  clearTimeout(live.timer);
  live.timer = null;
  if (!live.dirty) return;
  live.dirty = false;
  live.kotorSejak = 0;
  fs.writeFileSync(fileFor(id), JSON.stringify(live.data, null, 2), 'utf8');
  metaCache.delete(id); // ringkasannya diambil dari memori selama sesi hidup
}

function jadwalkanTulis(id) {
  const live = store.get(id);
  if (!live) return;
  const now = Date.now();
  if (!live.kotorSejak) live.kotorSejak = now;

  // Sudah terlalu lama tertunda — tulis sekarang juga.
  if (now - live.kotorSejak >= FLUSH_MAX) {
    tulisSekarang(id);
    return;
  }
  clearTimeout(live.timer);
  live.timer = setTimeout(() => tulisSekarang(id), FLUSH_DELAY);
}

/** Paksa semua tunggakan ke disk. Wajib dipanggil sebelum aplikasi keluar. */
function flushAll() {
  for (const id of [...store.keys()]) tulisSekarang(id);
}

function write(session) {
  store.set(session.id, { data: session, dirty: true, timer: null, kotorSejak: 0 });
  tulisSekarang(session.id); // sesi baru: tulis langsung, jangan ditunda
  return session;
}

function ringkas(s) {
  return {
    id: s.id,
    title: s.title,
    workingDir: s.workingDir || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: (s.messages || []).length,
  };
}

/**
 * Daftar sesi tanpa isi pesan — cukup untuk sidebar.
 *
 * Dulu ini mem-parse SELURUH riwayat tiap proyek hanya untuk mengambil judul
 * dan waktunya. Sekarang proyek yang tidak sedang dibuka cukup dibaca sekali,
 * lalu ringkasannya dipakai ulang selama mtime filenya tidak berubah.
 */
function list() {
  const out = [];
  for (const f of fs.readdirSync(dir())) {
    if (!f.endsWith('.json')) continue;
    const id = path.basename(f, '.json');

    const live = store.get(id);
    if (live) {
      out.push(ringkas(live.data));
      continue;
    }

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(path.join(dir(), f)).mtimeMs;
    } catch {
      continue;
    }
    const cached = metaCache.get(id);
    if (cached && cached.mtimeMs === mtimeMs) {
      out.push(cached.meta);
      continue;
    }

    const s = readFromDisk(id);
    if (!s) continue;
    const meta = ringkas(s);
    metaCache.set(id, { mtimeMs, meta });
    out.push(meta);
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function create({ title, workingDir }) {
  const now = Date.now();
  return write({
    id: newId(),
    // Judul kosong = BELUM BERJUDUL, bukan judul harfiah. Sengaja tidak diisi
    // "Percakapan baru" di sini: yang tersimpan di berkas sesi tidak ikut
    // berubah saat bahasa antarmuka diganti, jadi sesi lama akan selamanya
    // berbahasa Indonesia. Teksnya diisi saat ditampilkan — judulSesi() di
    // bawah, dan padanannya di renderer.js.
    title: title || '',
    workingDir: workingDir || '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
}

function save(id, { messages, title, workingDir, resumeId, approvedTools, lastUsage }) {
  const existing = read(id);
  if (!existing) return null;
  if (messages) existing.messages = messages;
  // Dibandingkan dengan undefined, bukan sekadar truthy: string kosong adalah
  // nilai yang sah ("belum berjudul"), dan rename() memang mengirimnya.
  if (title !== undefined) existing.title = title;
  if (workingDir) existing.workingDir = workingDir;
  // id sesi Claude Code, supaya giliran berikutnya menyambung percakapan yang sama
  if (resumeId) existing.resumeId = resumeId;
  // tool yang dapat "selalu izinkan" — bertahan meski aplikasi ditutup
  if (approvedTools) existing.approvedTools = approvedTools;
  // pemakaian token giliran terakhir, supaya status bar tidak kosong lagi
  // setelah aplikasi ditutup dan dibuka kembali
  if (lastUsage) existing.lastUsage = lastUsage;
  existing.updatedAt = Date.now();

  // Perubahan langsung terlihat oleh read()/list() karena `existing` adalah
  // objek yang sama dengan yang di store; penulisan ke disk-nya ditunda.
  const live = store.get(id);
  if (live) {
    live.dirty = true;
    jadwalkanTulis(id);
    return existing;
  }
  return write(existing);
}

function rename(id, title) {
  // Dikosongkan berarti kembali ke "belum berjudul", bukan judul literal.
  return save(id, { title: (title || '').trim() || '' });
}

function remove(id) {
  // Batalkan tunggakan tulis, kalau tidak file yang baru dihapus muncul lagi.
  const live = store.get(id);
  if (live) clearTimeout(live.timer);
  store.delete(id);
  metaCache.delete(id);

  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

/** Judul otomatis dari pesan pertama pengguna. */
function titleFromText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > 48 ? clean.slice(0, 48).trimEnd() + '…' : clean;
}

/**
 * Judul bawaan yang sempat DITULIS ke berkas sesi oleh versi lama.
 *
 * Sesi yang dibuat sebelum 0.3.4 menyimpan kalimatnya secara harfiah, jadi
 * tanpa daftar ini judul mereka akan tetap berbahasa Indonesia selamanya.
 * Keduanya diperlakukan sama dengan judul kosong: belum berjudul.
 */
const JUDUL_BAWAAN_LAMA = new Set(['Percakapan baru', 'New conversation', 'Tanpa judul']);

function belumBerjudul(judul) {
  const j = String(judul || '').trim();
  return !j || JUDUL_BAWAAN_LAMA.has(j);
}

/** Judul untuk ditampilkan — dipakai proses main (mis. balasan Telegram). */
function judulSesi(s) {
  return belumBerjudul(s && s.title) ? t('sesi.baru') : s.title;
}

module.exports = {
  list,
  create,
  read,
  save,
  rename,
  remove,
  titleFromText,
  judulSesi,
  belumBerjudul,
  flushAll,
};
