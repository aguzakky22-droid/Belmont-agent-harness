'use strict';

/**
 * Provider "Claude Code" — memakai Claude Agent SDK, yang berjalan di atas
 * login Claude Code kamu. Kalau login itu langganan Claude Max, permintaan
 * dihitung ke langganan tersebut, bukan ke kredit API. Karena itu provider ini
 * tidak butuh API key.
 *
 * Bedanya dengan provider lain: provider ini MENGURUS LOOP-NYA SENDIRI
 * (`selfDriving: true`). Tools-nya milik Claude Code (Read/Write/Edit/Bash/
 * Glob/Grep/WebSearch/WebFetch), bukan tools.js kita — jadi tools.js tidak
 * dipakai saat provider ini aktif. Yang tetap kita kendalikan:
 *   - cwd dikunci ke folder proyek
 *   - tiap tool yang berpotensi merusak lewat modal konfirmasi kita (canUseTool)
 */

// Paket ini ESM-only sedangkan proses main CommonJS, jadi harus dynamic import.
const { t } = require('../i18n');

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

/**
 * Tool baca-saja: dijalankan tanpa bertanya ke pengguna.
 *
 * Sengaja TIDAK ditaruh di `allowedTools`. Entri di sana menyetujui tool
 * secara utuh SEBELUM canUseTool dipanggil (SDK memperingatkan ini), sehingga
 * kita kehilangan kesempatan menyaring path. Dengan lewat canUseTool, tool ini
 * tetap otomatis disetujui tapi kita masih bisa menolak folder raksasa.
 */
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task'];

/**
 * Folder yang isinya bisa meledakkan konteks kalau dibaca beramai-ramai.
 * Satu perintah "baca folder ini" di proyek Node bisa menelan ratusan ribu
 * token hanya dari node_modules.
 */
const HEAVY_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'coverage',
  '.cache',
];

/**
 * Panduan hemat konteks. Ditambahkan ke system prompt di semua mode karena
 * biaya terbesar biasanya bukan prompt awal, melainkan file yang dibaca
 * beramai-ramai lalu menetap di riwayat.
 */
const CONTEXT_GUIDANCE = [
  'Hemat konteks. Jangan membaca file secara borongan.',
  'Pakai Glob/Grep untuk menemukan bagian yang relevan lebih dulu, lalu Read hanya file itu.',
  'Untuk file besar, baca potongan yang dibutuhkan saja (offset/limit), bukan seluruh isinya.',
  'Jangan membaca ulang file yang isinya sudah ada di percakapan ini.',
].join(' ');

/** Kembalikan nama folder berat kalau tool menyasar ke sana; kalau tidak, null. */
function heavyPathHit(input) {
  const candidates = [input?.file_path, input?.path, input?.pattern, input?.glob]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .replace(/\\/g, '/');
  if (!candidates) return null;
  for (const dir of HEAVY_DIRS) {
    if (new RegExp(`(^|/)${dir.replace('.', '\\.')}(/|$)`).test(candidates)) return dir;
  }
  return null;
}

/**
 * Jawab AskUserQuestion lewat UI aplikasi.
 *
 * Bentuk jawabannya sudah diverifikasi terhadap SDK: `{ behavior: 'allow',
 * updatedInput: { ...input, answers } }`, dengan `answers` berupa objek
 * `{ [teks pertanyaan]: teks jawaban }`. CLI lalu mengembalikan tool_result
 * "Your questions have been answered: …" ke model.
 */
