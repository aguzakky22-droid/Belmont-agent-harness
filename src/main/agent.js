'use strict';

const providers = require('./providers');
const toolkit = require('./tools');
const mcp = require('./mcp');
const { t } = require('./i18n');
const claudeAuth = require('./claude-auth');

/**
 * Instruksi agar agen menawarkan langkah lanjutan dalam format yang bisa
 * dirender jadi tombol sekali-klik oleh UI (lihat extractOptions di
 * renderer.js). Ditambahkan ke system prompt untuk semua provider.
 */
/*
 * Ketiga blok di bawah berbahasa Inggris dengan sengaja. Ini teks yang dibaca
 * MODEL, bukan pengguna — dan model lebih patuh pada instruksi Inggris. Bahasa
 * jawaban tetap mengikuti bahasa yang dipakai pengguna menulis, karena itulah
 * yang diperintahkan system prompt bawaan di config.js.
 */

/** Panduan format supaya jawaban punya hierarki visual saat dirender. */
const FORMAT_GUIDANCE = [
  'For section headings use real markdown headings (## or ###), not a bold line',
  'like "**Heading**" — markdown headings render larger, bold lines do not.',
].join('\n');

const SUGGESTION_FORMAT = [
  'When there are obvious next steps, end your reply with a list of options the',
  'user can send as-is, one per line, in exactly this format:',
  '',
  '- [] option text',
  '',
  'Rules: put it at the very end; at most 4 lines; each line must be a complete,',
  'sensible message on its own (not a sentence fragment or a heading). Never use',
  'the "- []" format for anything else, and do not force it when there is no',
  'reasonable next step.',
].join('\n');

/** Gabungkan system prompt pengguna dengan instruksi format pilihan. */
function buildSystemPrompt(userSystem) {
  return [userSystem, FORMAT_GUIDANCE, SUGGESTION_FORMAT].filter(Boolean).join('\n\n');
}

/**
 * Instruksi peringkas untuk provider yang tidak punya kompaksi sendiri.
 * Ditulis panjang dengan sengaja: ringkasan yang kehilangan keputusan atau
 * nama file justru membuat giliran berikutnya mengulang pekerjaan yang sudah
 * selesai — lebih boros daripada tidak meringkas sama sekali.
 */
const COMPACT_REQUEST = [
  'Summarise the whole conversation above into handover notes, so the work can',
  'continue without re-reading the history. Write it in the SAME LANGUAGE the',
  'conversation is in, with these sections:',
  '',
  '1. What the user asked for — including anything not done yet.',
  '2. Files and functions touched, with full paths.',
  '3. Decisions already made, and why.',
  '4. Problems hit and how they were resolved.',
  '5. Current state and the next steps.',
  '',
  'Include code snippets, numbers, and exact names that will still be needed.',
  'No opening or closing pleasantries — go straight to the content.',
].join('\n');

/** Perkiraan kasar ukuran riwayat, untuk melaporkan hasil ringkas. */
function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages || []) {
    for (const b of m.content || []) {
      if (typeof b.text === 'string') chars += b.text.length;
      else if (typeof b.content === 'string') chars += b.content.length;
      else if (b.input) chars += JSON.stringify(b.input).length;
      // Gambar tidak dihitung: biayanya tidak sebanding dengan panjang base64.
    }
  }
  return Math.round(chars / 4);
}

/**
 * Loop agen: kirim ke model -> kalau minta tool, jalankan -> kirim hasilnya
 * balik -> ulangi sampai model berhenti minta tool.
 *
 * Riwayat percakapan disimpan dalam format blok internal (lihat tools.js /
 * providers/*), jadi ganti provider di tengah sesi tetap aman.
 */
