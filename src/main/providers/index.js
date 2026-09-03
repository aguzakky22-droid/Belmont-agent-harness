'use strict';

const config = require('../config');
const anthropic = require('./anthropic');
const claudeCode = require('./claude-code');
const { makeOpenAICompatProvider } = require('./openai-compat');

// Daftar model di bawah ini hanya CADANGAN untuk dipakai sebelum ada API key.
// Begitu key terisi, tombol "Muat ulang" di Pengaturan menarik daftar asli dari
// endpoint /models tiap provider — itu yang jadi sumber kebenaran.
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

const BUILTIN = { 'claude-code': claudeCode, anthropic, deepseek, kimi, glm };

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
