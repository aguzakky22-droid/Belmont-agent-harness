'use strict';

const { spawn } = require('child_process');
const config = require('./config');
// Dibaca dari package.json, bukan ditulis harfiah: versi ini dikirim ke tiap
// server MCP sebagai clientInfo, dan angka yang ditulis tangan pasti tertinggal
// pada kenaikan versi berikutnya.
const { version: VERSI_APP } = require('../../package.json');

/**
 * Klien MCP (Model Context Protocol).
 *
 * Aplikasi ini berperan sebagai KLIEN: ia menjalankan server MCP milik orang
 * lain, menanyakan tool apa saja yang mereka punya, lalu menyodorkan tool itu
 * ke model bersama tool bawaan kita. Saat model memanggilnya, panggilannya
 * diteruskan ke server yang bersangkutan.
 *
 * Dua transport didukung, dipilih dari bentuk `command` di pengaturan:
 *
 *  - stdio — server dijalankan sebagai proses anak, pesan JSON-RPC 2.0 bolak-
 *    balik lewat stdin/stdout, satu pesan per baris. Bentuk mayoritas server
 *    MCP yang beredar (`npx <paket>`).
 *  - Streamable HTTP — `command` berisi URL. Tiap permintaan satu POST; balasan
 *    bisa `application/json` biasa ATAU `text/event-stream`, dan keduanya harus
 *    ditangani karena server yang sama memakai keduanya bergantian.
 *
 * PERHATIAN KEAMANAN. Server MCP adalah PROGRAM LAIN di komputer ini, bukan
 * kode kita. safePath() tidak berlaku untuk mereka: server filesystem bisa
 * menyentuh folder mana pun yang diizinkan haknya sendiri, terlepas dari folder
 * kerja proyek. Karena itu semua tool MCP diberi needsApproval: true — kita
 * tidak tahu apa yang mereka lakukan, jadi bawaannya harus bertanya.
 */

const VERSI_PROTOKOL = '2025-06-18';
const BATAS_MULAI = 20000; // handshake: npx boleh mengunduh paketnya dulu
const BATAS_PANGGIL = 120000; // tool_call: sebagian server memang lambat
const BATAS_KELUARAN = 30000; // sama dengan MAX_OUTPUT di tools.js

const isWin = process.platform === 'win32';

function clip(s) {
  const teks = String(s == null ? '' : s);
  if (teks.length <= BATAS_KELUARAN) return teks;
  return teks.slice(0, BATAS_KELUARAN) + `\n… (dipotong, total ${teks.length} karakter)`;
}

/**
 * Di Windows, `npx` sebenarnya `npx.cmd`. Sejak Node 18.20/20.12 berkas .cmd
 * tidak bisa lagi di-spawn langsung tanpa shell (CVE-2024-27980), jadi di sana
 * kita selalu lewat shell — dan karena itu argumennya harus kita kutip sendiri:
 * dengan shell: true, Node cuma menyambung argv pakai spasi.
 */