class Agent {
  constructor({ emit, requestApproval, askQuestion, persist }) {
    this.emit = emit;
    this.requestApproval = requestApproval;
    // Dipakai provider yang punya tool tanya-jawab sendiri (Claude Code).
    this.askQuestion = askQuestion || null;
    this.persist = persist || (() => {}); // dipanggil tiap riwayat berubah
    this.messages = [];
    // Potongan riwayat giliran yang SEDANG berjalan (khusus provider yang
    // mengurus loop-nya sendiri). Belum digabung ke this.messages karena
    // gilirannya belum selesai, tapi sudah bisa ditampilkan dan disimpan.
    this.partial = [];
    this.sessionApproved = new Set(); // nama tool yang di-"selalu izinkan" sesi ini
    // Pesan yang disisipkan ke giliran yang SEDANG berjalan (tombol "Kirim
    // sekarang"). Untuk provider yang loop-nya kita pegang sendiri, pesan
    // dititipkan di sini lalu dimasukkan pada batas langkah berikutnya.
    this.sisipan = [];
    this.abort = null;
    // Sesi Claude Code yang hidup antar giliran (menjaga prompt cache).
    this.live = null;
    this.liveSignature = null;
    this.liveMode = null;
    this.liveModel = null;
  }

  reset() {
    this.messages = [];
    this.partial = [];
    this.sisipan = [];
    this.sessionApproved.clear();
    this.closeLive();
  }

  /**
   * Riwayat untuk ditampilkan: yang sudah final ditambah kemajuan giliran yang
   * masih berjalan. Dipakai saat proyek dibuka kembali — tanpa ini, proyek yang
   * sedang bekerja di latar akan tampak berhenti di posisi sebelum gilirannya
   * dimulai.
   */
  viewMessages() {
    return this.partial.length ? [...this.messages, ...this.partial] : this.messages;
  }

  /** Muat riwayat sesi yang dibuka dari disk, beserta izin "selalu" miliknya. */
  load(messages, approvedTools) {
    this.messages = Array.isArray(messages) ? messages : [];
    this.partial = [];
    this.sisipan = [];
    this.sessionApproved = new Set(approvedTools || []);
    // Proyek lain = sesi Claude Code lain.
    this.closeLive();
  }

  /**
   * Apakah tool ini perlu dikonfirmasi?
   *   supervised  -> semua tool yang mengubah sesuatu
   *   acceptEdits -> hanya yang bukan perubahan file (mis. perintah shell)
   *   full        -> tidak pernah
   * "Selalu izinkan" (sessionApproved) menang di mode mana pun.
   */
  shouldAsk(tool, mode) {
    // Tool MCP dikecualikan dari mode 'full', dan HARUS diperiksa sebelum baris
    // di bawahnya. Mode izin mengatur tool BAWAAN, yang seluruhnya dikurung di
    // dalam folder kerja oleh safePath(). Server MCP adalah program pihak
    // ketiga tanpa kurungan itu, jadi "jalankan semuanya tanpa bertanya" tidak
    // pernah dimaksudkan mencakup mereka. "Selalu izinkan" tetap berlaku, jadi
    // yang memang mau membungkam satu tool tertentu masih bisa.
    if (tool.mcp) return !this.sessionApproved.has(tool.name);
    if (mode === 'full') return false;
    if (!tool.needsApproval) return false;
    if (this.sessionApproved.has(tool.name)) return false;
    if (mode === 'acceptEdits' && tool.kind === 'edit') return false;
    return true;
  }

  /** Catat "selalu izinkan" supaya bertahan lintas giliran, dan simpan ke sesi. */
  rememberApproval(toolName) {
    this.sessionApproved.add(toolName);
    this.persist(this.messages, undefined, { approvedTools: [...this.sessionApproved] });
  }

  /**
   * Sisipkan pesan pengguna ke giliran yang sedang berjalan, TANPA
   * menghentikannya.
   *
   * Dua jalur, karena yang memegang loop-nya beda:
   *   - Claude Code: didorong ke antrean masukan sesi. CLI membacanya di batas
   *     langkah berikutnya, persis seperti pesan yang diketik saat ia bekerja.
   *   - Provider lain: loop-nya milik kita, jadi cukup dititipkan dan
   *     dimasukkan ke riwayat sebelum permintaan berikutnya dikirim.
   *
   * Mengembalikan false kalau tidak ada giliran yang bisa disisipi.
   */
  inject(text) {
    const isi = String(text || '').trim();
    if (!isi) return false;

    // Tanpa giliran yang berjalan, pesan ini tidak akan pernah terbaca — dan
    // untuk Claude Code, mendorongnya ke sesi yang menganggur justru memulai
    // giliran siluman yang hasilnya tidak ada yang menampung.
    if (!this.abort) return false;

    if (this.live && this.live.push) {
      this.live.push(isi);
      return true;
    }
    this.sisipan.push(isi);
    return true;
  }

