'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const DEFAULTS = {
  provider: 'claude-code',
  model: '',
  workingDir: path.join(os.homedir(), 'Desktop'),
  // Dalam bahasa Inggris, bukan Indonesia: ini dibaca MODEL, bukan pengguna, dan
  // model umumnya lebih patuh pada instruksi berbahasa Inggris. Bahasa jawaban
  // tidak ikut terkunci — kalimat terakhirlah yang mengaturnya, dan ia menyuruh
  // agen mengikuti bahasa yang kamu pakai menulis.
  systemPrompt:
    'You are an agent assistant helping with technical work on the user\'s computer. ' +
    'Use the available tools to read and write files, run commands, and search the web. ' +
    'Reply in whatever language the user writes in. Be concise and get to the point.',
  // supervised   : tanya sebelum perintah & perubahan file
  // acceptEdits  : setujui otomatis perubahan file, tanya untuk sisanya
  // full         : jalankan semuanya tanpa bertanya
  permissionMode: 'supervised',
  // Kedalaman berpikir: low | medium | high | xhigh | max.
  // Default 'medium', bukan 'high': effort tinggi membuat agen menjelajah dan
  // membaca lebih banyak file, sehingga konteks cepat penuh.
  effort: 'medium',
  // Tema warna. Nilainya = atribut data-theme di <html>; daftar lengkapnya ada
  // di theme.css, dan daftar yang ditampilkan di Pengaturan ada di renderer.js.
  theme: 'catppuccin',
  // Bahasa antarmuka: 'id' | 'en'. Daftarnya ada di renderer/i18n.js.
  // Bawaannya Inggris supaya aplikasi ini bisa dipakai siapa pun tanpa perlu
  // mengganti apa-apa lebih dulu; yang mau Indonesia tinggal memilihnya di
  // Pengaturan. Pemasangan lama tidak terpengaruh — nilai bawaan hanya dipakai
  // saat field-nya belum pernah ada di settings.json.
  language: 'en',
  maxSteps: 40,
  // Daftar model hasil tarik dari API tiap provider: { providerId: [...] }
  modelCache: {},
  // Ukuran jendela terakhir, supaya tidak kembali mengecil tiap dibuka.
  windowBounds: null,
  // Hemat konteks: jangan pakai preset system prompt Claude Code.
  // Menghemat ~3.2 rb token tiap giliran, tapi panduan pemakaian tool bawaan
  // Claude Code ikut hilang — agen bisa jadi kurang cakap memilih tool.
  leanContext: false,
  // Endpoint OpenAI-compatible tambahan yang kamu daftarkan sendiri.
  // Bentuk tiap entri: { id, label, baseURL, maxTokens, contextWindow }
  // `id` selalu berawalan "custom-" supaya tidak pernah menimpa provider bawaan
  // — API key disimpan per id, jadi tabrakan nama berarti key ikut tertimpa.
  customProviders: [],
  // Server MCP (Model Context Protocol) yang toolnya ikut disodorkan ke agen.
  // Bentuk tiap entri: { id, label, command, args: [], env: {}, cwd, enabled }
  // Transportnya stdio — tiap server dijalankan sebagai proses anak. Lihat
  // mcp.js, termasuk catatan keamanannya: server MCP ADALAH program lain, dan
  // batas folder kerja kita tidak berlaku untuk mereka.
  mcpServers: [],
  keys: {
    anthropic: '',
    deepseek: '',
    kimi: '',
    glm: '',
  },
  // Telegram: dipakai mengirim pemberitahuan ke HP.
  // chatId juga berfungsi sebagai daftar putih — hanya chat ini yang dilayani.
  telegram: {
    botToken: '',
    chatId: '',
    // Nyalakan jembatan otomatis saat aplikasi dibuka.
    enabled: false,
    // Kirim juga hasil giliran yang kamu mulai dari desktop. Default mati:
    // saat kamu duduk di depan PC, notifikasi HP cuma mengganggu.
    notifyDesktop: false,
  },
  // Opsional: Tavily API key untuk web_search berkualitas.
  // Kalau kosong, dipakai DuckDuckGo (gratis, tanpa key).
  tavilyKey: '',
};

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(base[k] || {}, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return { ...DEFAULTS, keys: { ...DEFAULTS.keys } };
  }
}

function save(patch) {
  const merged = deepMerge(load(), patch);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { load, save, configPath, DEFAULTS };
