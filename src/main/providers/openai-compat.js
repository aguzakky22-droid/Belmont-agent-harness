'use strict';

/**
 * Pabrik provider untuk API yang OpenAI-compatible.
 * DeepSeek, Kimi (Moonshot), dan GLM (Zhipu) semuanya pakai bentuk ini —
 * yang beda cuma baseURL, daftar model, dan field API key.
 *
 * Mau nambah provider baru? Panggil makeOpenAICompatProvider({...}) di
 * providers/index.js. Tidak ada file lain yang perlu disentuh.
 */
const { t } = require('../i18n');

// Tingkat effort aplikasi -> nilai reasoning_effort yang dipahami API bergaya
// OpenAI. "xhigh" dan "max" tidak punya padanan, jadi dinaikkan ke "high".
const EFFORT_OPENAI = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
};

/**
 * Header Authorization — HANYA kalau keynya benar-benar ada.
 *
 * Bukan sekadar kerapian: Ollama dan LM Studio tidak punya autentikasi, dan
 * mengirim `Authorization: Bearer ` (kosong) ke sebagian server membuatnya
 * membalas 401 alih-alih mengabaikan header itu. Lebih aman tidak mengirimnya.
 */
function headerAuth(apiKey) {
  const key = String(apiKey || '').trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function makeOpenAICompatProvider(cfg) {
  return {
    id: cfg.id,
    label: cfg.label,
    models: cfg.models,
    defaultModel: cfg.models[0],
    keyField: cfg.id,
    // Endpoint lokal (Ollama, LM Studio, llama.cpp) tidak punya autentikasi
    // sama sekali. Tanda ini membuat agent.js dan main.js berhenti memaksa key
    // terisi; kolomnya tetap ada, cuma tidak lagi wajib.
    keyOpsional: !!cfg.keyOpsional,
    // Dropdown effort di header ikut aktif. Kalau endpoint-nya ternyata tidak
    // mengenal reasoning_effort, run() otomatis mengulang tanpa field itu.
    supportsEffort: true,
    keyHint: cfg.keyHint || '',
    baseURL: cfg.baseURL,
    contextWindow: cfg.contextWindow || 0,

    /**
     * Tarik daftar model langsung dari provider. Daftar statis di index.js
     * cuma cadangan — ini yang bikin daftar tidak pernah usang.
     */
    async fetchModels(apiKey) {
      const res = await fetch(`${cfg.baseURL}/models`, {
        headers: headerAuth(apiKey),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${cfg.label} /models -> HTTP ${res.status} ${detail.slice(0, 200)}`);
      }
      const body = await res.json();
      const ids = (body.data || body.models || [])
        .map((m) => (typeof m === 'string' ? m : m.id))
        .filter(Boolean);
      if (!ids.length) throw new Error(t('galat.modelKosong', { provider: cfg.label }));
      return [...new Set(ids)].sort();
    },

    async run({ apiKey, model, system, messages, tools, effort, onEvent, signal }) {
      // Endpoint custom yang baru dibuat belum punya daftar model sama sekali.
      // Tanpa penjagaan ini, `model` terkirim sebagai undefined dan servernya
      // membalas galat yang tidak menjelaskan apa-apa.
      const dipakai = model || cfg.models[0];
      if (!dipakai) {
        throw new Error(t('galat.belumPilihModel', { provider: cfg.label }));
      }

      const body = {
        model: dipakai,
        stream: true,
        // Minta blok usage di chunk terakhir supaya indikator konteks terisi.
        stream_options: { include_usage: true },
        max_tokens: cfg.maxTokens || 8192,
        messages: [
          { role: 'system', content: system },
          ...toOpenAIMessages(messages),
        ],
      };

      if (tools.length) {
        body.tools = tools.map((alat) => ({
          type: 'function',
          function: {
            name: alat.name,
            description: alat.description,
            parameters: alat.input_schema,
          },
        }));
        body.tool_choice = 'auto';
      }

      // Kedalaman berpikir. Aplikasi punya lima tingkat, API bergaya OpenAI
      // umumnya cuma mengenal tiga — dua tingkat teratas dipetakan ke "high".
      const usaha = EFFORT_OPENAI[effort];
      if (usaha) body.reasoning_effort = usaha;

      // Penjaga kemacetan. Sebagian gateway menerima koneksi lalu diam
      // selamanya saat kuotanya habis atau antrean upstream-nya penuh — tanpa
      // status HTTP, tanpa pesan. Tanpa penjaga ini, giliranmu menggantung
      // tanpa batas dan satu-satunya petunjuk cuma penghitung "Berjalan" yang
      // terus naik. Pewaktunya diulang tiap potongan data datang, jadi jawaban
      // panjang yang mengalir pelan tidak ikut terputus.
      const AMBANG_DIAM = 120000;
      let macet = false;
      let jaga = null;
      const penjaga = new AbortController();
      const teruskanBatal = () => penjaga.abort();
      const tendang = () => {
        clearTimeout(jaga);
        jaga = setTimeout(() => {
          macet = true;
          penjaga.abort();
        }, AMBANG_DIAM);
      };
      if (signal) {
        if (signal.aborted) penjaga.abort();
        else signal.addEventListener('abort', teruskanBatal, { once: true });
      }

      const kirim = (isi) =>
        fetch(`${cfg.baseURL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headerAuth(apiKey) },
          body: JSON.stringify(isi),
          signal: penjaga.signal,
        });

      try {
      tendang();
      let res = await kirim(body);
      let detail = res.ok ? '' : await res.text().catch(() => '');

      // Tidak ada standar tunggal untuk parameter berpikir di dunia
      // OpenAI-compatible: sebagian menerima reasoning_effort, sebagian
      // mengabaikannya, sebagian lagi menolak mentah field asing. Kalau
      // penolakannya memang menyoal field ini, ulangi tanpa dia — lebih baik
      // kehilangan pengaturan effort daripada gilirannya gagal total.
      if (!res.ok && body.reasoning_effort &&
          /reasoning_effort|unknown|unsupport|unrecognized|not\s+support|extra fields/i.test(detail)) {
        delete body.reasoning_effort;
        res = await kirim(body);
        detail = res.ok ? '' : await res.text().catch(() => '');
      }

      if (!res.ok) {
        // Kesalahan paling sering: melampirkan gambar ke model non-vision.
        // Pesan mentahnya berbahasa Inggris dan tidak menyebut solusinya.
        if (/does not support image|image.*not support|multimodal/i.test(detail)) {
          // Penamaan model vision berbeda-beda: "...-vision-exp" (DeepSeek),
          // "...-vision-preview" (Kimi), "glm-4.6v" / "glm-ocr" (GLM).
          const vision = cfg.models.filter((m) => /vision|ocr|\dv($|-)/i.test(m));
          throw new Error(
            `Model "${body.model}" tidak bisa menerima gambar. ` +
              (vision.length
                ? `Ganti ke model vision, misalnya: ${vision.slice(0, 3).join(', ')}.`
                : `Pilih model yang mendukung gambar di ${cfg.label}.`)
          );
        }

        throw new Error(`${cfg.label} error ${res.status}: ${detail.slice(0, 500)}`);
      }

      let text = '';
      let reasoning = '';
      const toolCalls = []; // { id, name, args }
      let stopReason = 'end_turn';

      for await (const chunk of iterSSE(res.body, tendang)) {
        if (chunk.usage) {
          const u = chunk.usage;
          const details = u.prompt_tokens_details || {};
          onEvent({
            type: 'usage',
            usage: {
              input: (u.prompt_tokens || 0) - (details.cached_tokens || 0),
              cacheRead: details.cached_tokens || u.prompt_cache_hit_tokens || 0,
              cacheWrite: 0,
              output: u.completion_tokens || 0,
              contextWindow: cfg.contextWindow || 0,
            },
          });
        }

        const choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta || {};

        if (delta.content) {
          text += delta.content;
          onEvent({ type: 'text', text: delta.content });
        }
        // DeepSeek-R1 dan GLM thinking pakai field ini.
        const think = delta.reasoning_content || delta.reasoning;
        if (think) {
          reasoning += think;
          onEvent({ type: 'thinking', text: think });
        }

        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: '', name: '', args: '' };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments;
        }

        if (choice.finish_reason) {
          stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason;
        }
      }

      const content = [];
      if (text) content.push({ type: 'text', text });
      for (const tc of toolCalls) {
        if (!tc || !tc.name) continue;
        let input = {};
        try {
          input = tc.args ? JSON.parse(tc.args) : {};
        } catch {
          input = { _raw: tc.args };
        }
        content.push({
          type: 'tool_use',
          id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
          name: tc.name,
          input,
        });
      }
      if (content.some((b) => b.type === 'tool_use')) stopReason = 'tool_use';

      return { stopReason, content, reasoning };
      } catch (err) {
        // Dibedakan dari Stop yang kamu tekan sendiri: keduanya sama-sama
        // muncul sebagai AbortError, tapi sebabnya jauh berbeda.
        if (macet) {
          throw new Error(
            `${cfg.label} tidak mengirim data apa pun selama 2 menit, lalu dihentikan. ` +
              `Endpoint-nya menerima koneksi tapi tidak menjawab — biasanya kuota habis, ` +
              `kena rate limit, atau antreannya penuh. Coba lagi nanti atau ganti model.`
          );
        }
        throw err;
      } finally {
        clearTimeout(jaga);
        if (signal) signal.removeEventListener('abort', teruskanBatal);
      }
    },
  };
}