  /**
   * Pindahkan sisipan yang menunggu ke riwayat, sebagai pesan pengguna biasa.
   * Dipanggil hanya di batas langkah, saat semua tool_use sudah punya
   * tool_result-nya — kalau tidak, permintaan berikutnya ditolak provider.
   */
  serapSisipan() {
    if (!this.sisipan.length) return;
    const antre = this.sisipan;
    this.sisipan = [];
    const blok = antre.map((text) => ({ type: 'text', text }));

    // Digabung ke pesan pengguna terakhir kalau memang ada. Titik sisip yang
    // wajar justru selalu tepat setelah blok tool_result — yang juga berperan
    // "user". Menambah pesan user kedua di situ membuat peran jadi
    // user→user, dan Anthropic menolak riwayat yang perannya tidak berselang.
    const akhir = this.messages[this.messages.length - 1];
    if (akhir && akhir.role === 'user') akhir.content.push(...blok);
    else this.messages.push({ role: 'user', content: blok });

    this.persist(this.messages);
  }

  /**
   * Ambil sisipan yang keburu ketinggalan karena gilirannya sudah berakhir.
   * Dipanggil main process supaya pesannya diantrekan ulang, bukan hilang.
   */
  ambilSisipanSisa() {
    return this.sisipan.splice(0);
  }

  stop() {
    if (this.abort) this.abort.abort();
    // Sesi Claude Code tetap hidup — cukup hentikan giliran yang berjalan,
    // supaya cache tidak ikut terbuang.
    if (this.live) this.live.interrupt();
  }

  async send(userText, rawCfg, attachments) {
    // Satu tempat penggabungan, supaya semua provider dapat instruksi yang sama.
    const cfg = { ...rawCfg, systemPrompt: buildSystemPrompt(rawCfg.systemPrompt) };
    const provider = providers.get(cfg.provider);

    // Provider tanpa keyField (mis. Claude Code) pakai login, bukan API key.
    // keyOpsional = endpoint custom: boleh kosong, karena server lokal seperti
    // Ollama dan LM Studio memang tidak punya autentikasi.
    const apiKey = provider.keyField ? (cfg.keys && cfg.keys[provider.keyField]) || '' : null;
    if (provider.keyField && !provider.keyOpsional && !apiKey) {
      this.emit({
        type: 'error',
        message: t('galat.keyKosong', { provider: provider.label }),
      });
      this.emit({ type: 'done' });
      return;
    }

    // Provider berbasis langganan butuh binary Claude Code. Diperiksa DI SINI,
    // sebelum apa pun dikirim: kalau tidak, kegagalannya muncul sebagai galat
    // spawn dari dalam SDK yang tidak menyebutkan apa yang harus dilakukan.
    if (provider.selfDriving && !claudeAuth.cariExe()) {
      this.emit({ type: 'error', message: 'CLAUDE_CODE_TIDAK_ADA' });
      this.emit({ type: 'done' });
      return;
    }

    // Lampiran jadi blok konten sendiri, mendahului teks pengguna.
    const content = [...buildAttachmentBlocks(attachments), { type: 'text', text: userText }];
    this.messages.push({ role: 'user', content });
    this.persist(this.messages, userText);
    this.abort = new AbortController();

    const ctx = {
      workingDir: cfg.workingDir,
      tavilyKey: cfg.tavilyKey,
    };

    if (provider.selfDriving) {
      return this.runSelfDriving(provider, userText, cfg, attachments);
    }

    // Nyalakan server MCP sebelum langkah pertama, supaya toolnya sudah ada di
    // daftar yang dikirim ke model. Sengaja tidak dibungkus try/catch di sini:
    // siapkan() memang tidak pernah melempar — server yang mati cuma membuat
    // toolnya absen, dan giliran tetap jalan dengan tool bawaan.
    await mcp.siapkan();

    try {
      for (let step = 0; step < (cfg.maxSteps || 40); step++) {
        // Pesan yang kamu sisipkan selagi agen bekerja masuk di sini — batas
        // langkah adalah satu-satunya titik aman: menyelipkannya di tengah
        // rangkaian tool_use/tool_result akan merusak bentuk riwayatnya.
        this.serapSisipan();

        this.emit({ type: 'assistant_start' });

        const reply = await provider.run({
          apiKey,
          model: cfg.model || provider.defaultModel,
          system: cfg.systemPrompt,
          messages: this.messages,
          tools: [...toolkit.definitions(), ...mcp.definitions()],
          effort: cfg.effort,
          onEvent: (e) => this.emit(e),
          signal: this.abort.signal,
        });

        this.messages.push({ role: 'assistant', content: reply.content });
        this.persist(this.messages);
        this.emit({ type: 'assistant_end' });

        const calls = reply.content.filter((b) => b.type === 'tool_use');
        // Agen sudah selesai menjawab, tapi ada pesan susulan darimu yang belum
        // sempat dibaca — lanjutkan gilirannya alih-alih menutupnya.
        if (!calls.length) {
          if (!this.sisipan.length) break;
          continue;
        }

        const results = [];
        for (const call of calls) {
          results.push(await this.executeTool(call, cfg, ctx));
        }
        this.messages.push({ role: 'user', content: results });
        this.persist(this.messages);
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        this.emit({ type: 'error', message: t('galat.dihentikan') });
      } else {
        this.emit({ type: 'error', message: err?.message || String(err) });
      }
    } finally {
      this.abort = null;
      // Sisipan yang belum sempat terserap TIDAK dibuang di sini: main process
      // memungutnya lewat ambilSisipanSisa() dan mengantrekannya ulang.
      this.persist(this.messages);
      this.emit({ type: 'done' });
    }
  }

