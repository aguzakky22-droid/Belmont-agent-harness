'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

/**
 * Semua tool dijalankan di sisi klien (proses main Electron), bukan di server
 * model. Artinya set tool yang sama jalan di Claude, DeepSeek, Kimi, dan GLM.
 *
 * Tiap tool punya:
 *   name, description, input_schema  -> dikirim ke model
 *   needsApproval                    -> true kalau harus dikonfirmasi user
 *   run(input, ctx)                  -> string hasil
 */

const MAX_OUTPUT = 30000;

function clip(s) {
  s = String(s ?? '');
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n\n[...dipotong, total ${s.length} karakter]`
    : s;
}

/**
 * Selesaikan path relatif terhadap workingDir dan pastikan tidak keluar dari
 * situ. Ini satu-satunya pintu masuk path dari model — jangan bypass.
 */
function safePath(ctx, p) {
  if (!p) throw new Error('path kosong');
  const root = path.resolve(ctx.workingDir);
  const full = path.resolve(root, p);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Akses ditolak: "${p}" ada di luar folder kerja (${root}). ` +
        'Ubah folder kerja di Pengaturan kalau memang perlu.'
    );
  }
  return full;
}

const tools = [
  {
    name: 'list_dir',
    description:
      'Daftar isi sebuah folder di dalam folder kerja. Pakai ini dulu untuk orientasi sebelum membaca file.',
    needsApproval: false,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path folder relatif terhadap folder kerja. Pakai "." untuk root.' },
      },
      required: ['path'],
    },
    async run(input, ctx) {
      const dir = safePath(ctx, input.path || '.');
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (!entries.length) return '(folder kosong)';
      const lines = await Promise.all(
        entries.map(async (e) => {
          if (e.isDirectory()) return `dir   ${e.name}/`;
          try {
            const st = await fs.stat(path.join(dir, e.name));
            return `file  ${e.name}  (${st.size} bytes)`;
          } catch {
            return `file  ${e.name}`;
          }
        })
      );
      return clip(lines.sort().join('\n'));
    },
  },

  {
    name: 'read_file',
    description: 'Baca isi sebuah file teks. Hasilnya diberi nomor baris.',
    needsApproval: false,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file relatif terhadap folder kerja.' },
        offset: { type: 'integer', description: 'Mulai dari baris ke-berapa (1-based). Opsional.' },
        limit: { type: 'integer', description: 'Berapa baris yang dibaca. Opsional, default 2000.' },
      },
      required: ['path'],
    },
    async run(input, ctx) {
      const file = safePath(ctx, input.path);
      const raw = await fs.readFile(file, 'utf8');
      const all = raw.split('\n');
      const start = Math.max(0, (input.offset || 1) - 1);
      const end = Math.min(all.length, start + (input.limit || 2000));
      const body = all
        .slice(start, end)
        .map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}`)
        .join('\n');
      return clip(body || '(file kosong)');
    },
  },

  {
    name: 'write_file',
    description:
      'Tulis file (buat baru atau timpa seluruh isinya). Untuk perubahan kecil pada file yang sudah ada, lebih baik pakai edit_file.',
    needsApproval: true,
    kind: 'edit',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file relatif terhadap folder kerja.' },
        content: { type: 'string', description: 'Isi lengkap file.' },
      },
      required: ['path', 'content'],
    },
    async run(input, ctx) {
      const file = safePath(ctx, input.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, input.content, 'utf8');
      return `Tersimpan: ${path.relative(ctx.workingDir, file)} (${input.content.length} karakter)`;
    },
  },

  {
    name: 'edit_file',
    description:
      'Ganti satu potongan teks di dalam file. old_string harus cocok persis dan hanya muncul sekali.',
    needsApproval: true,
    kind: 'edit',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file relatif terhadap folder kerja.' },
        old_string: { type: 'string', description: 'Teks lama yang mau diganti (harus unik di file).' },
        new_string: { type: 'string', description: 'Teks penggantinya.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async run(input, ctx) {
      const file = safePath(ctx, input.path);
      const raw = await fs.readFile(file, 'utf8');
      const parts = raw.split(input.old_string);
      if (parts.length === 1) throw new Error('old_string tidak ditemukan di file.');
      if (parts.length > 2)
        throw new Error(
          `old_string muncul ${parts.length - 1} kali. Perpanjang potongannya supaya unik.`
        );
      await fs.writeFile(file, parts.join(input.new_string), 'utf8');
      return `Diubah: ${path.relative(ctx.workingDir, file)}`;
    },
  },

  {
    name: 'run_shell',
    description:
      'Jalankan perintah shell di folder kerja. Di Windows dijalankan lewat PowerShell. ' +
      'Perintah interaktif (yang menunggu input) akan menggantung — hindari.',
    needsApproval: true,
    kind: 'exec',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Perintah yang dijalankan.' },
        timeout_ms: { type: 'integer', description: 'Batas waktu dalam milidetik. Default 120000.' },
      },
      required: ['command'],
    },
    async run(input, ctx) {
      const isWin = os.platform() === 'win32';
      const file = isWin ? 'powershell.exe' : '/bin/bash';
      const args = isWin
        ? ['-NoProfile', '-NonInteractive', '-Command', input.command]
        : ['-lc', input.command];

      return new Promise((resolve) => {
        execFile(
          file,
          args,
          {
            cwd: ctx.workingDir,
            timeout: input.timeout_ms || 120000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          },
          (err, stdout, stderr) => {
            const parts = [];
            if (stdout) parts.push(stdout);
            if (stderr) parts.push(`[stderr]\n${stderr}`);
            if (err && err.killed) parts.push('[perintah dihentikan karena timeout]');
            else if (err) parts.push(`[exit code ${err.code ?? 1}]`);
            resolve(clip(parts.join('\n').trim() || '(tidak ada output)'));
          }
        );
      });
    },
  },

  {
    name: 'web_search',
    description:
      'Cari informasi di web. Pakai untuk hal yang butuh data terkini atau di luar pengetahuanmu.',
    needsApproval: false,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian.' },
      },
      required: ['query'],
    },
    async run(input, ctx) {
      if (ctx.tavilyKey) return clip(await tavilySearch(input.query, ctx.tavilyKey));
      return clip(await duckSearch(input.query));
    },
  },

  {
    name: 'web_fetch',
    description:
      'Ambil isi sebuah halaman web (URL lengkap) dan kembalikan sebagai teks polos.',
    needsApproval: false,
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL lengkap, termasuk https://' },
      },
      required: ['url'],
    },
    async run(input) {
      const res = await fetch(input.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentTools/0.1)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} saat mengambil ${input.url}`);
      const html = await res.text();
      return clip(htmlToText(html));
    },
  },
];

