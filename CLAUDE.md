# Belmont Tools

Aplikasi desktop Electron untuk menjalankan agen AI. Mendukung Claude Code
(langganan), Claude (Anthropic API), DeepSeek, Kimi, dan GLM.

## Aturan wajib

### Jangan pernah menjalankan aplikasinya

**Dilarang `npm start`, `npm run dev`, atau `electron .`.**

Pengguna memakai Belmont Tools ini untuk chat dengan agen — termasuk sesi yang
sedang berlangsung saat kamu bekerja. Menjalankan aplikasinya memutus sesi itu
dan chat-nya berhenti di tengah jalan.

Verifikasi cukup dengan `node --check <file>` dan membaca kode. Tidak ada
pengecualian, sekalipun cuma "sebentar untuk memastikan".

### Build `.exe` harus ditanya dulu

Setelah mengubah kode, **jangan langsung build**. Sampaikan berapa file yang
berubah lalu tanyakan apakah mau di-build ulang — pengguna yang memutuskan.

Alasannya: `npm run build` makan beberapa menit dan menghasilkan ~149 MB tiap
kali, sementara `.exe` biasanya baru dibutuhkan setelah beberapa perbaikan
terkumpul, saat mau dikirim ke PC lain.

`npm run build` sendiri aman dijalankan — electron-builder hanya mengemas, tidak
menjalankan aplikasinya. Hasilnya dua file di `dist/`:

- `Belmont Tools Setup <versi>.exe` — installer NSIS
- `Belmont Tools <versi> portable.exe` — portable

## Yang perlu diketahui

### Data pengguna ada di luar folder proyek

```
C:\Users\<nama>\AppData\Roaming\belmont-tools\
   ├─ sessions\<id>.json   riwayat chat (format blok netral, bukan format provider)
   └─ settings.json        API key, model, tema, windowBounds
```

Nama foldernya `belmont-tools` (dari `name` di package.json), **bukan**
`Belmont Tools` — `productName` ada di dalam blok `build` yang cuma dibaca
electron-builder, tidak oleh Electron. Jadi `npm start`, versi portable, dan
versi terpasang semuanya memakai folder yang sama.

Menimpa kode atau memasang ulang aplikasi tidak menghapus data ini.

### Efek perubahan kode

| Yang diubah | Cara memuat ulang |
|---|---|
| `src/renderer/**` | `Ctrl+R` di aplikasi |
| `src/main/**` (termasuk `preload.js`) | aplikasi harus ditutup & dibuka **oleh pengguna** |

Tidak ada bundler — file dimuat apa adanya.

`preload.js` adalah jebakan yang paling sering memakan korban: ia **tidak** ikut
`Ctrl+R`. Kalau fitur baru menambah jembatan di sana, sebutkan bahwa restart
penuh diperlukan, dan beri penjagaan di renderer:

```js
if (!window.api.fungsiBaru) { /* tampilkan "restart dulu", jangan menggantung */ }
```

Tanpa itu, `await` ke fungsi yang belum ada tidak pernah selesai dan UI-nya diam
tanpa sebab yang kelihatan.

### Claude Code tidak perlu dipasang terpisah

`@anthropic-ai/claude-agent-sdk` membawa binary-nya sendiri sebagai
optionalDependency per platform:

```
node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe   ~207 MB
```

`claude` **tidak ada di PATH** mesin ini, dan memang tidak perlu. Kredensial
login ada di `~/.claude/.credentials.json`, diisi oleh binary itu.

Binary tersebut **sengaja tidak diikutkan** ke installer (149 MB → ~220 MB kalau
diikutkan). Karena itu di PC lain provider Claude Code memunculkan panel panduan
pemasangan; lihat `src/main/claude-auth.js` dan penjagaan `provider.selfDriving`
di `agent.js`.

Perintah berguna: `claude auth status` mengembalikan JSON rapi dalam ~0,3 detik.

### i18n: dua kamus terpisah