async function answerQuestions(input, askQuestion) {
  const questions = Array.isArray(input?.questions) ? input.questions : [];

  // Tanpa handler UI, lebih jujur menolak daripada meng-"allow" dan membiarkan
  // agen mengira pertanyaannya sengaja dilewati.
  if (!askQuestion || !questions.length) {
    return {
      behavior: 'deny',
      message:
        'Aplikasi ini tidak bisa menampilkan pertanyaan pilihan. Tanyakan lagi ' +
        'sebagai teks biasa di jawabanmu, lalu tunggu balasan pengguna.',
    };
  }

  const answers = await askQuestion({ questions });

  if (!answers) {
    return {
      behavior: 'deny',
      message:
        'Pengguna menutup pertanyaan tanpa menjawab. JANGAN anggap ini sebagai ' +
        'persetujuan diam-diam dan jangan memilih sendiri — tanyakan lagi ' +
        'sebagai teks biasa, lalu berhenti dan tunggu balasannya.',
    };
  }

  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

// Mode izin aplikasi -> mode izin Claude Agent SDK.
// 'full' sengaja dipetakan ke 'default', BUKAN 'bypassPermissions':
// bypass melewati canUseTool sepenuhnya, sehingga penjaga folder raksasa ikut
// mati. Dengan 'default' + canUseTool yang selalu mengizinkan, pengguna tetap
// tidak pernah ditanya, tapi penjaga konteksnya tetap hidup.
const SDK_PERMISSION_MODE = {
  supervised: 'default',
  acceptEdits: 'acceptEdits',
  full: 'default',
};

/**
 * Ukuran jendela konteks, untuk indikator "sisa konteks".
 * CLI melaporkan model seperti "claude-opus-5[1m]" — sufiks itu yang menandai
 * jendela 1 juta token.
 */
function contextWindowFor(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return 0;
  if (id.includes('[1m]')) return 1000000;
  if (id.includes('haiku')) return 200000;
  if (id.includes('opus') || id.includes('sonnet') || id.includes('fable')) return 1000000;
  return 200000;
}

module.exports = {
  id: 'claude-code',
  label: 'Claude Code (Max)',
  // Claude Code menerima alias maupun ID model penuh. Alias paling aman
  // (selalu menunjuk versi terbaru); ID spesifik tergantung akses akunmu.
  models: [
    'default',
    'opus',
    'sonnet',
    'haiku',
    'opusplan',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  defaultModel: 'default',
  keyField: null, // tidak perlu API key
  // Kosong dengan sengaja. Dulu berisi "jalankan claude di terminal sekali" —
  // sudah tidak berlaku: login kini dikerjakan dari panel "Akun Claude" tepat
  // di bawah kolom ini, dan binary-nya ikut dibawa SDK, tidak perlu dipasang.
  keyHint: '',
  selfDriving: true,
  supportsEffort: true,

  /**
   * Buka SATU sesi Claude Code yang tetap hidup selama proyek dibuka, lalu
   * alirkan tiap pesan pengguna ke dalamnya.
   *
   * Kenapa bukan query() baru tiap giliran (+ `resume`)? Karena setiap query()
   * baru menulis ulang prompt cache. Terukur pada giliran kedua:
   *   query() baru + resume : 6.101 token cache write
   *   sesi hidup            :    44 token cache write
   * Selisihnya membesar seiring riwayat memanjang.
   */
  async createSession({
    model,
    system,
    workingDir,
    resumeId,
    permissionMode,
    effort,
    leanContext,
    isApproved,
    rememberApproval,
    emit,
    requestApproval,
    askQuestion,
    onProgress,
  }) {
    const { query } = await loadSdk();

    let permMode = permissionMode;
    const abortController = new AbortController();

    const options = {
      cwd: workingDir,
      abortController,
      permissionMode: SDK_PERMISSION_MODE[permMode] || 'default',
      // Jangan pungut setting/agent dari disk milik Claude Code pengguna;
      // aplikasi ini harus berperilaku sama di mesin mana pun.
      settingSources: [],
      // Tanpa ini teks thinking datang KOSONG: default-nya 'omitted' di
      // Claude Opus 5 — blok thinking tetap ada, isinya string kosong.
      thinking: { type: 'adaptive', display: 'summarized' },
      // Kirim event streaming mentah, supaya thinking dan teks tampil
      // sedikit demi sedikit, bukan sekaligus setelah blok selesai.
      includePartialMessages: true,
      // Mode hemat: kirim system prompt apa adanya, tanpa preset Claude Code
      // (terukur ~3.2 rb token lebih ringan per giliran, tapi panduan
      // pemakaian tool bawaannya ikut hilang).
      systemPrompt: (() => {
        const extra = [system, CONTEXT_GUIDANCE].filter(Boolean).join('\n\n');
        return leanContext
          ? extra
          : { type: 'preset', preset: 'claude_code', append: extra };
      })(),
    };

    if (model && model !== 'default') options.model = model;
    if (effort) options.effort = effort;
    if (resumeId) options.resume = resumeId;

    // canUseTool dipasang di SEMUA mode. Di mode 'full' ia tidak menanyakan
    // apa pun, tapi tetap menjaga konteks dari folder raksasa.
    options.canUseTool = async (toolName, input) => {
      // AskUserQuestion bukan izin, melainkan PERTANYAAN — dan canUseTool
      // adalah satu-satunya tempat jawabannya bisa diberikan. Kalau kita cuma
      // meng-"allow" tanpa mengisi `answers`, CLI menyimpulkan pengguna
      // melewatkan pertanyaannya dan agen lanjut menebak sendiri. Itulah yang
      // dulu terjadi: kartu tool muncul di layar tanpa cara menjawabnya.
      if (toolName === 'AskUserQuestion') {
        return answerQuestions(input, askQuestion);
      }

      const heavy = heavyPathHit(input);
      if (heavy) {
        return {
          behavior: 'deny',
          message:
            `Jangan baca "${heavy}" — isinya ribuan file dan akan memenuhi konteks. ` +
            'Batasi ke kode sumber proyek saja (mis. folder src/), atau sebutkan file tertentu.',
        };
      }

      if (permMode === 'full') return { behavior: 'allow' };

      // Tool baca-saja: jalan otomatis, tanpa mengganggu pengguna.
      if (READ_ONLY_TOOLS.includes(toolName)) return { behavior: 'allow' };

      // "Selalu izinkan" dari giliran sebelumnya — jangan tanya lagi.
      if (isApproved && isApproved(toolName)) return { behavior: 'allow' };

      const decision = await requestApproval({
        id: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: toolName,
        input,
      });
      if (decision === 'deny') {
        return {
          behavior: 'deny',
          message: 'Ditolak oleh pengguna. Tanyakan dulu apa yang diinginkan.',
        };
      }
      if (decision === 'always' && rememberApproval) rememberApproval(toolName);
      return { behavior: 'allow' };
    };

    // Antrean pesan pengguna: sesi menunggu di sini sampai ada kiriman baru,
    // sehingga proses Claude Code tetap hidup di antara giliran.
    const inbox = makeInbox();
    const stream = query({ prompt: inbox.iterable, options });

    let sessionId = resumeId || null;
    let activeModel = model && model !== 'default' ? model : '';

    // Keadaan per giliran.
    let newMessages = [];
    let assistantBlocks = [];
    // Dilacak TERPISAH. Kalau digabung, giliran yang cuma berpikir lalu
    // langsung memanggil tool (tanpa teks) akan mengirim ulang teks
    // penalarannya dan tampil dua kali.
    let streamedText = false;
    let streamedThinking = false;
    let lastRequest = null; // usage permintaan model terakhir = ukuran konteks
    let settle = null; // penyelesai promise giliran yang sedang berjalan
    // Daftar slash command yang benar-benar dikenali CLI ini. Dipakai supaya
    // "/compact" tidak pernah terkirim sebagai teks biasa ke model.
    let slashCommands = [];

    const flushAssistant = () => {
      if (!assistantBlocks.length) return;
      newMessages.push({ role: 'assistant', content: assistantBlocks });
      assistantBlocks = [];
      emit({ type: 'assistant_end' });
    };

    /**
     * Laporkan kemajuan giliran SELAGI BERJALAN.
     *
     * Tanpa ini, seluruh hasil giliran hanya diserahkan sekali di akhir lewat
     * send(). Selama giliran berlangsung tidak ada apa pun yang tersimpan, jadi
     * proyek yang ditinggal ke latar tampak membeku di posisi terakhir dan baru
     * "melompat maju" saat dibuka kembali. Yang dilaporkan adalah salinan
     * riwayat sejauh ini, termasuk blok asisten yang belum di-flush.
     */
    const reportProgress = () => {
      if (!onProgress) return;
      onProgress(
        assistantBlocks.length
          ? [...newMessages, { role: 'assistant', content: assistantBlocks }]
          : [...newMessages]
      );
    };

    const handle = (msg) => {
      if (msg.session_id) sessionId = msg.session_id;

      if (msg.type === 'stream_event') {
        // Event streaming mentah Messages API: thinking dan teks per potongan.
        const ev = msg.event;

        // Ukuran konteks = usage permintaan model TERAKHIR, bukan jumlah
        // seluruh permintaan dalam giliran ini. Satu giliran dengan 4 tool
        // berarti 5 permintaan; menjumlahkannya melipatgandakan angka ~5x.
        if (ev?.type === 'message_start') {
          const u = ev.message?.usage || {};
          lastRequest = {
            input: u.input_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cacheWrite: u.cache_creation_input_tokens || 0,
            output: u.output_tokens || 0,
          };
        } else if (ev?.type === 'message_delta' && lastRequest && ev.usage) {
          lastRequest.output = ev.usage.output_tokens || lastRequest.output;
        }

        if (ev?.type === 'content_block_delta') {
          const d = ev.delta || {};
          if (d.type === 'thinking_delta' && d.thinking) {
            streamedThinking = true;
            emit({ type: 'thinking', text: d.thinking });
          } else if (d.type === 'text_delta' && d.text) {
            streamedText = true;
            emit({ type: 'text', text: d.text });
          }
        }
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type === 'text') {
            // Sudah dialirkan per potongan di atas; cukup simpan ke riwayat.
            if (!streamedText) emit({ type: 'text', text: block.text });
            assistantBlocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'thinking') {
            // Hanya kirim kalau BELUM dialirkan lewat thinking_delta.
            if (!streamedThinking && block.thinking) {
              emit({ type: 'thinking', text: block.thinking });
            }
          } else if (block.type === 'tool_use') {
            emit({ type: 'tool_start', id: block.id, name: block.name, input: block.input });
            assistantBlocks.push({
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }
        // Satu pesan asisten (teks dan/atau panggilan tool) sudah lengkap.
        reportProgress();
      } else if (msg.type === 'user') {
        // Hasil tool datang sebagai pesan user berisi blok tool_result.
        const results = [];
        for (const block of msg.message?.content || []) {
          if (block.type !== 'tool_result') continue;
          const text = flattenToolResult(block.content);
          emit({ type: 'tool_end', id: block.tool_use_id, ok: !block.is_error, output: text });
          results.push({
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: text,
            ...(block.is_error ? { is_error: true } : {}),
          });
        }
        if (results.length) {
          flushAssistant();
          newMessages.push({ role: 'user', content: results });
          // Hasil tool sudah masuk — inilah titik simpan yang paling berguna.
          reportProgress();
        }
      } else if (msg.type === 'system') {
        if (msg.model) activeModel = msg.model;
        if (Array.isArray(msg.slash_commands)) slashCommands = msg.slash_commands;

        if (msg.subtype === 'compact_boundary') {
          // Kompaksi selesai — riwayat model diganti ringkasan.
          const meta = msg.compact_metadata || {};
          const pre = meta.pre_tokens || 0;
          const post = meta.post_tokens || 0;
          emit({
            type: 'compacted',
            trigger: meta.trigger || 'manual',
            pre,
            post,
            contextWindow: contextWindowFor(activeModel),
          });
          // Konteks baru saja menyusut. Tanpa ini status bar tetap menampilkan
          // angka sebelum kompaksi sampai giliran berikutnya berjalan.
          if (post) {
            lastRequest = { input: post, cacheRead: 0, cacheWrite: 0, output: 0 };
            emit({
              type: 'usage',
              usage: { ...lastRequest, contextWindow: contextWindowFor(activeModel) },
            });
          }
        } else if (msg.subtype === 'status' && msg.compact_result === 'failed') {
          emit({
            type: 'error',
            message: t('galat.gagalMeringkas', {
              pesan: msg.compact_error || t('galat.sebabTakDijelaskan'),
            }),
          });
        }
      } else if (msg.type === 'result') {
        if (lastRequest) {
          emit({
            type: 'usage',
            usage: { ...lastRequest, contextWindow: contextWindowFor(activeModel) },
          });
        }
        if (msg.is_error) {
          emit({ type: 'error', message: msg.result || t('galat.ccLapor') });
        }
        // Giliran selesai — serahkan hasilnya ke pemanggil send().
        flushAssistant();
        const done = settle;
        settle = null;
        if (done) done.resolve({ newMessages, sessionId });
      }
    };

    // Loop konsumsi berjalan di latar selama sesi hidup.
    (async () => {
      try {
        for await (const msg of stream) handle(msg);
      } catch (err) {
        const done = settle;
        settle = null;
        if (done) done.reject(err);
        else emit({ type: 'error', message: err?.message || String(err) });
      }
    })();

    return {
      /** Kirim satu pesan pengguna; selesai saat giliran berakhir. */
      send(prompt) {
        return new Promise((resolve, reject) => {
          newMessages = [];
          assistantBlocks = [];
          streamedText = false;
          streamedThinking = false; // wajib ikut di-reset, kalau tidak
          settle = { resolve, reject }; // giliran berikutnya kehilangan fallback
          emit({ type: 'assistant_start' });
          inbox.push({
            type: 'user',
            message: { role: 'user', content: prompt },
            parent_tool_use_id: null,
          });
        });
      },

      /**
       * Selipkan pesan pengguna ke giliran yang SEDANG berjalan.
       *
       * Bedanya dengan send(): tidak ada promise baru dan `settle` tidak
       * disentuh — giliran yang sekarang tetap yang menyelesaikannya. Agen
       * tidak dihentikan; CLI membaca pesan ini di batas langkah berikutnya,
       * persis seperti mengetik saat Claude Code sedang bekerja.
       */
      push(prompt) {
        // Ikut tercatat di riwayat kita, kalau tidak gelembungnya lenyap saat
        // proyek ini dibuka ulang padahal modelnya jelas-jelas membacanya.
        flushAssistant();
        newMessages.push({ role: 'user', content: [{ type: 'text', text: prompt }] });
        reportProgress();
        inbox.push({
          type: 'user',
          message: { role: 'user', content: prompt },
          parent_tool_use_id: null,
        });
      },

      /**
       * Ringkas percakapan lewat kompaksi asli Claude Code.
       *
       * Ini BUKAN "minta model menulis ringkasan": /compact mengganti isi
       * jendela konteks milik sesi dengan ringkasannya, jadi giliran berikutnya
       * benar-benar berangkat dari konteks yang lebih kecil. Riwayat di layar
       * tidak ikut hilang — yang menyusut hanya apa yang dibawa ke model.
       *
       * Sesi tetap hidup, jadi cache prompt tidak dibuang percuma.
       */
      compact() {
        // Kalau CLI tidak mengenal perintah ini, mengirimnya sama saja dengan
        // menyuruh model membaca teks "/compact" — mahal dan tidak ada gunanya.
        const kenal = slashCommands.some((c) => String(c).replace(/^\//, '') === 'compact');
        if (slashCommands.length && !kenal) {
          return Promise.reject(
            new Error(t('galat.ccTanpaCompact'))
          );
        }

        return new Promise((resolve, reject) => {
          newMessages = [];
          assistantBlocks = [];
          streamedText = false;
          streamedThinking = false;
          settle = { resolve, reject };
          // Sengaja tanpa emit assistant_start: kompaksi bukan jawaban, jadi
          // tidak perlu blok penalaran kosong di layar.
          inbox.push({
            type: 'user',
            message: { role: 'user', content: '/compact' },
            parent_tool_use_id: null,
          });
        });
      },

      /** Ubah mode izin tanpa membuang sesi (dan tanpa membuang cache). */
      async setPermissionMode(mode) {
        permMode = mode;
        try {
          await stream.setPermissionMode(SDK_PERMISSION_MODE[mode] || 'default');
        } catch {
          /* versi SDK lama tidak punya ini — canUseTool tetap menjaga */
        }
      },

      async setModel(next) {
        try {
          await stream.setModel(next && next !== 'default' ? next : undefined);
        } catch {
          /* abaikan; model lama tetap dipakai */
        }
      },

      async interrupt() {
        try {
          await stream.interrupt();
        } catch {
          /* sudah berhenti */
        }
      },

      close() {
        inbox.close();
        abortController.abort();
      },
    };
  },
};

/**
 * Antrean async: menahan `for await` sampai ada pesan berikutnya, sehingga
 * satu query() bisa melayani banyak giliran.
 */
function makeInbox() {
  const items = [];
  let wake = null;
  let closed = false;

  return {
    push(msg) {
      items.push(msg);
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    },
    close() {
      closed = true;
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    },
    iterable: (async function* () {
      while (true) {
        if (items.length) {
          yield items.shift();
          continue;
        }
        if (closed) return;
        await new Promise((r) => (wake = r));
      }
    })(),
  };
}

/** Isi tool_result bisa string atau array blok — ratakan jadi teks. */
function flattenToolResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? '');
  return content
    .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
    .join('\n');
}
