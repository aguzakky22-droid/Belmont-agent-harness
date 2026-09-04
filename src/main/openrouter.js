'use strict';

/**
 * Katalog model OpenRouter — dipakai sebagai sumber context window dan
 * modality untuk provider OpenAI-compatible (ONToken, endpoint custom, dsb).
 *
 * Kenapa OpenRouter? Endpoint seperti ONToken adalah gateway multi-model:
 * /models-nya cuma memberi DAFTAR ID, tanpa context length maupun modality.
 * OpenRouter menjual hampir semua model yang sama dan mempublikasikan
 * katalognya secara publik (tanpa API key) di /api/v1/models, lengkap dengan
 * `context_length` dan `architecture.modality` per model.
 *
 * Katalognya ~2 MB (400+ model) dan jarang berubah drastis, jadi di-cache di
 * userData selama 24 jam. Kegagalan jaringan BUKAN galat: semua lookup punya
 * fallback (nilai statis provider / tebakan nama), sehingga aplikasi offline
 * tetap berjalan seperti sebelum fitur ini ada.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const URL_KATALOG = 'https://openrouter.ai/api/v1/models';
const UMUR_CACHE = 24 * 60 * 60 * 1000; // 24 jam

// Katalog yang sudah dimuat ke memori: { ts, peta: Map<basisId, info> }.
let katalog = null;

/** Id varian OpenRouter dibawa ke bentuk dasarnya: "vendor/model:free" -> "vendor/model". */
function basis(id) {
  return String(id || '').toLowerCase().split(':')[0];
}

function infoDariMentah(m) {
  return {
    contextLength: m.context_length || 0,
    // "text+image->text" — teks mentahnya disimpan apa adanya untuk ditampilkan.
    modality: (m.architecture && m.architecture.modality) || '',
    inputModalities: (m.architecture && m.architecture.input_modalities) || [],
  };
}

function petaDari(data) {
  const peta = new Map();
  for (const m of data || []) {
    if (m && m.id) peta.set(basis(m.id), infoDariMentah(m));
  }
  return peta;
}

function lokasiCache() {
  return path.join(app.getPath('userData'), 'openrouter-models.json');
}

/** Muat katalog: memori -> cache disk (kalau masih muda) -> jaringan. */
async function muatKatalog() {
  if (katalog && Date.now() - katalog.ts < UMUR_CACHE) return katalog.peta;

  const berkas = lokasiCache();
  try {
    const simpan = JSON.parse(fs.readFileSync(berkas, 'utf8'));
    if (simpan && simpan.ts && Date.now() - simpan.ts < UMUR_CACHE && Array.isArray(simpan.data)) {
      katalog = { ts: simpan.ts, peta: petaDari(simpan.data) };
      return katalog.peta;
    }
  } catch {
    /* cache belum ada atau rusak — lanjut ke jaringan */
  }

  const res = await fetch(URL_KATALOG, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`OpenRouter /models -> HTTP ${res.status}`);
  const body = await res.json();
  katalog = { ts: Date.now(), peta: petaDari(body.data) };
  try {
    fs.writeFileSync(berkas, JSON.stringify({ ts: katalog.ts, data: body.data }));
  } catch {
    /* disk penuh / read-only — katalog tetap dipakai dari memori */
  }
  return katalog.peta;
}

/**
 * Cocokkan satu id model ke entri katalog.
 *
 * Provider sering memakai nama yang sedikit berbeda dari OpenRouter:
 * "deepseek-chat" vs "deepseek/deepseek-chat", "claude-sonnet-4.5" vs
 * "anthropic/claude-sonnet-4.5", atau versi bertanggal seperti
 * "gpt-5-mini-2026-01-17" vs "openai/gpt-5-mini". Urutan pencocokan:
 * persis -> suffix setelah "/" -> suffix tanpa tanggal rilis.
 */
function cocokkan(peta, modelId) {
  const target = basis(modelId);
  if (!target) return null;
  if (peta.has(target)) return peta.get(target);

  let kandidat = null;
  for (const [id, info] of peta) {
    if (id === target || id.endsWith('/' + target)) return info; // suffix persis menang langsung
    const tanpaTanggal = target.replace(/-\d{4}(-\d{2}){0,2}$/, '');
    if (tanpaTanggal !== target && (id === tanpaTanggal || id.endsWith('/' + tanpaTanggal))) {
      kandidat = info; // kecocokan lebih longgar — dipakai kalau tidak ada yang persis
    }
  }
  return kandidat;
}

/** Info OpenRouter untuk satu model, atau null kalau tidak ketemu/gagal. */
async function infoModel(modelId) {
  try {
    return cocokkan(await muatKatalog(), modelId);
  } catch {
    return null; // offline, timeout, dsb — pemanggil punya fallback sendiri
  }
}

/**
 * Versi sinkron: hanya membaca katalog yang SUDAH ada di memori.
 *
 * Dipakai di tengah streaming (saat blok usage tiba), tempat await tidak
 * boleh memperlambat — katalog sudah diisi lebih dulu oleh infoModel() di
 * awal giliran. Mengembalikan null kalau katalognya belum termuat sama sekali
 * (misalnya fetch pertamanya gagal total), dan pemanggil jatuh ke fallback.
 */
function infoModelSync(modelId) {
  if (!katalog) return null;
  return cocokkan(katalog.peta, modelId);
}

/**
 * Kayaikan daftar id model dengan info katalog.
 * Masukan array string; keluaran array { id, contextLength, modality, inputModalities }
 * (field info 0/'' untuk model yang tidak ada di katalog).
 */
async function kayaikanDaftar(ids) {
  let peta = null;
  try {
    peta = await muatKatalog();
  } catch {
    peta = new Map();
  }
  return ids.map((id) => {
    const info = cocokkan(peta, id);
    return {
      id,
      contextLength: info ? info.contextLength : 0,
      modality: info ? info.modality : '',
      inputModalities: info ? info.inputModalities : [],
    };
  });
}

module.exports = { infoModel, infoModelSync, kayaikanDaftar };