| Berkas | Untuk | Isi |
|---|---|---|
| `src/renderer/i18n.js` | antarmuka | `t()` global + `terapkanBahasa()` |
| `src/main/i18n.js` | proses main | `t()` yang membaca `config.load().language` tiap panggilan |

Di HTML pakai `data-i18n`, `data-i18n-html`, `data-i18n-title`, `data-i18n-ph`.

**Yang TIDAK boleh diterjemahkan:** deskripsi tool, hasil tool, dan kerangka
system prompt di `agent.js`. Itu bagian dari prompt, bukan antarmuka —
menerjemahkannya lewat setelan UI mengubah apa yang dibaca model dan
membatalkan prompt cache. Alasannya ditulis di kepala `src/main/i18n.js`.

**Teks yang tersimpan ke disk tidak ikut berganti bahasa.** Judul sesi pernah
kena: ia ditulis harfiah ("Percakapan baru") ke berkas sesi saat dibuat, jadi
kebal terhadap setelan bahasa selamanya. Polanya sekarang: simpan **string
kosong** sebagai penanda "belum diisi", lalu terjemahkan saat digambar —
`judulSesi()` ada di `sessions.js` (untuk Telegram) dan `renderer.js` (untuk
jendela). Keduanya memegang daftar `JUDUL_BAWAAN_LAMA` supaya sesi lama ikut
terselamatkan; kalau salah satu berubah, ubah keduanya.

Kalau menambah teks bawaan yang ikut tersimpan, tanyakan dulu: apakah ini akan
tetap benar setelah pengguna mengganti bahasa?

### Server MCP adalah kode pihak ketiga

`src/main/mcp.js` menjalankan server MCP sebagai proses anak dan menyodorkan
toolnya ke model bersama tool bawaan. Dua hal yang harus dijaga:

- **`safePath()` tidak berlaku untuk mereka.** Sandbox folder kerja itu milik
  `tools.js`; server MCP adalah program lain, dengan hak aksesnya sendiri.
  Karena itu semua tool MCP dipaksa `needsApproval: true` di `mcp.tool()` —
  jangan dilonggarkan, termasuk untuk mode izin `acceptEdits`.
- **`mcp.siapkan()` tidak boleh melempar.** Server yang mati cuma berarti
  toolnya absen; giliran agen harus tetap jalan dengan tool bawaan.

Dua transport, dipilih dari bentuk `command`: URL `https://…` berarti Streamable
HTTP, selain itu stdio. Server HTTP boleh menjawab dengan `application/json`
**atau** `text/event-stream` untuk permintaan yang sama, jadi keduanya harus
ditangani — lihat `dariSse()`.

Di Windows, server stdio di-spawn lewat `shell: true` karena `npx` sebenarnya
`npx.cmd`, dan sejak Node 18.20/20.12 berkas `.cmd` tidak bisa di-spawn langsung
(CVE-2024-27980). Konsekuensinya argumen harus dikutip sendiri — Node cuma
menyambung argv pakai spasi kalau `shell: true`. Lihat `kutip()`.

Provider `claude-code` bersifat `selfDriving` dan tidak melewati `executeTool()`
sama sekali, jadi ia TIDAK memakai klien MCP kita. Sebagai gantinya daftar
server diserahkan ke Agent SDK lewat opsi `mcpServers` (`mcp.untukAgentSdk()`),
dan SDK yang menyambungnya sendiri. Konsekuensinya:

- **Server yang sama bisa hidup dua kali** — satu instance milik `mcp.js` (untuk
  provider lain), satu milik SDK. Disengaja; siklus hidupnya berbeda.
- **Nama toolnya `mcp__<server>__<tool>`** (dua garis bawah, konvensi SDK), bukan
  `mcp_<server>_<tool>` milik kita. Tidak pernah bertemu dalam satu percakapan.