  /**
   * Ringkas percakapan supaya konteksnya mengecil.
   *
   * Dua jalur, karena kemampuannya memang berbeda:
   *   - Claude Code: kompaksi asli lewat /compact. Jendela konteks sesi
   *     benar-benar diganti ringkasannya, di sisi CLI.
   *   - Provider API: kita tidak memegang kendali atas konteks di sisi server,
   *     jadi riwayat kita sendiri yang diringkas lalu ditukar.
   *
   * Yang tampil di layar tidak dihapus dalam kedua kasus — yang menyusut hanya
   * apa yang ikut dikirim ke model pada giliran berikutnya.
   */
  async compact(rawCfg) {
    const cfg = { ...rawCfg, systemPrompt: buildSystemPrompt(rawCfg.systemPrompt) };
    const provider = providers.get(cfg.provider);

    try {
      if (provider.selfDriving) {
        const live = await this.ensureLiveSession(provider, cfg);
        if (!live.compact) throw new Error(t('galat.compactTidakDidukung'));
        await live.compact();
      } else {
        await this.compactGeneric(provider, cfg);
      }
    } catch (err) {
      if (err?.name === 'AbortError') this.emit({ type: 'error', message: t('galat.dihentikan') });
      else this.emit({ type: 'error', message: err?.message || String(err) });
    } finally {
      this.abort = null;
      this.emit({ type: 'done' });
    }
  }