function kutip(s) {
  const teks = String(s);
  return /[\s"^&|<>()]/.test(teks) ? `"${teks.replace(/"/g, '\\"')}"` : teks;
}

function bersih(s) {
  return String(s || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** URL berarti transport HTTP; selain itu perintah yang dijalankan (stdio). */
function lewatHttp(spec) {
  return /^https?:\/\//i.test(String((spec && spec.command) || '').trim());
}

/**
 * Ambil balasan ber-id tertentu dari badan text/event-stream.
 * Formatnya: baris "data: {json}", dipisah baris kosong antar peristiwa.
 */
function dariSse(teks, id) {
  for (const baris of String(teks).split(/\r?\n/)) {
    if (!baris.startsWith('data:')) continue;
    try {
      const pesan = JSON.parse(baris.slice(5).trim());
      if (pesan && pesan.id === id) return pesan;
    } catch {
      /* peristiwa bukan JSON — lewati */
    }
  }
  return null;
}

/** Satu koneksi ke satu server MCP. */
class Server {
  constructor(spec) {
    this.spec = spec;
    this.http = lewatHttp(spec);
    this.sessionId = null;
    this.proc = null;
    this.buf = '';
    this.seq = 0;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.tools = [];
    this.status = 'mati'; // mati | menyala | siap | galat
    this.error = '';
    this.info = null;
    this.starting = null;
  }

  get id() {
    return this.spec.id;
  }

  /** Idempoten dan aman dipanggil berbarengan — pemanggil kedua ikut menunggu. */
  async start() {
    if (this.status === 'siap') return this;
    if (this.starting) return this.starting;
    this.starting = this._start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async _start() {
    this.stop();
    this.error = '';
    this.status = 'menyala';

    const cmd = String(this.spec.command || '').trim();
    if (!cmd) {
      this.status = 'galat';
      this.error = 'Perintah atau URL server belum diisi.';
      throw new Error(this.error);
    }

    // HTTP tidak punya proses anak: langsung ke handshake.
    if (this.http) {
      try {
        const hasil = await this.kirim(
          'initialize',
          {
            protocolVersion: VERSI_PROTOKOL,
            capabilities: {},
            clientInfo: { name: 'Belmont Tools', version: VERSI_APP },
          },
          BATAS_MULAI
        );
        this.info = hasil?.serverInfo || null;
        this.beritahu('notifications/initialized');
        this.tools = await this.muatTools();
        this.status = 'siap';
        return this;
      } catch (err) {
        this.status = 'galat';
        this.error = err?.message || String(err);
        throw new Error(this.error);
      }
    }

    const args = Array.isArray(this.spec.args) ? this.spec.args.map(String) : [];

    try {
      this.proc = spawn(
        isWin ? kutip(cmd) : cmd,
        isWin ? args.map(kutip) : args,
        {
          shell: isWin,
          windowsHide: true,
          cwd: this.spec.cwd || undefined,
          env: { ...process.env, ...(this.spec.env || {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      this.status = 'galat';
      this.error = err?.message || String(err);
      throw err;
    }

    // stderr server MCP itu log, bukan galat — spesifikasinya memang menyuruh
    // server memakainya untuk diagnostik. Disimpan sepotong saja, supaya kalau
    // handshake-nya gagal ada petunjuk yang bisa ditampilkan.
    let jejak = '';
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => {
      jejak = (jejak + d).slice(-2000);
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => this.terimaData(d));

    this.proc.on('error', (err) => this.mati(err?.message || String(err)));
    this.proc.on('exit', (code, sinyal) => {
      const sebab = sinyal ? `sinyal ${sinyal}` : `kode ${code}`;
      this.mati(`Server berhenti (${sebab}).${jejak ? `\n${jejak.trim()}` : ''}`);
    });

    try {
      const hasil = await this.kirim(
        'initialize',
        {
          protocolVersion: VERSI_PROTOKOL,
          capabilities: {},
          clientInfo: { name: 'Belmont Tools', version: '0.3.4' },
        },
        BATAS_MULAI
      );
      this.info = hasil?.serverInfo || null;

      // Wajib menurut spesifikasi: server baru boleh melayani permintaan lain
      // setelah menerima notifikasi ini.
      this.beritahu('notifications/initialized');

      this.tools = await this.muatTools();
      this.status = 'siap';
      return this;
    } catch (err) {
      const pesan = err?.message || String(err);
      this.stop();
      this.status = 'galat';
      // jejak hanya ditambahkan kalau belum ada di dalam pesannya. Saat server
      // mati sebelum menjawab, handler 'exit' sudah menyisipkannya lebih dulu —
      // tanpa penjagaan ini, stderr-nya tercetak dua kali.
      const ekor = jejak.trim();
      this.error = ekor && !pesan.includes(ekor) ? `${pesan}\n${ekor}` : pesan;
      throw new Error(this.error);
    }
  }

  async muatTools() {
    const keluar = [];
    let cursor;
    // tools/list boleh dipaginasi. Dibatasi 20 halaman supaya server yang
    // mengembalikan cursor yang sama terus tidak membuat kita berputar selamanya.
    for (let i = 0; i < 20; i++) {
      const hasil = await this.kirim('tools/list', cursor ? { cursor } : {});
      for (const alat of hasil?.tools || []) keluar.push(alat);
      cursor = hasil?.nextCursor;
      if (!cursor) break;
    }
    return keluar;
  }

  terimaData(chunk) {
    this.buf += chunk;
    let batas;
    while ((batas = this.buf.indexOf('\n')) >= 0) {
      const baris = this.buf.slice(0, batas).trim();
      this.buf = this.buf.slice(batas + 1);
      if (!baris) continue;
      let pesan;
      try {
        pesan = JSON.parse(baris);
      } catch {
        continue; // baris sampah — sebagian server menulis banner ke stdout
      }
      this.terimaPesan(pesan);
    }
  }

  terimaPesan(pesan) {
    // Permintaan DARI server (sampling, elicitation, roots). Kita tidak
    // mengiklankan satu pun kapabilitas itu di initialize, jadi seharusnya tidak
    // pernah datang — tapi kalau datang, harus dijawab; membiarkannya menggantung
    // akan membuat server menunggu selamanya.
    if (pesan.method && pesan.id !== undefined) {
      this.tulis({
        jsonrpc: '2.0',
        id: pesan.id,
        error: { code: -32601, message: `Method not supported: ${pesan.method}` },
      });
      return;
    }
    if (pesan.id === undefined) return; // notifikasi dari server — diabaikan

    const tunggu = this.pending.get(pesan.id);
    if (!tunggu) return;
    this.pending.delete(pesan.id);
    clearTimeout(tunggu.timer);

    if (pesan.error) {
      tunggu.reject(new Error(pesan.error.message || 'Galat JSON-RPC tanpa pesan'));
    } else {
      tunggu.resolve(pesan.result);
    }
  }

  tulis(pesan) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error('Server MCP tidak aktif.');
    this.proc.stdin.write(JSON.stringify(pesan) + '\n');
  }

  /** Header untuk transport HTTP; `headers` di pengaturan mis. untuk API key. */
  headerHttp() {
    return {
      'Content-Type': 'application/json',
      // Wajib menyebut keduanya: server Streamable HTTP boleh menjawab dengan
      // JSON biasa atau SSE, dan memilihnya berdasarkan header ini.
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': VERSI_PROTOKOL,
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      ...(this.spec.headers || {}),
    };
  }

  async kirimHttp(method, params, batas) {
    const id = ++this.seq;
    let res;
    try {
      res = await fetch(this.spec.command.trim(), {
        method: 'POST',
        headers: this.headerHttp(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }),
        signal: AbortSignal.timeout(batas),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError') {
        throw new Error(`Server tidak menjawab dalam ${Math.round(batas / 1000)} detik (${method}).`);
      }
      throw new Error(`Tidak bisa menghubungi server: ${err?.message || String(err)}`);
    }

    // Sesi diberikan server di balasan initialize, lalu harus disertakan di
    // semua permintaan berikutnya. Server stateless tidak mengirimkannya.
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    const teks = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${teks.slice(0, 300)}`);
    }

    const tipe = res.headers.get('content-type') || '';
    const pesan = tipe.includes('text/event-stream') ? dariSse(teks, id) : JSON.parse(teks || '{}');
    if (!pesan) throw new Error('Server tidak mengirim balasan untuk permintaan ini.');
    if (pesan.error) throw new Error(pesan.error.message || 'Galat JSON-RPC tanpa pesan');
    return pesan.result;
  }

  kirim(method, params, batas = BATAS_PANGGIL) {
    if (this.http) return this.kirimHttp(method, params, batas);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Server tidak menjawab dalam ${Math.round(batas / 1000)} detik (${method}).`));
      }, batas);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.tulis({ jsonrpc: '2.0', id, method, params: params || {} });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  beritahu(method, params) {
    if (this.http) {
      // Notifikasi tidak punya id dan tidak ditunggu balasannya (202 tanpa isi).
      fetch(this.spec.command.trim(), {
        method: 'POST',
        headers: this.headerHttp(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {
        /* notifikasi boleh hilang */
      });
      return;
    }
    try {
      this.tulis({ jsonrpc: '2.0', method, params: params || {} });
    } catch {
      /* notifikasi boleh hilang */
    }
  }

  /** Prosesnya hilang — batalkan semua yang menunggu, jangan sampai menggantung. */
  mati(pesan) {
    if (this.status !== 'galat') {
      this.status = 'mati';
      this.error = pesan || '';
    }
    for (const [, tunggu] of this.pending) {
      clearTimeout(tunggu.timer);
      tunggu.reject(new Error(pesan || 'Server MCP berhenti.'));
    }
    this.pending.clear();
    this.proc = null;
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) {
      p.removeAllListeners('exit');
      p.removeAllListeners('error');
      try {
        p.kill();
      } catch {
        /* sudah mati */
      }
    }
    for (const [, tunggu] of this.pending) {
      clearTimeout(tunggu.timer);
      tunggu.reject(new Error('Server MCP dihentikan.'));
    }
    this.pending.clear();
    this.buf = '';
    // Sesi HTTP tidak boleh dipakai ulang setelah putus — server sudah
    // membuangnya, dan mengirimkannya lagi menghasilkan 404.
    this.sessionId = null;
    if (this.status !== 'galat') this.status = 'mati';
  }

  async call(namaAsli, input) {
    if (this.status !== 'siap') await this.start();
    const hasil = await this.kirim('tools/call', { name: namaAsli, arguments: input || {} });

    const teks = (hasil?.content || [])
      .map((b) => {
        if (b.type === 'text') return b.text || '';
        if (b.type === 'image') return `[gambar ${b.mimeType || 'tidak diketahui'} — tidak ditampilkan]`;
        if (b.type === 'resource') return b.resource?.text || `[resource ${b.resource?.uri || ''}]`;
        return `[blok ${b.type}]`;
      })
      .filter(Boolean)
      .join('\n');

    const isi =
      teks ||
      (hasil?.structuredContent ? JSON.stringify(hasil.structuredContent, null, 2) : '(tanpa keluaran)');

    // isError = tool-nya gagal, tapi panggilan JSON-RPC-nya sendiri sukses.
    // Dibedakan supaya modelnya melihat pesan galat dari server, bukan galat kita.
    if (hasil?.isError) {
      const err = new Error(clip(isi));
      err.dariTool = true;
      throw err;
    }
    return clip(isi);
  }
}

// --- Manajer: semua server yang terdaftar di settings.json ---------------

/** id server -> Server */
const daftar = new Map();
/** nama tool yang dilihat model -> { server, namaAsli } */
const peta = new Map();

function specDariConfig() {
  let cfg;
  try {
    cfg = config.load();
  } catch {
    return [];
  }
  return (cfg.mcpServers || []).filter((s) => s && s.enabled !== false && s.command);
}

/**
 * Nama yang dilihat model. Diberi awalan supaya tidak pernah bertabrakan dengan
 * tool bawaan, dan disaring supaya lolos aturan nama tool Anthropic:
 * ^[a-zA-Z0-9_-]{1,64}$.
 */
function namaTool(serverId, toolName) {
  const dasar = `mcp_${bersih(serverId)}_${bersih(toolName)}`;
  let nama = dasar.slice(0, 64);
  // Pemotongan 64 karakter bisa menyamakan dua nama yang aslinya beda.
  let n = 2;
  while (peta.has(nama)) {
    const akhiran = `_${n++}`;
    nama = dasar.slice(0, 64 - akhiran.length) + akhiran;
  }
  return nama;
}

function bangunPeta() {
  peta.clear();
  for (const srv of daftar.values()) {
    if (srv.status !== 'siap') continue;
    for (const alat of srv.tools) {
      peta.set(namaTool(srv.id, alat.name), { server: srv, namaAsli: alat.name, skema: alat });
    }
  }
}

/**
 * Nyalakan semua server yang diaktifkan, lalu segarkan daftar toolnya.
 * Dipanggil di awal tiap giliran. Server yang sudah hidup tidak disentuh.
 *
 * Tidak pernah melempar: server MCP yang mati tidak boleh membatalkan giliran —
 * agen tetap jalan dengan tool bawaan saja.
 */
async function siapkan() {
  const specs = specDariConfig();
  const idAktif = new Set(specs.map((s) => s.id));

  // Server yang dihapus atau dimatikan dari Pengaturan.
  for (const [id, srv] of [...daftar]) {
    if (!idAktif.has(id)) {
      srv.stop();
      daftar.delete(id);
    }
  }

  await Promise.all(
    specs.map(async (spec) => {
      const lama = daftar.get(spec.id);
      // Perintahnya berubah di Pengaturan — proses lama tidak lagi mewakilinya.
      if (lama && JSON.stringify(lama.spec) !== JSON.stringify(spec)) {
        lama.stop();
        daftar.delete(spec.id);
      }
      const srv = daftar.get(spec.id) || new Server(spec);
      daftar.set(spec.id, srv);
      if (srv.status === 'siap') return;
      // Server yang sudah gagal tidak dicoba ulang tiap giliran — biarkan
      // pengguna menekan Sambungkan di Pengaturan setelah memperbaikinya.
      if (srv.status === 'galat') return;
      try {
        await srv.start();
      } catch {
        /* pesannya sudah tersimpan di srv.error */
      }
    })
  );

  bangunPeta();
}

/** Definisi tool MCP untuk digabung dengan toolkit.definitions(). */
function definitions() {
  const keluar = [];
  for (const [nama, { skema, server }] of peta) {
    keluar.push({
      name: nama,
      description:
        `[MCP: ${server.spec.label || server.id}] ` +
        (skema.description || `Tool "${skema.name}" dari server MCP ${server.id}.`),
      input_schema: skema.inputSchema || { type: 'object', properties: {} },
    });
  }
  return keluar;
}

function punya(nama) {
  return peta.has(nama);
}

/**
 * Bentuknya sengaja meniru entri di tools.js, supaya agent.js bisa
 * memperlakukan tool MCP persis seperti tool bawaan — termasuk shouldAsk().
 */
function tool(nama) {
  const entri = peta.get(nama);
  if (!entri) return null;
  return {
    name: nama,
    description: entri.skema.description || '',
    // Selalu tanya: ini kode pihak ketiga, di luar sandbox folder kerja kita.
    needsApproval: true,
    mcp: true,
    run: (input) => entri.server.call(entri.namaAsli, input),
  };
}

/** Untuk panel Pengaturan: keadaan tiap server apa adanya. */
function status() {
  const specs = specDariConfig();
  return specs.map((spec) => {
    const srv = daftar.get(spec.id);
    return {
      id: spec.id,
      label: spec.label || spec.id,
      status: srv ? srv.status : 'mati',
      error: srv ? srv.error : '',
      tools: srv && srv.status === 'siap' ? srv.tools.map((alat) => alat.name) : [],
      serverInfo: srv ? srv.info : null,
    };
  });
}

/** Tombol "Sambungkan" di Pengaturan — paksa coba lagi meski sebelumnya galat. */
async function sambungkan(id) {
  const spec = (config.load().mcpServers || []).find((s) => s && s.id === id);
  if (!spec) throw new Error(`Server MCP "${id}" tidak ada di pengaturan.`);

  const lama = daftar.get(id);
  if (lama) lama.stop();

  const srv = new Server(spec);
  daftar.set(id, srv);
  try {
    await srv.start();
  } finally {
    bangunPeta();
  }
  return { id, tools: srv.tools.map((alat) => alat.name), serverInfo: srv.info };
}

function putuskan(id) {
  const srv = daftar.get(id);
  if (srv) {
    srv.stop();
    daftar.delete(id);
  }
  bangunPeta();
}

/** Wajib dipanggil sebelum aplikasi keluar — kalau tidak, prosesnya jadi yatim. */
function stopAll() {
  for (const srv of daftar.values()) srv.stop();
  daftar.clear();
  peta.clear();
}

module.exports = {
  siapkan,
  definitions,
  punya,
  tool,
  status,
  sambungkan,
  putuskan,
  stopAll,
};