- **Persetujuan lewat `canUseTool`**, bukan `shouldAsk()`. Kedua tempat harus
  menjaga aturan yang sama: tool MCP selalu ditanya walau mode izin `full`,
  kecuali sudah "selalu izinkan". Kalau salah satu diubah, ubah keduanya.
- `settingSources` tetap `[]`, jadi daftar server datang HANYA dari config kita,
  bukan dari `~/.claude` milik pengguna.

### Nama global pendek gampang bertabrakan

Dalam satu hari ada lima tabrakan yang semuanya menghasilkan bug diam:

- `t` sebagai variabel lokal menutupi fungsi penerjemah → `t is not a function`.
  Sudah terjadi di `ringkasanBagian()`, `finishThinking()`, `bridge.start()`, dan
  `laporkanGiliran()`. **Jangan pernah menamai variabel `t`.**
- Kelas CSS `.group-head` dipakai sidebar dan grup kartu tool sekaligus →
  judul grup tool ikut mengecil dan jadi HURUF BESAR. Sidebar sekarang memakai
  awalan `.folder-*`.

Sebelum memakai nama pendek, cari dulu apakah sudah dipakai.

### Karakter kendali ditulis sebagai escape, bukan aslinya

`markdownToHtml()` memakai NUL sebagai pengapit penanda blok kode — pilihan yang
benar, karena NUL mustahil muncul di jawaban model. Tapi sempat ditulis sebagai
byte NUL harfiah, dan itu membuat semua alat baris perintah menganggap
`renderer.js` sebagai **berkas biner**: pencarian di berkas terbesar proyek ini
berhenti di `binary file matches` alih-alih menunjukkan barisnya.

Sekarang ditulis `\u0000`. Nilainya saat dijalankan sama persis. Kalau butuh
karakter kendali lain, tulis escapenya — jangan pernah karakternya sendiri.

### Jangan menyunting berkas sumber lewat PowerShell

`Set-Content`/`Out-File` di PowerShell 5.1 merusak encoding berkas ini.

Sebabnya: berkas sumber di sini UTF-8 **tanpa BOM**, sedangkan `Get-Content`
tanpa `-Encoding` membacanya sebagai Windows-1252. Setiap em dash (`—`) dan
elipsis (`…`) di komentar berubah jadi `â€"`, lalu ikut tertulis balik. Sekali
kejadian: 35 kerusakan di `main.js`, 91 di `renderer.js` — dari satu perintah
`.Replace()` yang kelihatannya tidak berbahaya.

Pakai tool **Edit** untuk semua perubahan berkas, walaupun berarti beberapa
panggilan terpisah. PowerShell hanya untuk hal yang memang bukan penyuntingan:
`node --check`, `npm run build`, `Get-ChildItem`, `Remove-Item`.

Kalau terlanjur rusak, pemulihannya: baca sebagai UTF-8, tulis balik sebagai
byte 1252 — itu mengembalikan byte aslinya.

```powershell
$s = [System.IO.File]::ReadAllText($full, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllBytes($full, [System.Text.Encoding]::GetEncoding(1252).GetBytes($s))
```

Deteksinya cepat: cari `â€` di berkasnya.

### Lingkungan

- `git` **tidak terpasang** di mesin ini. Perintah git akan gagal.
- PowerShell 5.1: `&&` dan `||` tidak ada. Pakai `;` atau `if ($?) { }`.

## Bahasa

Pengguna berbahasa Indonesia. Jawab dan tulis komentar kode dalam bahasa
Indonesia. Komentar menjelaskan **kenapa**, bukan mengulang apa yang sudah
terbaca dari kodenya.

Pengecualian: teks yang dibaca **model** ditulis dalam bahasa Inggris —
`systemPrompt` di `config.js` serta `FORMAT_GUIDANCE`, `SUGGESTION_FORMAT`, dan
`COMPACT_REQUEST` di `agent.js`. Bahasa antarmuka bawaan juga `en`; pengguna
memilih Indonesia sendiri lewat Pengaturan.
