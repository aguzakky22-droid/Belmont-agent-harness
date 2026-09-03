'use strict';

const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;
const { t } = require('../i18n');

// Cadangan sebelum daftar asli ditarik dari /v1/models.
const MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

function contextWindowFor(modelId) {
  return String(modelId || '').includes('haiku') ? 200000 : 1000000;
}

/**
 * Provider Claude (Anthropic).
 * Bicara dalam format blok internal:
 *   {type:'text'} | {type:'tool_use'} | {type:'tool_result'}
 * yang kebetulan sama persis dengan format Anthropic, jadi mapping-nya tipis.
 */
module.exports = {
  id: 'anthropic',
  label: 'Claude (Anthropic)',
  models: MODELS,
  defaultModel: 'claude-opus-5',
  keyField: 'anthropic',
  supportsEffort: true,
  keyHint: 'Ambil di console.anthropic.com -> API Keys (format: sk-ant-...)',

  /** Daftar model asli dari API — dipakai tombol "Muat ulang" di Pengaturan. */
  async fetchModels(apiKey) {
    const client = new Anthropic({ apiKey });
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    if (!ids.length) throw new Error(t('galat.modelKosong', { provider: 'Anthropic' }));
    return ids;
  },

  async run({ apiKey, model, system, messages, tools, effort, onEvent, signal }) {
    const client = new Anthropic({ apiKey });

    const stream = client.messages.stream(
      {
        model: model || MODELS[0],
        max_tokens: 32000,
        system: sistemBercache(system),
        // Thinking adaptif; "summarized" supaya progres reasoning kelihatan di UI.
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: effort || 'high' },
        tools: tools.map((alat) => ({
          name: alat.name,
          description: alat.description,
          input_schema: alat.input_schema,
        })),
        messages: pesanBercache(messages),
      },
      { signal }
    );

    stream.on('text', (delta) => onEvent({ type: 'text', text: delta }));
    stream.on('thinking', (delta) => onEvent({ type: 'thinking', text: delta }));

    const final = await stream.finalMessage();

    if (final.usage) {
      onEvent({
        type: 'usage',
        usage: {
          input: final.usage.input_tokens || 0,
          cacheRead: final.usage.cache_read_input_tokens || 0,
          cacheWrite: final.usage.cache_creation_input_tokens || 0,
          output: final.usage.output_tokens || 0,
          contextWindow: contextWindowFor(model || MODELS[0]),
        },
      });
    }

    return {
      stopReason: final.stop_reason,
      content: final.content
        .map((b) => {
          if (b.type === 'text') return { type: 'text', text: b.text };
          if (b.type === 'tool_use')
            return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
          return null;
        })
        .filter(Boolean),
      usage: final.usage,
    };
  },
};

// Penanda cache. TTL bawaan 5 menit sengaja dipakai, bukan 1 jam: selama agen
// bekerja, tiap langkah tool berjarak beberapa detik sehingga entri 5 menit
// terus diperbarui secara gratis — sementara TTL 1 jam menaikkan ongkos tulis
// dari 1,25x jadi 2x untuk selamanya demi jeda yang jarang terjadi.
const CACHE = { type: 'ephemeral' };

/**
 * System prompt dijadikan blok teks bertanda cache.
 * Urutan render Anthropic adalah tools -> system -> messages, jadi satu penanda
 * di sini ikut menyimpan seluruh definisi tool (~600 token) sekalian.
 */
function sistemBercache(system) {
  const teks = String(system || '').trim();
  if (!teks) return undefined; // tanpa system prompt tidak ada yang bisa ditandai
  return [{ type: 'text', text: teks, cache_control: CACHE }];
}

/**
 * Penanda kedua di blok terakhir pesan terakhir.
 * Titik ini bergerak maju tiap giliran: permintaan berikutnya membaca seluruh
 * riwayat sampai penanda lama (0,1x harga) dan hanya menulis selisihnya.
 */
function pesanBercache(messages) {
  const out = messages.map(toAnthropicMessage);
  const akhir = out[out.length - 1];
  if (!akhir || !akhir.content.length) return out;
  const i = akhir.content.length - 1;
  // Disalin, bukan diubah di tempat. Blok teks biasa diteruskan apa adanya oleh
  // toAnthropicMessage, jadi menempelkan cache_control langsung akan mengotori
  // riwayat milik Agent yang ikut ditulis ke disk.
  akhir.content[i] = { ...akhir.content[i], cache_control: CACHE };
  return out;
}

function toAnthropicMessage(m) {
  return {
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool_use_id: b.tool_use_id,
          content: b.content,
          ...(b.is_error ? { is_error: true } : {}),
        };
      }
      // `name` cuma label untuk UI kita — API menolak field asing.
      if (b.type === 'image') return { type: 'image', source: b.source };
      return b;
    }),
  };
}
