'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');

/**
 * Login Claude Code tanpa terminal.
 *
 * Temuan yang mendasari berkas ini: @anthropic-ai/claude-agent-sdk membawa
 * binary Claude Code-nya sendiri sebagai optionalDependency per platform —
 * di Windows ada di:
 *
 *   node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe   (207 MB)
 *
 * Jadi "harus install Claude Code dulu" sebenarnya tidak benar: binary-nya
 * sudah ada. Yang dibutuhkan cuma kredensial di ~/.claude/.credentials.json,
 * dan binary itulah yang mengisinya.
 *
 * Kita TIDAK membuat alur OAuth sendiri. Membuat sendiri berarti memakai client
 * ID milik Claude Code dari aplikasi pihak ketiga — bisa dicabut sewaktu-waktu,
 * dan risikonya menempel ke akun langganan kamu, bukan ke aplikasi ini. Di sini
 * kita cuma MENGEMUDIKAN alat resminya: menjalankannya tanpa jendela konsol,
 * membuka URL yang ia cetak ke browser, dan meneruskan yang kamu ketik ke
 * stdin-nya. Token ditulis oleh alat resmi, ke tempat yang benar.
 */

/** Kandidat lokasi binary, dari yang paling pasti ke yang paling longgar. */
function kandidatExe() {
  const namaPaket =
    process.platform === 'win32'
      ? process.arch === 'arm64'
        ? 'claude-agent-sdk-win32-arm64'
        : 'claude-agent-sdk-win32-x64'
      : process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'claude-agent-sdk-darwin-arm64'
          : 'claude-agent-sdk-darwin-x64'
        : process.arch === 'arm64'
          ? 'claude-agent-sdk-linux-arm64'
          : 'claude-agent-sdk-linux-x64';
  const namaBinary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const sub = path.join('node_modules', '@anthropic-ai', namaPaket, namaBinary);

  const akar = [];
  // Saat dijalankan dari sumber: app.getAppPath() = folder proyek.
  try {
    akar.push(app.getAppPath());
  } catch {
    /* app belum siap */
  }
  // Saat terpasang lewat installer (asar: false).
  if (process.resourcesPath) akar.push(path.join(process.resourcesPath, 'app'));
  akar.push(path.join(__dirname, '..', '..'));

  const daftar = akar.map((a) => path.join(a, sub));

  // Lokasi tetap installer resmi Claude Code (claude.ai/install.cmd). Ditaruh
  // eksplisit supaya langkah "setx PATH" tidak wajib — begitu terpasang,
  // aplikasi ini langsung menemukannya walau terminal belum dibuka ulang.
  daftar.push(path.join(require('os').homedir(), '.local', 'bin', namaBinary));

  // Cadangan: Claude Code yang dipasang sendiri oleh pengguna. Diperlukan kalau
  // binary bawaan SDK tidak ikut dibundel ke installer — tanpa ini, panel login
  // menyerah padahal di mesin itu Claude Code sebenarnya ada.
  for (const p of String(process.env.PATH || '').split(path.delimiter)) {
    if (p) daftar.push(path.join(p, namaBinary));
  }

  return daftar;
}

let jalurCache = null;

/**
 * @returns {string|null} jalur binary, atau null kalau tidak ketemu di mana pun.
 */
function cariExe() {
  if (jalurCache && fs.existsSync(jalurCache)) return jalurCache;
  for (const j of kandidatExe()) {
    if (fs.existsSync(j)) {
      jalurCache = j;
      return j;
    }
  }
  jalurCache = null;
  return null;
}

/** Jalankan sekali dan tunggu selesai. Dipakai untuk perintah yang langsung menjawab. */
function jalankan(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const exe = cariExe();
    if (!exe) return resolve({ ok: false, keluar: '', alasan: 'exe-tidak-ada' });

    const anak = spawn(exe, args, { windowsHide: true });
    let keluar = '';
    const pewaktu = setTimeout(() => anak.kill(), timeoutMs);

    anak.stdout.on('data', (d) => (keluar += d));
    anak.stderr.on('data', (d) => (keluar += d));
    anak.on('error', () => {
      clearTimeout(pewaktu);
      resolve({ ok: false, keluar, alasan: 'gagal-jalan' });
    });
    anak.on('close', (kode) => {
      clearTimeout(pewaktu);
      resolve({ ok: kode === 0, keluar, kode });
    });
  });
}

