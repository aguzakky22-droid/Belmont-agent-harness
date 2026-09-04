'use strict';

const config = require('../config');
const anthropic = require('./anthropic');
const claudeCode = require('./claude-code');
const { makeOpenAICompatProvider } = require('./openai-compat');

// Daftar model di bawah ini hanya CADANGAN untuk dipakai sebelum ada API key.
// Begitu key terisi, tombol "Muat ulang" di Pengaturan menarik daftar asli dari
// endpoint /models tiap provider — itu yang jadi sumber kebenaran.
// Satu key untuk banyak model dari beberapa penyedia sekaligus, jadi daftar
// cadangannya sengaja pendek: cuma id yang terbaca dari halaman resminya.
// Daftar sebenarnya jauh lebih panjang dan ditarik oleh tombol "Muat ulang".
const ontoken = makeOpenAICompatProvider({
  id: 'ontoken',
  label: 'ONToken.id',
  baseURL: 'https://api.ontoken.id/v1',
  models: ['claude-opus-5', 'gpt-5.6-sol', 'glm-5.3-flash', 'glm-5.2'],
  maxTokens: 8192,
  contextWindow: 200000,
  keyHint: 'app.ontoken.id -> API Keys. Satu key untuk semua model.',
});

// gpt-6-astra sengaja tidak dimasukkan: saat ini masih terbatas Trusted Access
// Program, jadi bagi hampir semua orang model itu cuma akan menghasilkan 404.
// Yang punya akses akan melihatnya sendiri lewat "Muat ulang".
const openai = makeOpenAICompatProvider({
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  baseURL: 'https://api.openai.com/v1',
  models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  maxTokens: 8192,
  contextWindow: 1050000,
  keyHint: 'platform.openai.com -> API keys',
});

// Google menyediakan lapisan kompatibel OpenAI, jadi Gemini bisa lewat pabrik
// yang sama. baseURL-nya berhenti di `/openai` — dari situ kode menambahkan
// `/chat/completions` dan `/models` sendiri, sama seperti provider lain.
// Lapisan ini masih beta dan MENGABAIKAN DIAM-DIAM parameter yang tidak
// dikenalnya, bukan menolak. Efeknya: pengaturan effort bisa saja tidak
// berpengaruh tanpa ada galat apa pun.
const gemini = makeOpenAICompatProvider({
  id: 'gemini',
  label: 'Gemini (Google)',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  models: [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-pro-preview',
  ],
  maxTokens: 8192,
  contextWindow: 1000000,
  keyHint: 'aistudio.google.com -> Get API key',
});

const deepseek = makeOpenAICompatProvider({
  id: 'deepseek',
  label: 'DeepSeek',
  baseURL: 'https://api.deepseek.com/v1',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'],
  maxTokens: 8192,
  contextWindow: 128000,
  keyHint: 'platform.deepseek.com -> API keys',
});

const kimi = makeOpenAICompatProvider({
  id: 'kimi',
  label: 'Kimi (Moonshot)',
  baseURL: 'https://api.moonshot.ai/v1',
  models: [
    'kimi-k3',
    'kimi-k2.7-code',
    'kimi-k2.7-code-highspeed',
    'kimi-k2.6',
    'kimi-k2.5',
    'moonshot-v1-auto',
    'moonshot-v1-128k',
    'moonshot-v1-32k',
    'moonshot-v1-8k',
    'moonshot-v1-128k-vision-preview',
    'moonshot-v1-32k-vision-preview',
    'moonshot-v1-8k-vision-preview',
  ],
  maxTokens: 8192,
  contextWindow: 128000,
  keyHint: 'platform.kimi.ai -> API Keys. Akun Tiongkok: ganti baseURL ke api.moonshot.cn/v1',
});

const glm = makeOpenAICompatProvider({
  id: 'glm',
  label: 'GLM (Zhipu / Z.ai)',
  baseURL: 'https://api.z.ai/api/paas/v4',
  models: [
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.2',
    'glm-5.1',
    'glm-5',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.7-flashx',
    'glm-4.6',
    'glm-4.5',
    'glm-4.5-air',
    'glm-4.5-flash',
    'glm-4.6v',
    'glm-4.6v-flash',
    'glm-4.5v',
    'glm-ocr',
  ],
  maxTokens: 8192,
  contextWindow: 200000,
  keyHint: 'z.ai -> API Keys. Akun Tiongkok: ganti baseURL ke open.bigmodel.cn/api/paas/v4',
});

// Urutan objek ini = urutan di dropdown Provider; UI tidak menyortir ulang.
const BUILTIN = {
  ontoken,
  'claude-code': claudeCode,
  anthropic,
  openai,
  gemini,
  deepseek,
  kimi,
  glm,
};

/**
 * Endpoint custom dibangun ulang tiap kali daftar provider diminta, bukan
 * disimpan di variabel modul. Alasannya: pengguna bisa menambah atau menghapus
 * endpoint kapan saja dari Pengaturan, dan daftar yang dibekukan saat aplikasi
 * dinyalakan akan langsung basi begitu itu terjadi.
 */
function bikinCustom(c) {
  return makeOpenAICompatProvider({
    id: c.id,
    label: c.label || c.id,
    baseURL: c.baseURL,
    // Kosong itu wajar untuk endpoint baru — daftarnya diisi tombol
    // "Muat ulang", yang menariknya langsung dari {baseURL}/models.
    models: Array.isArray(c.models) ? c.models : [],
    maxTokens: c.maxTokens || 8192,
    contextWindow: c.contextWindow || 128000,
    keyHint: `Endpoint custom — ${c.baseURL}`,
    // Selalu opsional untuk endpoint yang kamu daftarkan sendiri. Endpoint
    // berbayar tetap butuh key — bedanya, yang menolak sekarang servernya
    // (401 yang jelas), bukan kita di depan. Itu harga kecil dibanding
    // memaksa key palsu untuk Ollama/LM Studio yang memang tidak punya.
    keyOpsional: true,
  });
}

function semua() {
  const out = { ...BUILTIN };
  for (const c of config.load().customProviders || []) {
    // Entri setengah jadi dilewati, dan provider bawaan tidak boleh ditimpa.
    if (!c || !c.id || !c.baseURL || BUILTIN[c.id]) continue;
    out[c.id] = bikinCustom(c);
  }
  return out;
}

function get(id) {
  const p = semua()[id];
  if (!p) {
    throw new Error(
      `Provider tidak dikenal: ${id}. Kalau ini endpoint custom, mungkin sudah ` +
        `dihapus — pilih provider lain di Pengaturan.`
    );
  }
  return p;
}

/** Ringkasan untuk dipakai UI (tanpa fungsi). */
function list() {
  return Object.values(semua()).map((p) => ({
    id: p.id,
    label: p.label,
    models: p.models,
    defaultModel: p.defaultModel,
    keyField: p.keyField,
    keyOpsional: !!p.keyOpsional,
    keyHint: p.keyHint,
    selfDriving: !!p.selfDriving,
    supportsEffort: !!p.supportsEffort,
    // Dipakai UI untuk mengelompokkan dan menampilkan formulir ubah/hapus.
    custom: !BUILTIN[p.id],
    baseURL: p.baseURL || '',
  }));
}

module.exports = { get, list, BUILTIN };