  /**
   * Ringkas untuk provider tanpa kompaksi bawaan: minta model menulis catatan
   * serah-terima, lalu tukar seluruh riwayat dengan catatan itu.
   *
   * Riwayat lama ditukar, bukan ditambahi — kalau cuma ditambahi, konteksnya
   * malah membesar dan tombolnya jadi kontraproduktif.
   */
  async compactGeneric(provider, cfg) {
    const apiKey = provider.keyField ? (cfg.keys && cfg.keys[provider.keyField]) || '' : null;
    if (provider.keyField && !provider.keyOpsional && !apiKey) {
      throw new Error(t('galat.keyKosong', { provider: provider.label }));
    }
    if (this.messages.length < 2) {
      throw new Error(t('galat.belumAdaRingkas'));
    }

    const before = estimateTokens(this.messages);
    this.abort = new AbortController();

    const reply = await provider.run({
      apiKey,
      model: cfg.model || provider.defaultModel,
      system: 'Kamu meringkas percakapan kerja secara padat dan akurat.',
      messages: [
        ...this.messages,
        { role: 'user', content: [{ type: 'text', text: COMPACT_REQUEST }] },
      ],
      // Tanpa tool: ini murni tugas menulis, dan skema tool ikut memakan konteks.
      tools: [],
      effort: cfg.effort,
      onEvent: () => {}, // ringkasannya tidak perlu mengalir ke layar
      signal: this.abort.signal,
    });

    const summary = (reply.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!summary) throw new Error(t('galat.ringkasanKosong'));

    this.messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Ringkasan percakapan sebelumnya (riwayat aslinya sudah dipangkas ' +
              'untuk menghemat konteks):\n\n' +
              summary,
          },
        ],
      },
    ];
    this.persist(this.messages);

    this.emit({
      type: 'compacted',
      trigger: 'manual',
      pre: before,
      post: estimateTokens(this.messages),
      // Provider OpenAI-compatible punya contextWindow(model) per model;
      // yang lain tetap angka statis di properti provider.
      contextWindow:
        (typeof provider.contextWindow === 'function'
          ? provider.contextWindow(cfg.model)
          : provider.contextWindow) || 0,
      estimated: true,
    });
  }

  /**
   * Giliran untuk provider yang punya loop sendiri (Claude Code).
   * Kita cuma menyediakan folder, modal konfirmasi, dan tempat menyimpan hasil.
   */
  async runSelfDriving(provider, userText, cfg, attachments) {
    // Claude Code membaca file sendiri, jadi lampiran cukup disebut path-nya.
    const paths = (attachments || []).map((a) => a.path).filter(Boolean);
    const prompt = paths.length
      ? `${userText}\n\nFile terlampir (baca dengan tool Read):\n${paths.map((p) => `- ${p}`).join('\n')}`
      : userText;

    this.partial = [];
    try {
      const live = await this.ensureLiveSession(provider, cfg);
      const { newMessages, sessionId } = await live.send(prompt);

      this.messages.push(...(newMessages || []));
      this.partial = [];
      this.persist(this.messages, undefined, { resumeId: sessionId });
    } catch (err) {
      // Giliran yang gagal atau dihentikan di tengah jalan tetap menyisakan
      // pekerjaan nyata (file sudah berubah) — jangan buang catatannya.
      if (this.partial.length) {
        this.messages.push(...this.partial);
        this.partial = [];
        this.persist(this.messages);
      }
      if (err?.name === 'AbortError') this.emit({ type: 'error', message: t('galat.dihentikan') });
      else this.emit({ type: 'error', message: err?.message || String(err) });
    } finally {
      this.partial = [];
      this.abort = null;
      this.emit({ type: 'done' });
    }
  }

  /**
   * Pakai ulang sesi Claude Code yang sudah hidup selama pengaturannya tidak
   * berubah. Ini yang menjaga prompt cache tetap panas antar giliran.
   * Model dan mode izin bisa diubah tanpa membuang sesi; sisanya (folder,
   * effort, system prompt) memaksa sesi baru.
   */
  async ensureLiveSession(provider, cfg) {
    // Daftar server MCP untuk Claude Code diambil langsung dari config (SDK yang
    // menyambungnya, bukan klien kita). Ikut di signature: menambah atau
    // mengubah server harus memaksa sesi baru, karena mcpServers hanya dibaca
    // saat sesi dibuka — sesi lama tidak akan pernah tahu ada server baru.
    const mcpServers = mcp.untukAgentSdk();
    const signature = JSON.stringify([
      cfg.workingDir,
      cfg.effort,
      cfg.leanContext,
      cfg.systemPrompt,
      cfg.resumeId || null,
      mcpServers,
    ]);

    if (this.live && this.liveSignature === signature) {
      if (this.liveMode !== cfg.permissionMode) {
        await this.live.setPermissionMode(cfg.permissionMode);
        this.liveMode = cfg.permissionMode;
      }
      if (this.liveModel !== cfg.model) {
        await this.live.setModel(cfg.model);
        this.liveModel = cfg.model;
      }
      return this.live;
    }

    this.closeLive();
    this.live = await provider.createSession({
      model: cfg.model,
      system: cfg.systemPrompt,
      workingDir: cfg.workingDir,
      resumeId: cfg.resumeId,
      permissionMode: cfg.permissionMode,
      effort: cfg.effort,
      leanContext: cfg.leanContext,
      isApproved: (name) => this.sessionApproved.has(name),
      rememberApproval: (name) => this.rememberApproval(name),
      emit: (e) => this.emit(e),
      requestApproval: (p) => this.requestApproval(p),
      askQuestion: this.askQuestion ? (p) => this.askQuestion(p) : null,
      mcpServers,
      // Simpan kemajuan tiap langkah, bukan hanya di akhir giliran. Inilah yang
      // membuat proyek latar tetap terlihat maju saat dibuka kembali.
      onProgress: (partial) => {
        this.partial = partial || [];
        this.persist([...this.messages, ...this.partial]);
      },
    });
    this.liveSignature = signature;
    this.liveMode = cfg.permissionMode;
    this.liveModel = cfg.model;
    return this.live;
  }

  closeLive() {
    if (this.live) {
      this.live.close();
      this.live = null;
      this.liveSignature = null;
    }
  }

  async executeTool(call, cfg, ctx) {
    // Tool bawaan lebih dulu, baru server MCP. Nama tool MCP selalu berawalan
    // "mcp_" jadi sebetulnya tidak mungkin bertabrakan — tapi urutan ini membuat
    // hal itu tidak bergantung pada aturan penamaan yang bisa berubah.
    const tool = toolkit.byName[call.name] || mcp.tool(call.name);

    if (!tool) {
      this.emit({ type: 'tool_start', id: call.id, name: call.name, input: call.input });
      const msg = `Tool "${call.name}" tidak ada.`;
      this.emit({ type: 'tool_end', id: call.id, ok: false, output: msg });
      return { type: 'tool_result', tool_use_id: call.id, content: msg, is_error: true };
    }

    if (this.shouldAsk(tool, cfg.permissionMode)) {
      const decision = await this.requestApproval({
        id: call.id,
        name: call.name,
        input: call.input,
      });
      if (decision === 'always') this.rememberApproval(tool.name);
      if (decision === 'deny') {
        const msg = 'Ditolak oleh pengguna. Jangan ulangi tool ini; tanya dulu apa yang diinginkan.';
        this.emit({ type: 'tool_start', id: call.id, name: call.name, input: call.input });
        this.emit({ type: 'tool_end', id: call.id, ok: false, output: msg });
        return { type: 'tool_result', tool_use_id: call.id, content: msg, is_error: true };
      }
    }

    this.emit({ type: 'tool_start', id: call.id, name: call.name, input: call.input });
    try {
      const output = await tool.run(call.input || {}, ctx);
      this.emit({ type: 'tool_end', id: call.id, ok: true, output });
      return { type: 'tool_result', tool_use_id: call.id, content: output };
    } catch (err) {
      const msg = `Error: ${err?.message || String(err)}`;
      this.emit({ type: 'tool_end', id: call.id, ok: false, output: msg });
      return { type: 'tool_result', tool_use_id: call.id, content: msg, is_error: true };
    }
  }
}

/**
 * Ubah lampiran jadi blok konten.
 * Gambar dikirim sebagai blok image; file teks disisipkan apa adanya.
 * (Main process yang membaca isinya — lihat readAttachment di main.js.)
 */
function buildAttachmentBlocks(attachments) {
  const blocks = [];
  for (const a of attachments || []) {
    if (a.kind === 'image' && a.data) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mediaType, data: a.data },
        name: a.name,
      });
    } else if (a.kind === 'text' && a.text !== undefined) {
      blocks.push({ type: 'text', text: `File terlampir "${a.name}":\n\n${a.text}` });
    } else if (a.error) {
      blocks.push({ type: 'text', text: `[Lampiran "${a.name}" gagal dibaca: ${a.error}]` });
    }
  }
  return blocks;
}

module.exports = { Agent };