/** Ubah blok internal -> array pesan gaya OpenAI. */
function toOpenAIMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      // tool_result jadi pesan role:"tool" tersendiri, harus mendahului teks user.
      const results = m.content.filter((b) => b.type === 'tool_result');
      for (const r of results) {
        out.push({
          role: 'tool',
          tool_call_id: r.tool_use_id,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
        });
      }
      // Teks + gambar. Kalau ada gambar, pakai bentuk array multimodal.
      const parts = [];
      for (const b of m.content) {
        if (b.type === 'text') parts.push({ type: 'text', text: b.text });
        else if (b.type === 'image' && b.source?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          });
        }
      }
      if (!parts.length) continue;
      const hasImage = parts.some((p) => p.type === 'image_url');
      out.push({
        role: 'user',
        content: hasImage ? parts : parts.map((p) => p.text).join('\n'),
      });
    } else {
      const texts = m.content.filter((b) => b.type === 'text').map((b) => b.text);
      const calls = m.content.filter((b) => b.type === 'tool_use');
      const msg = { role: 'assistant', content: texts.join('\n') || null };
      if (calls.length) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        }));
      }
      out.push(msg);
    }
  }
  return out;
}

/** Baca body SSE dan yield tiap objek JSON-nya. */
async function* iterSSE(body, onData) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Tanda kehidupan untuk penjaga kemacetan — termasuk untuk baris keep-alive
    // yang tidak menghasilkan potongan JSON apa pun.
    if (onData) onData();
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload);
      } catch {
        /* baris tidak lengkap / keep-alive — lewati */
      }
    }
  }
}

module.exports = { makeOpenAICompatProvider };