async function tavilySearch(query, key) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 6, include_answer: true }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  const lines = [];
  if (data.answer) lines.push(`Ringkasan: ${data.answer}\n`);
  for (const r of data.results || []) {
    lines.push(`- ${r.title}\n  ${r.url}\n  ${(r.content || '').slice(0, 400)}`);
  }
  return lines.join('\n') || 'Tidak ada hasil.';
}

const DDG_ENDPOINTS = ['https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/'];

async function duckSearch(query) {
  const problems = [];

  for (const endpoint of DDG_ENDPOINTS) {
    let html;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: new URLSearchParams({ q: query }).toString(),
      });
      if (!res.ok) {
        problems.push(`${endpoint} -> HTTP ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      problems.push(`${endpoint} -> ${err.cause?.code || err.message}`);
      continue;
    }

    const parsed = parseDuckHtml(html);
    if (parsed) return parsed;
    problems.push(`${endpoint} -> tidak ada hasil yang bisa diurai`);
  }

  throw new Error(
    'Pencarian web gagal. ' +
      problems.join('; ') +
      '. Coba isi Tavily API key di Pengaturan untuk pencarian yang lebih andal, ' +
      'atau pakai tool web_fetch kalau URL-nya sudah diketahui.'
  );
}

/** Urai hasil dari halaman DDG html/ maupun lite/. Kembalikan null kalau kosong. */
function parseDuckHtml(html) {
  const results = [];
  let m;

  // Varian html/: <a class="result__a" href="...">judul</a>
  const reFull = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = reFull.exec(html)) && results.length < 8) {
    results.push({ url: decodeDuckUrl(m[1]), title: stripTags(m[2]) });
  }

  // Varian lite/: <a class="result-link" href="...">judul</a>
  if (!results.length) {
    const reLite = /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = reLite.exec(html)) && results.length < 8) {
      results.push({ url: decodeDuckUrl(m[1]), title: stripTags(m[2]) });
    }
  }

  if (!results.length) return null;

  const snippets = [];
  const reSnip = /class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>/g;
  while ((m = reSnip.exec(html))) snippets.push(stripTags(m[1]));

  return results.map((r, i) => `- ${r.title}\n  ${r.url}\n  ${snippets[i] || ''}`).join('\n');
}

function decodeDuckUrl(href) {
  const m = /uddg=([^&]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : href;
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

/** Definisi yang dikirim ke model (tanpa run/needsApproval). */
function definitions() {
  return tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}

module.exports = { tools, byName, definitions, safePath };
