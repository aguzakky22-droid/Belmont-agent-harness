# Belmont Tools

Aplikasi desktop (Electron) untuk menjalankan agen AI dengan tools di komputer sendiri.
Tanpa bundler — HTML/CSS/JS-nya bisa langsung diedit, simpan, tekan `Ctrl+R`.

## Menjalankan

```powershell
npm install     # sekali saja
npm start
```

Untuk membuka DevTools sekaligus: `npm run dev`.

Pertama kali jalan: klik **Pengaturan** → pilih provider → tempel **API key** → pilih **folder kerja**.

## Provider

| Provider | Model bawaan | Autentikasi |
|---|---|---|
| **Claude Code (langganan)** | ikut default CLI | Login Claude Code — **tanpa API key** |
| Claude (Anthropic) | `claude-opus-5` | API key, console.anthropic.com |
| DeepSeek | `deepseek-chat` | API key, platform.deepseek.com |
| Kimi (Moonshot) | `kimi-k2-0905-preview` | API key, platform.moonshot.cn |
| GLM (Zhipu) | `glm-4.6` | API key, open.bigmodel.cn |

### Langganan Claude Max vs API key

Keduanya beda tagihan. **Langganan Max tidak bisa dipakai untuk memanggil Messages
API langsung** — tidak ada OAuth publik untuk itu, dan API key ditagih terpisah
lewat kredit API.

Yang memakai langganan: provider **Claude Code**. Provider ini menjalankan
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) yang otomatis
memakai login Claude Code kamu, jadi tidak ada field API key sama sekali. Kalau
belum pernah login, jalankan `claude` di terminal sekali.

Bedanya dengan provider lain — provider ini **mengurus loop-nya sendiri**:

- Tools yang dipakai milik Claude Code (`Read`, `Write`, `Edit`, `Bash`, `Glob`,
  `Grep`, `WebSearch`, `WebFetch`), **bukan** `tools.js` di repo ini.
- Yang tetap kita kendalikan: `cwd` dikunci ke folder proyek, dan setiap tool
  yang berpotensi merusak tetap lewat modal konfirmasi aplikasi (`canUseTool`).
  Tool baca-saja dilewatkan tanpa bertanya.
- `settingSources: []` — setting dan agent pribadi milik Claude Code kamu
  sengaja tidak dipungut, supaya aplikasi ini berperilaku sama di mesin mana pun.
- Riwayat percakapan dikelola Claude Code sendiri; kita menyimpan `resumeId`-nya
  di file proyek supaya giliran berikutnya menyambung sesi yang sama, dan
  mencerminkan teks + pemakaian tool ke riwayat kita untuk ditampilkan.

Provider bisa diganti kapan saja lewat dropdown di header — riwayat percakapan ikut terbawa,
karena disimpan dalam format netral, bukan format salah satu vendor.

### Daftar model

Daftar bawaan di `providers/index.js` hanya **cadangan** dan pasti akan usang.
Isi API key lalu klik **"Muat ulang"** di sebelah dropdown Model — aplikasi menarik
daftar asli dari endpoint `/models` provider dan menyimpannya. Itu sumber kebenarannya.

### Menambah provider baru

DeepSeek, Kimi, dan GLM semuanya OpenAI-compatible, jadi ketiganya dibuat dari satu pabrik
yang sama. Untuk menambah yang keempat, cukup tambah satu blok di
`src/main/providers/index.js`:

```js
const providerBaru = makeOpenAICompatProvider({
  id: 'namanya',
  label: 'Nama Tampil',
  baseURL: 'https://api.contoh.com/v1',
  models: ['model-a', 'model-b'],
});
```

lalu daftarkan di objek `PROVIDERS` dan tambahkan slot key-nya di `DEFAULTS.keys`
(`src/main/config.js`). Tidak ada file lain yang perlu disentuh — dropdown, halaman
pengaturan, dan field API key terisi otomatis.

Kalau API-nya punya bentuk sendiri (bukan OpenAI-compatible), tiru
`src/main/providers/anthropic.js`: satu objek dengan method `run()`.

## Tools

Semua tool dijalankan di komputer kamu (proses main Electron), bukan di server model —
jadi set tool yang sama berlaku untuk semua provider.

| Tool | Konfirmasi? | Fungsi |
|---|---|---|
| `list_dir` | – | Lihat isi folder |
| `read_file` | – | Baca file teks |
| `write_file` | ya | Buat / timpa file |
| `edit_file` | ya | Ganti sepotong teks di file |
| `run_shell` | ya | Jalankan perintah (PowerShell di Windows) |
| `web_search` | – | Cari di web |
| `web_fetch` | – | Ambil isi halaman web sebagai teks |

**Pengamanan:** semua operasi file dibatasi di dalam folder proyek — path yang keluar dari
sana (`..`, path absolut) ditolak.

### Mode izin

Tombol di bawah kolom chat, berlaku untuk semua provider:

| Mode | Perilaku |
|---|---|
| **Supervised** | Tanya sebelum menjalankan perintah dan mengubah file |
| **Auto-accept edits** | Perubahan file langsung disetujui; perintah shell tetap ditanya |
| **Full access** | Jalankan semuanya tanpa bertanya |

Tombol **"Selalu izinkan tool ini"** di modal konfirmasi kini **bertahan lintas giliran
dan lintas restart** — tersimpan per proyek di `approvedTools`. Berlaku juga untuk
provider Claude Code.

### Pertanyaan dari agen

Provider **Claude Code** punya tool `AskUserQuestion` — agen memakainya saat ada
keputusan yang memang milikmu (mis. "pakai library A atau B?"). Pertanyaannya
muncul sebagai kartu di dalam chat: tiap opsi jadi tombol, plus kolom **"Atau
tulis jawabanmu sendiri…"** kalau jawaban yang benar tidak ada di daftar.

Agen benar-benar **berhenti menunggu** kartu ini dijawab. Kalau kamu menekan
**Lewati**, agen diberi tahu secara eksplisit bahwa kamu tidak menjawab dan
diminta bertanya ulang sebagai teks biasa — bukan memilih sendiri.

Kartu ini bertahan saat kamu pindah proyek: ia digambar ulang begitu kamu
kembali, dan sidebar menandai proyeknya dengan titik oranye. Kalau Telegram
aktif, kamu dapat pemberitahuan bahwa ada pertanyaan menunggu di desktop.

### Menggulir saat agen menulis

Chat hanya ikut turun otomatis selama kamu memang sedang di dasar. Begitu kamu
menggulir ke atas untuk membaca, ia berhenti menyeretmu — agen boleh menulis
sepanjang apa pun. Tombol **"↓ Ke pesan terbaru"** muncul di atas kolom ketik
untuk kembali; mengirim pesan juga otomatis membawamu ke bawah lagi.

### Mengirim pesan saat agen masih bekerja

Tidak ditolak lagi — pesannya **mengantre**, dan agen tetap jalan. Barisnya
muncul di atas kolom ketik dengan dua tombol:

| Tombol | Yang terjadi |
|---|---|
| **Kirim sekarang** | Pesanmu diselipkan ke pekerjaan yang sedang berjalan. Agen **tidak** dihentikan — ia membacanya di batas langkah berikutnya, lalu menyesuaikan arah. |
| `×` | Batalkan pesan itu sebelum sempat terkirim. |

Dibiarkan saja, pesan antrean berangkat sendiri sebagai giliran berikutnya
begitu yang sekarang selesai. Gelembung chatmu baru digambar saat agen
benar-benar membacanya, jadi urutan percakapannya tetap jujur.

Menekan **Stop** menghentikan giliran sekarang **dan** mengosongkan antrean —
kalau tidak, Stop justru langsung menyalakan giliran berikutnya.

Berlaku untuk semua provider, lewat dua jalur: Claude Code menerimanya di
antrean masukan sesinya; provider lain disisipkan ke riwayat pada batas
langkah — satu-satunya titik aman, karena menyelipkannya di tengah rangkaian
`tool_use`/`tool_result` membuat riwayatnya ditolak API.

### Lampiran

Tiga cara: tombol 🖼, seret-dan-jatuhkan, atau **tempel langsung (`Ctrl+V`)** —
termasuk tangkapan layar yang belum pernah disimpan ke disk. Tempelan gambar
ditulis dulu sebagai file di folder temp, karena provider Claude Code menerima
*path* dan membacanya sendiri, bukan base64. File tempelan yang lebih tua dari
7 hari dibuang saat aplikasi dibuka.

Tombol 🖼 di bawah kolom chat membuka dialog file (bisa pilih banyak sekaligus).
Gambar (`png/jpg/gif/webp`, maks 4 MB) dikirim sebagai gambar sungguhan ke model;
file teks disisipkan isinya (maks 100 rb karakter). File biner selain gambar ditolak
dengan pesan jelas, bukan dikirim sebagai sampah. Untuk provider Claude Code, path
file diteruskan supaya dibaca sendiri dengan tool `Read`.

### Indikator konteks

Setelah tiap giliran, header menampilkan `Context N% left`. Klik untuk rincian:
`Used / total`, `Fresh`, `Cache read`, `Cache write`, `Output` — angka asli dari
`usage` yang dikembalikan provider.

### Pilihan yang bisa diklik

Kalau jawaban agen memuat baris `- [] ...` (atau blok `<options>…</options>`),
baris itu dirender sebagai tombol: **klik = langsung terkirim**. Tiap pilihan dan
tiap jawaban juga punya tombol **Salin**.

**Catatan `web_search`:** tanpa API key, pencarian pakai scraping DuckDuckGo — gratis tapi
rapuh (formatnya bisa berubah sewaktu-waktu, dan sebagian jaringan memblokirnya). Untuk
hasil yang andal, isi **Tavily API key** di Pengaturan. Kalau pencarian gagal, agen
mendapat pesan error yang jelas dan biasanya beralih ke `web_fetch`.