/**
 * Status login. `claude auth status` mengembalikan JSON rapi:
 *   { loggedIn, authMethod, email, subscriptionType, ... }
 */
async function status() {
  const exe = cariExe();
  if (!exe) return { tersedia: false, loggedIn: false };

  const { keluar } = await jalankan(['auth', 'status']);
  // Keluarannya bisa didahului baris lain; ambil objek JSON pertamanya.
  const mulai = keluar.indexOf('{');
  const akhir = keluar.lastIndexOf('}');
  if (mulai === -1 || akhir <= mulai) return { tersedia: true, loggedIn: false };

  try {
    const j = JSON.parse(keluar.slice(mulai, akhir + 1));
    return {
      tersedia: true,
      loggedIn: !!j.loggedIn,
      email: j.email || '',
      langganan: j.subscriptionType || '',
      metode: j.authMethod || '',
    };
  } catch {
    return { tersedia: true, loggedIn: false };
  }
}

// --- Sesi login yang sedang berjalan -----------------------------------------

let sesi = null; // { anak, kirimEvent }

const POLA_URL = /https?:\/\/[^\s'"<>]+/;

/**
 * Mulai alur login. Keluaran prosesnya dialirkan apa adanya ke renderer, dan
 * URL pertama yang muncul dibuka di browser.
 *
 * Sengaja TIDAK menebak-nebak bentuk dialognya. Alat resminya bisa berubah
 * kapan saja; dengan meneruskan keluaran mentah dan menerima ketikan balik,
 * alur apa pun yang dia minta tetap bisa diselesaikan dari dalam aplikasi.
 */
function mulaiLogin(kirimEvent) {
  const exe = cariExe();
  if (!exe) return { ok: false, alasan: 'exe-tidak-ada' };
  if (sesi) return { ok: false, alasan: 'sedang-berjalan' };

  const anak = spawn(exe, ['auth', 'login', '--claudeai'], {
    windowsHide: true,
    // Beberapa alat menahan keluarannya kalau merasa tidak sedang di terminal.
    env: { ...process.env, FORCE_COLOR: '0', CI: '' },
  });

  let urlDibuka = false;
  const serap = (buf) => {
    const teks = String(buf);
    kirimEvent({ type: 'keluar', teks });

    if (!urlDibuka) {
      const m = POLA_URL.exec(teks);
      if (m) {
        urlDibuka = true;
        kirimEvent({ type: 'url', url: m[0] });
        shell.openExternal(m[0]).catch(() => {});
      }
    }
  };

  anak.stdout.on('data', serap);
  anak.stderr.on('data', serap);
  anak.on('error', (err) => {
    kirimEvent({ type: 'selesai', ok: false, alasan: err?.message || String(err) });
    sesi = null;
  });
  anak.on('close', async (kode) => {
    sesi = null;
    // Kode keluar tidak selalu jujur; yang menentukan adalah status sesudahnya.
    const s = await status();
    kirimEvent({ type: 'selesai', ok: !!s.loggedIn, kode, status: s });
  });

  sesi = { anak, kirimEvent };
  return { ok: true };
}

/** Teruskan satu baris ketikan ke proses login (kode dari browser, dsb). */
function kirimKeLogin(teks) {
  if (!sesi) return { ok: false, alasan: 'tidak-ada-sesi' };
  sesi.anak.stdin.write(`${teks}\n`);
  return { ok: true };
}

function batalkanLogin() {
  if (!sesi) return { ok: true };
  sesi.anak.kill();
  sesi = null;
  return { ok: true };
}

async function logout() {
  const hasil = await jalankan(['auth', 'logout']);
  return { ok: hasil.ok, keluar: hasil.keluar };
}

module.exports = { cariExe, status, mulaiLogin, kirimKeLogin, batalkanLogin, logout };