## Proyek (sidebar)

Panel kiri menampilkan semua proyek, terbaru di atas: judul, nama folder kerjanya,
dan umurnya (`baru`, `12m`, `3j`, `2h`, lalu tanggal).

**Tiap proyek dikunci ke satu folder.** Menekan `+` membuka dialog "pilih folder"
lebih dulu — batal memilih berarti tidak ada proyek yang dibuat. Selama proyek itu
terbuka, agen hanya bisa membaca dan menulis di dalam folder tersebut; path yang
keluar darinya ditolak. Jadi tidak ada risiko agen menyentuh proyek sebelah.

| Aksi | Cara |
|---|---|
| Proyek baru | Tombol `+` → pilih folder |
| Buka | Klik barisnya |
| Ganti nama | Klik ganda judulnya, ketik, Enter (Esc batal) |
| Ganti folder | Klik path folder di header |
| Hapus | Hover baris → tombol `×` (minta konfirmasi) |
| Sembunyikan panel | Chevron `⌄`; munculkan lagi lewat `☰` di header |

### Beberapa proyek bisa jalan bersamaan

Tiap proyek punya agennya sendiri. Pindah proyek **tidak** menghentikan giliran
yang sedang berjalan — proyek yang kamu tinggal terus bekerja di latar, dan
titik kecil di sebelah namanya di sidebar berdenyut selama itu.

Yang perlu diketahui:

- **Chat proyek latar tidak digambar sambil jalan.** Kemajuannya disimpan tiap
  langkah (tiap pesan asisten dan tiap hasil tool), jadi saat kamu kembali
  riwayatnya lengkap sampai langkah terakhir dan penanda "Berjalan…" muncul
  lagi. Kalau kamu masuk di tengah sebuah pesan, layarnya disusun ulang begitu
  pesan itu selesai — jadi tidak ada jawaban yang terpotong separuh.
- **Modal izin tool mengantre per proyek.** Permintaan dari proyek latar tidak
  memotong layar — titik di sidebar berubah oranye, dan modalnya muncul saat
  kamu membuka proyek itu. Agennya menunggu di sana. Lewat Telegram, permintaan
  itu tetap sampai sekarang juga, dengan nama proyeknya di depan.
- **Sesi Claude Code proyek yang menganggur ditutup saat ditinggal**, supaya
  tiap proyek yang pernah dibuka tidak menahan satu subprocess CLI selamanya.
  Proyek yang sedang bekerja tidak disentuh.
- **Ketikan yang belum dikirim menempel pada proyeknya.** Draf dan lampiran
  yang sudah dipilih ikut disimpan saat kamu pindah, lalu muncul lagi apa
  adanya begitu kamu kembali — bukan terbawa ke proyek sebelah. (Disimpan di
  memori, jadi hilang kalau aplikasinya ditutup atau di-`Ctrl+R`.)
- **Telegram tetap menyasar proyek yang sedang ditampilkan.** `/proyek <n>`
  memindahkan fokus itu; `/status` menyebutkan berapa proyek lain sedang bekerja.

Judul terisi otomatis dari pesan pertama kamu. Riwayat disimpan sebagai satu file
JSON per proyek di `%APPDATA%/belmont-tools/sessions/`, dalam format blok netral —
jadi proyek lama tetap bisa dibuka meski kamu sudah ganti provider.

Folder di Pengaturan hanya jadi titik awal dialog saat membuat proyek baru, bukan
folder yang dipakai agen. Proyek yang dibuat sebelum fitur ini ada (belum punya
folder sendiri) jatuh kembali ke folder default itu.

Lebar panel diatur lewat `--sidebar-width` di `theme.css`.

## Mengubah tampilan

`src/renderer/theme.css` — semua warna, radius, font, dan lebar area chat ada di sini
sebagai CSS variable. Ubah nilainya, simpan, `Ctrl+R`. Ada contoh tema terang yang tinggal
dilepas komentarnya di bagian bawah file.

`src/renderer/app.css` — struktur dan layout, kalau mau mengubah lebih dari sekadar warna.

Tombol **Buka theme.css** di halaman Pengaturan langsung menunjukkan file-nya di Explorer.

## Struktur

```
src/
  main/
    main.js              jendela + jembatan IPC
    preload.js           API sempit yang dilihat UI
    config.js            pengaturan (userData/settings.json)
    sessions.js          simpan/muat percakapan (userData/sessions/)
    agent.js             loop agen: model -> tool -> model
    tools.js             implementasi semua tool
    providers/
      index.js           daftar provider
      claude-code.js     Claude Agent SDK (pakai langganan, loop sendiri)
      anthropic.js       Claude via API key
      openai-compat.js   pabrik untuk DeepSeek / Kimi / GLM
  renderer/
    index.html
    theme.css            <- ubah tampilan di sini
    app.css
    renderer.js
```

Pengaturan dan API key disimpan di `%APPDATA%/belmont-tools/settings.json`
(plain text — perlakukan seperti file rahasia).
