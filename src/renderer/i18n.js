'use strict';

/**
 * Kamus antarmuka.
 *
 * Tahap 1 — yang paling sering dilihat: sidebar, bar komposer, status bar, dan
 * panel Pengaturan. Pesan galat, dialog konfirmasi, balasan bot Telegram, dan
 * teks dari proses main menyusul di tahap berikutnya, jadi untuk sekarang
 * bagian itu masih berbahasa Indonesia walau bahasanya diganti ke English.
 *
 * Aturan main:
 * - Kunci memakai titik sebagai pemisah wilayah: "sidebar.kosong".
 * - Penanda isian ditulis {begini}, diisi lewat argumen kedua t().
 * - Kunci yang berakhiran "Html" boleh memuat tag; dipasang lewat innerHTML,
 *   dan isinya selalu dari berkas ini — tidak pernah dari luar.
 * - Komentar di dalam kode TIDAK diterjemahkan. Itu untuk yang membaca kode,
 *   bukan untuk yang memakai aplikasi.
 */

const KAMUS = {
  id: {
    // --- Sidebar & header ---
    'sidebar.judul': 'PROYEK',
    'sidebar.baru': 'Percakapan baru',
    'sidebar.proyekBaru': 'Proyek baru (pilih folder)…',
    'sidebar.sembunyi': 'Sembunyikan panel (Ctrl+B)',
    'sidebar.tampil': 'Tampilkan panel (Ctrl+B)',
    'sidebar.didukung': 'didukung oleh',
    'sidebar.kosongHtml': 'Belum ada proyek. Klik <b>ikon folder</b> di atas untuk membuatnya.',
    'sidebar.hapusSesi': 'Hapus percakapan',
    'sidebar.sesiBaru': 'Percakapan baru di {dir}',
    'sidebar.sesiBaruUmum': 'folder ini',
    'sidebar.tanpaFolder': '(tanpa folder)',
    'sidebar.tanpaFolderTip': 'Sesi ini belum terikat ke folder mana pun',
    'header.gantiNama': 'Klik untuk mengganti nama proyek',
    'header.gantiFolder': 'Klik untuk mengganti folder proyek',
    'header.pengaturan': 'Pengaturan',
    'header.belumAdaProyek': '(belum ada proyek)',

    // --- Layar kosong ---
    'kosong.judul': 'Belum ada proyek',
    'kosong.isi': 'Buat proyek baru dan pilih folder kerjanya.',

    // --- Komposer ---
    'komposer.ketik': 'Tulis pesan…  (Enter kirim, Shift+Enter baris baru)',
    'komposer.ketikSibuk': 'Tulis pesan…  (masuk antrean, agen tetap bekerja)',
    'komposer.kirim': 'Kirim',
    'komposer.antre': 'Antre',
    'komposer.stop': 'Stop',
    'komposer.keBawah': 'Ke pesan terbaru',
    'komposer.lampir': 'Lampirkan file atau gambar',
    'komposer.lampirGambarMati': 'Model ini tidak menerima gambar',
    'komposer.seret': 'Lepaskan file di sini untuk melampirkan',
    'komposer.seretKet': 'Gambar dikirim sebagai gambar; file teks disisipkan isinya',

    // --- Mode izin ---
    'perm.supervised': 'Supervised',
    'perm.supervisedKet': 'Tanya sebelum menjalankan perintah dan mengubah file.',
    'perm.acceptEdits': 'Auto-accept edits',
    'perm.acceptEditsKet': 'Perubahan file langsung disetujui, sisanya tetap ditanya.',
    'perm.full': 'Full access',
    'perm.fullKet': 'Jalankan perintah dan perubahan tanpa bertanya.',

    // --- Pemilih provider / model / effort ---
    'pick.provider': 'Provider',
    'pick.model': 'Model',
    'pick.effort': 'Kedalaman berpikir',
    'pick.effortTidak': '{provider} tidak mendukung pengaturan effort',
    'pick.kosong': 'Belum ada pilihan.',
    'pick.bawaan': 'Bawaan',
    'pick.custom': 'Custom',
    'pick.cariModel': 'Cari model…',
    'pick.cariKosong': 'Tidak ada model yang cocok.',
    'pick.modGambar': 'gambar',
    'effort.low': 'Paling cepat, paling hemat token',
    'effort.medium': 'Seimbang — bawaan',
    'effort.high': 'Menjelajah dan membaca lebih banyak',
    'effort.xhigh': 'Lebih dalam lagi, konteks cepat penuh',
    'effort.max': 'Sedalam mungkin, paling boros',

    // --- Status bar ---
    'sb.context': 'Context',
    'sb.used': 'Used',
    'sb.fresh': 'Fresh',
    'sb.cacheRead': 'Cache read',
    'sb.cacheWrite': 'Cache write',
    'sb.output': 'Output',
    'sb.compact': 'Compact',
    'sb.compactTip': 'Ringkas percakapan — konteks mengecil, isi chat tetap',

    // --- Pengaturan: rangka ---
    'set.judul': 'Pengaturan',
    'set.sub': 'Tersimpan lokal di komputer ini.',
    'set.secProvider': 'Provider & model',
    'set.secTampilan': 'Tampilan',
    'set.secProyek': 'Proyek & system prompt',
    'set.secMcp': 'Server MCP',
    'set.secTelegram': 'Telegram bot',
    'set.secLanjutan': 'Lanjutan',
    'set.simpan': 'Simpan',
    'set.batal': 'Batal',
    'set.hapus': 'Hapus',
    'set.aktif': 'aktif',
    'set.nonaktif': 'nonaktif',
    'set.belumDisetel': 'belum disetel',

    // --- Pengaturan: provider & model ---
    'set.provider': 'Provider',
    'set.epBaruOpsi': '+ Tambah endpoint baru…',
    'set.epJudul': 'Endpoint custom',
    'set.epJudulBaru': 'Endpoint custom baru',
    'set.epJudulUbah': 'Ubah endpoint — {nama}',
    'set.epNamaPh': 'Nama, mis. ONToken.id',
    'set.epUrlPh': 'https://api.ontoken.id/v1',
    'set.epKeyPh': 'API key — kosongkan untuk server lokal',
    'set.epSimpan': 'Simpan endpoint',
    'set.epNoteHtml':
      'Base URL berhenti di <code>/v1</code> — bagian <code>/chat/completions</code> ' +
      'dan <code>/models</code> ditambahkan sendiri oleh aplikasi. Server lokal ' +
      '(Ollama <code>http://localhost:11434/v1</code>, LM Studio ' +
      '<code>http://localhost:1234/v1</code>) tidak butuh API key — biarkan kosong.',
    'set.model': 'Model',
    'set.muatUlang': 'Muat ulang',
    'set.muatUlangTip': 'Tarik daftar model terbaru dari provider',
    'set.modelNote':
      'Daftar bawaan bisa usang. Klik "Muat ulang" untuk menarik daftar asli dari ' +
      'provider — isi API key dulu kalau providernya memang memintanya.',
    'set.modelKosong': '(belum ada — klik "Muat ulang")',
    'set.apiKey': 'API Key',
    'set.apiKeyPh': 'Tempel API key di sini',

    // --- Pengaturan: tampilan ---
    'set.tema': 'Tema',
    'set.temaNote': 'Klik untuk langsung mencobanya. Tekan Batal kalau mau kembali ke tema semula.',
    'set.bahasa': 'Bahasa',
    'set.bahasaNote':
      'Tahap pertama: sidebar, komposer, status bar, dan panel ini. Pesan galat dan ' +
      'balasan bot Telegram masih berbahasa Indonesia.',

    // --- Pengaturan: proyek ---
    'set.folder': 'Folder default untuk proyek baru',
    'set.pilihFolder': 'Pilih…',
    'set.folderNote':
      'Hanya titik awal dialog "pilih folder" saat membuat proyek. Tiap proyek punya ' +
      'foldernya sendiri, dan agen tidak bisa keluar dari folder proyek yang sedang dibuka.',
    'set.systemPrompt': 'System prompt',

    // --- Pengaturan: server MCP ---
    'set.mcpIntroHtml':
      'MCP (Model Context Protocol) adalah cara standar menambah tool dari luar. ' +
      'Tiap server dijalankan sebagai program terpisah, dan toolnya muncul di daftar ' +
      'tool agen dengan awalan <code>mcp_</code>.',
    'set.mcpJudul': 'Server MCP',
    'set.mcpJudulBaru': 'Server MCP baru',
    'set.mcpJudulUbah': 'Ubah server — {nama}',
    'set.mcpNamaPh': 'Nama, mis. filesystem',
    'set.mcpCmdPh': 'Perintah (mis. npx) atau URL server (https://…)',
    'set.mcpArgsPh': 'Argumen, mis. -y @modelcontextprotocol/server-filesystem C:\\kerja',
    'set.mcpEnvPh': 'Variabel lingkungan (opsional), mis. API_KEY=abc123',
    'set.mcpHeaderPh': 'Header HTTP (opsional), mis. X-Goog-Api-Key=abc123',
    'set.mcpSimpan': 'Simpan server',
    'set.mcpTambah': 'Tambah server',
    'set.mcpTempel': 'Tempel JSON',
    'set.mcpSambung': 'Sambungkan semua',
    'set.mcpJsonJudul': 'Tempel JSON',
    'set.mcpImpor': 'Impor',
    'set.mcpJsonPh':
      '{\n  "mcpServers": {\n    "stitch": {\n      "url": "https://stitch.googleapis.com/mcp",\n' +
      '      "headers": { "X-Goog-Api-Key": "KUNCIMU" }\n    }\n  }\n}',
    'set.mcpJsonNote':
      'Salin blok konfigurasi dari dokumentasi server MCP apa adanya. Bentuk ' +
      '"mcpServers", "servers", maupun satu server saja — semuanya diterima. ' +
      'Server dengan nama yang sama akan diperbarui, bukan digandakan.',
    'set.mcpJsonSalah': 'JSON tidak terbaca: {pesan}',
    'set.mcpJsonKosong': 'Tidak ada server MCP yang dikenali di teks itu.',
    'set.mcpTanyaJalankan':
      'JSON ini menjalankan program di komputermu:\n\n{daftar}\n\n' +
      'Lanjutkan hanya kalau kamu mempercayai sumbernya.',
    'set.mcpNoteHtml':
      'Isi kolom pertama dengan perintah (server dijalankan di komputer ini) atau ' +
      'URL <code>https://…</code> (server jarak jauh). Argumen dipisah spasi; pakai ' +
      'tanda kutip kalau ada spasi di dalamnya. Variabel lingkungan dan header ' +
      'dipisah spasi juga, bentuknya <code>NAMA=nilai</code>.',
    'set.mcpAmanHtml':
      '<b>Server MCP adalah program lain di komputer ini.</b> Batas folder proyek tidak ' +
      'berlaku untuk mereka — server filesystem bisa menyentuh folder mana pun yang ' +
      'diizinkan haknya sendiri. Karena itu tool MCP selalu meminta persetujuan sebelum ' +
      'dijalankan, meski mode izinnya bukan "supervised". Pasang hanya server yang kamu percaya.',
    'set.mcpBelumAda': 'Belum ada server MCP.',
    'set.mcpSiap': 'tersambung — {jumlah} tool',
    'set.mcpMati': 'belum tersambung',
    'set.mcpMenyala': 'menyambung…',
    'set.mcpGalat': 'gagal',
    'set.mcpNonaktif': 'dimatikan',
    'set.mcpNamaKosong': 'Nama dan perintah harus diisi.',
    'set.mcpHint': '{siap} dari {total} tersambung',
    'set.mcpTanyaHapus': 'Hapus server MCP "{nama}"?',

    // --- Pengaturan: Telegram ---
    'set.tgToken': 'Telegram — Bot token',
    'set.tgTokenNoteHtml':
      'Buka <strong>@BotFather</strong> di Telegram → kirim <code>/newbot</code> → ' +
      'ikuti langkahnya → salin token yang diberikan ke sini.',
    'set.tgChat': 'Telegram — Chat ID',
    'set.tgDeteksi': 'Deteksi',
    'set.tgDeteksiTip': 'Ambil dari pesan terakhir yang kamu kirim ke bot',
    'set.tgTes': 'Tes kirim',
    'set.tgTesTip': 'Kirim satu pesan uji ke HP',
    'set.tgChatNoteHtml':
      'Sapa dulu bot-mu di Telegram (tekan <strong>Start</strong>, kirim satu pesan), ' +
      'lalu klik <strong>Deteksi</strong>. Chat ID ini juga jadi daftar putih — ' +
      'hanya chat inilah yang dilayani.',
    'set.tgAktif': 'Aktifkan jembatan Telegram (balas dari HP)',
    'set.tgNotify': 'Kirim juga hasil giliran yang dimulai dari desktop',
    'set.tgPenjelasanHtml':
      'Saat aktif, pesan yang kamu kirim ke bot dijalankan sebagai perintah agen di ' +
      'proyek yang sedang terbuka, dan permintaan izin tool muncul sebagai tombol di ' +
      'Telegram. Perintah: <code>/proyek</code>, <code>/status</code>, ' +
      '<code>/ringkas</code>, <code>/stop</code>, <code>/bantuan</code>. ' +
      '<strong>PC harus menyala.</strong>',

    // --- Pengaturan: lanjutan ---
    'set.tavily': 'Tavily API key (opsional)',
    'set.tavilyPh': 'Kosongkan untuk pakai DuckDuckGo',
    'set.tavilyNote': 'Hasil pencarian web lebih rapi kalau diisi.',
    'set.lean': 'Hemat konteks (khusus Claude Code)',
    'set.leanNote':
      'Melewati preset system prompt Claude Code: ~3.200 token lebih ringan tiap giliran, ' +
      'tapi panduan pemakaian tool bawaannya ikut hilang — agen bisa jadi kurang cakap ' +
      'memilih tool. Sisa overhead (~18 rb token) berasal dari skema tool Claude Code ' +
      'sendiri dan tidak bisa dihilangkan dari sini.',
    'set.modeIzinNote':
      'Mode izin (Supervised / Auto-accept edits / Full access) diatur lewat tombol di ' +
      'bawah kolom chat, bukan di sini.',

    // === Tahap 2 ==========================================================

    // --- Layar kosong di area chat ---
    'chat.kosongJudul': 'Belum ada proyek',
    'chat.kosongIsiHtml': 'Klik <strong>ikon folder</strong> di panel kiri, lalu pilih folder kerjanya.',
    'chat.siapJudul': 'Mau kerjakan apa?',
    'chat.siapIsi': 'Agen bekerja di dalam folder proyek ini saja.',

    // --- Baris keadaan selama agen bekerja ---
    'chat.berpikir': 'Berpikir…',
    'chat.berjalan': 'Berjalan…',
    'chat.berjalanLama': 'Berjalan · {waktu}',
    'chat.penalaran': 'Penalaran · {detik} detik',
    'chat.meringkas': 'Meringkas percakapan…',
    'chat.tidakDijawab': '— tidak dijawab',
    'chat.langkahTool': '{jumlah} langkah tool',

    // --- Login Claude Code ---
    'cc.judul': 'Akun Claude',
    'cc.tersambung': 'Tersambung — {email} ({langganan})',
    'cc.belumLogin': 'Belum login',
    'cc.takAdaExe': 'Claude Code tidak ditemukan di paket ini',
    'cc.memeriksa': 'Memeriksa…',
    'cc.hubungkan': 'Hubungkan',
    'cc.keluar': 'Keluar',
    'cc.menghubungkan': 'Menghubungkan…',
    'cc.kirim': 'Kirim',
    'cc.kodePh': 'Tempel kode dari browser di sini',
    'cc.note':
      'Browser akan terbuka sendiri. Setujui di sana, lalu tempel kode yang diberikan ' +
      'ke kolom di atas. Yang berjalan di balik layar adalah alat login resmi Claude Code.',
    'cc.browserDibuka': 'Browser dibuka: {url}',
    'cc.berhasil': 'Berhasil tersambung.',
    'cc.gagal': 'Login tidak selesai. Coba lagi.',
    'cc.perluRestart': 'Tutup dan buka ulang aplikasi untuk memakai fitur ini',

    // --- Panel pemasangan Claude Code ---
    'ccInstall.judul': 'Claude Code belum terpasang',
    'ccInstall.sub':
      'Provider langganan Claude memakai alat resmi Claude Code. Pemasangannya sekali ' +
      'saja, sekitar satu menit.',
    'ccInstall.langkah1': '1. Buka Command Prompt, tempel perintah ini, lalu Enter',
    'ccInstall.langkah2': '2. Tutup Command Prompt, lalu kembali ke sini',
    'ccInstall.langkah2Ket':
      'Tidak perlu mengubah PATH dan tidak perlu login lewat terminal — aplikasi ini ' +
      'mencari sendiri di tempat pemasangannya, dan login dilakukan dari Pengaturan.',
    'ccInstall.periksa': 'Periksa lagi',
    'ccInstall.belumKetemu': 'Masih belum ketemu. Pastikan pemasangannya sudah selesai.',

    // --- Antrean ---
    'antre.sekarang': 'Kirim sekarang',
    'antre.sekarangTip': 'Selipkan ke pekerjaan yang sedang berjalan, tanpa menghentikannya',
    'antre.batal': 'Batalkan pesan ini',

    // --- Kartu pilihan & pertanyaan agen ---
    'opsi.klik': 'Klik untuk mengirim ini',
    'opsi.salin': 'Salin',
    'tanya.judul': 'Agen menunggu jawabanmu',
    'tanya.kirim': 'Kirim jawaban',

    // --- Permintaan izin tool ---
    'izin.judul': 'Izinkan tindakan ini?',
    'izin.selalu': 'Selalu izinkan tool ini',
    'izin.tolak': 'Tolak',
    'izin.izinkan': 'Izinkan',

    // --- Dialog konfirmasi ---
    'tanya.hapusSesi': 'Hapus "{judul}"? Tidak bisa dibatalkan.',
    'tanya.hapusEndpoint': 'Hapus endpoint "{nama}"? API key-nya ikut terhapus.',

    // --- Endpoint custom ---
    'ep.namaKosong': 'Nama belum diisi.',
    'ep.urlSalah': 'Base URL harus diawali http:// atau https://',
    // Petunjuk lokasi API key. Kuncinya = id provider, dipakai teksHint()
    // di renderer.js; provider tanpa kunci di sini memakai keyHint dari main.
    'hint.anthropic': 'Ambil di console.anthropic.com → API Keys (format: sk-ant-…)',
    'hint.deepseek': 'platform.deepseek.com → API keys',
    'hint.kimi': 'platform.kimi.ai → API Keys. Akun Tiongkok: ganti baseURL ke api.moonshot.cn/v1',
    'hint.glm': 'z.ai → API Keys. Akun Tiongkok: ganti baseURL ke open.bigmodel.cn/api/paas/v4',
    'hint.custom': 'Endpoint custom — {url}. Opsional: kosongkan untuk server lokal.',
    'ep.tersimpan': 'Tersimpan. Klik "Muat ulang" di bagian Model untuk menarik daftar model.',
    'ep.simpanDulu': 'Simpan dulu endpoint-nya, baru daftar modelnya bisa ditarik.',
    'ep.simpanDuluTombol': 'Simpan dulu endpoint-nya (tombol "Simpan endpoint"), atau tekan Batal.',

    // --- Muat ulang daftar model ---
    'model.memuat': 'Memuat…',
    'model.menghubungi': 'Menghubungi provider…',
    'model.berhasil': '{jumlah} model dimuat dari {provider}.',
    'model.gagal': 'Gagal: {pesan}. Daftar bawaan tetap dipakai.',

    // --- Telegram ---
    'tg.isiToken': 'Isi bot token dulu — ambil dari @BotFather di Telegram.',
    'tg.mencari': 'Mencari pesan masuk…',
    'tg.mengirim': 'Mengirim pesan uji…',
    'tg.ketemu': 'Ketemu: {siapa} → Chat ID {chatId}. Jangan lupa Simpan.',
    'tg.gagal': 'Gagal: {pesan}',
    'tg.gagalAktif': 'Telegram gagal aktif: {alasan}',

    // --- Waktu relatif di sidebar ---
    'waktu.baru': 'baru',
    'waktu.menit': '{n}m',
    'waktu.jam': '{n}j',
    'waktu.hari': '{n}h',
    'waktu.locale': 'id-ID',
  },

  en: {
    // --- Sidebar & header ---
    'sidebar.judul': 'PROJECTS',
    'sidebar.baru': 'New conversation',
    'sidebar.proyekBaru': 'New project (pick a folder)…',
    'sidebar.sembunyi': 'Hide panel (Cmd+B)',
    'sidebar.tampil': 'Show panel (Cmd+B)',
    'sidebar.didukung': 'supported by',
    'sidebar.kosongHtml': 'No projects yet. Click the <b>folder icon</b> above to create one.',
    'sidebar.hapusSesi': 'Delete conversation',
    'sidebar.sesiBaru': 'New conversation in {dir}',
    'sidebar.sesiBaruUmum': 'this folder',
    'sidebar.tanpaFolder': '(no folder)',
    'sidebar.tanpaFolderTip': 'This session is not tied to any folder yet',
    'header.gantiNama': 'Click to rename this project',
    'header.gantiFolder': 'Click to change the project folder',
    'header.pengaturan': 'Settings',
    'header.belumAdaProyek': '(no project yet)',

    // --- Layar kosong ---
    'kosong.judul': 'No projects yet',
    'kosong.isi': 'Create a new project and pick its working folder.',

    // --- Komposer ---
    'komposer.ketik': 'Type a message…  (Enter to send, Shift+Enter for a new line)',
    'komposer.ketikSibuk': 'Type a message…  (queued; the agent keeps working)',
    'komposer.kirim': 'Send',
    'komposer.antre': 'Queue',
    'komposer.stop': 'Stop',
    'komposer.keBawah': 'Jump to latest',
    'komposer.lampir': 'Attach a file or image',
    'komposer.lampirGambarMati': 'This model does not accept images',
    'komposer.seret': 'Drop files here to attach them',
    'komposer.seretKet': 'Images are sent as images; text files have their contents inlined',

    // --- Mode izin ---
    'perm.supervised': 'Supervised',
    'perm.supervisedKet': 'Ask before running commands and editing files.',
    'perm.acceptEdits': 'Auto-accept edits',
    'perm.acceptEditsKet': 'File edits are approved automatically; everything else still asks.',
    'perm.full': 'Full access',
    'perm.fullKet': 'Run commands and make edits without asking.',

    // --- Pemilih provider / model / effort ---
    'pick.provider': 'Provider',
    'pick.model': 'Model',
    'pick.effort': 'Thinking depth',
    'pick.effortTidak': '{provider} does not support an effort setting',
    'pick.kosong': 'Nothing to choose from yet.',
    'pick.bawaan': 'Built-in',
    'pick.custom': 'Custom',
    'pick.cariModel': 'Search models…',
    'pick.cariKosong': 'No model matches.',
    'pick.modGambar': 'image',
    'effort.low': 'Fastest, cheapest on tokens',
    'effort.medium': 'Balanced — the default',
    'effort.high': 'Explores and reads more',
    'effort.xhigh': 'Deeper still; context fills up fast',
    'effort.max': 'As deep as it goes, most expensive',

    // --- Status bar ---
    'sb.context': 'Context',
    'sb.used': 'Used',
    'sb.fresh': 'Fresh',
    'sb.cacheRead': 'Cache read',
    'sb.cacheWrite': 'Cache write',
    'sb.output': 'Output',
    'sb.compact': 'Compact',
    'sb.compactTip': 'Summarise the conversation — context shrinks, the chat stays',

    // --- Pengaturan: rangka ---
    'set.judul': 'Settings',
    'set.sub': 'Stored locally on this computer.',
    'set.secProvider': 'Provider & model',
    'set.secTampilan': 'Appearance',
    'set.secProyek': 'Project & system prompt',
    'set.secMcp': 'MCP servers',
    'set.secTelegram': 'Telegram bot',
    'set.secLanjutan': 'Advanced',
    'set.simpan': 'Save',
    'set.batal': 'Cancel',
    'set.hapus': 'Delete',
    'set.aktif': 'on',
    'set.nonaktif': 'off',
    'set.belumDisetel': 'not set up',

    // --- Pengaturan: provider & model ---
    'set.provider': 'Provider',
    'set.epBaruOpsi': '+ Add a new endpoint…',
    'set.epJudul': 'Custom endpoint',
    'set.epJudulBaru': 'New custom endpoint',
    'set.epJudulUbah': 'Edit endpoint — {nama}',
    'set.epNamaPh': 'Name, e.g. ONToken.id',
    'set.epUrlPh': 'https://api.ontoken.id/v1',
    'set.epKeyPh': 'API key — leave empty for a local server',
    'set.epSimpan': 'Save endpoint',
    'set.epNoteHtml':
      'The base URL stops at <code>/v1</code> — the app appends ' +
      '<code>/chat/completions</code> and <code>/models</code> itself. Local servers ' +
      '(Ollama <code>http://localhost:11434/v1</code>, LM Studio ' +
      '<code>http://localhost:1234/v1</code>) need no API key — leave it empty.',
    'set.model': 'Model',
    'set.muatUlang': 'Reload',
    'set.muatUlangTip': 'Fetch the latest model list from the provider',
    'set.modelNote':
      'The built-in list can go stale. Click "Reload" to fetch the real list from the ' +
      'provider — enter an API key first if the provider requires one.',
    'set.modelKosong': '(empty — click "Reload")',
    'set.apiKey': 'API key',
    'set.apiKeyPh': 'Paste your API key here',

    // --- Pengaturan: tampilan ---
    'set.tema': 'Theme',
    'set.temaNote': 'Click to try one straight away. Press Cancel to go back to the previous theme.',
    'set.bahasa': 'Language',
    'set.bahasaNote':
      'First stage: the sidebar, composer, status bar, and this panel. Error messages ' +
      'and Telegram bot replies are still in Indonesian.',

    // --- Pengaturan: proyek ---
    'set.folder': 'Default folder for new projects',
    'set.pilihFolder': 'Choose…',
    'set.folderNote':
      'Only the starting point of the "pick a folder" dialog when creating a project. ' +
      'Each project has its own folder, and the agent cannot step outside the folder of ' +
      'the project currently open.',
    'set.systemPrompt': 'System prompt',

    // --- Pengaturan: server MCP ---
    'set.mcpIntroHtml':
      'MCP (Model Context Protocol) is a standard way to add tools from outside. ' +
      'Each server runs as a separate program, and its tools show up in the agent\'s ' +
      'tool list with an <code>mcp_</code> prefix.',
    'set.mcpJudul': 'MCP server',
    'set.mcpJudulBaru': 'New MCP server',
    'set.mcpJudulUbah': 'Edit server — {nama}',
    'set.mcpNamaPh': 'Name, e.g. filesystem',
    'set.mcpCmdPh': 'Command (e.g. npx) or server URL (https://…)',
    'set.mcpArgsPh': 'Arguments, e.g. -y @modelcontextprotocol/server-filesystem C:\\work',
    'set.mcpEnvPh': 'Environment variables (optional), e.g. API_KEY=abc123',
    'set.mcpHeaderPh': 'HTTP headers (optional), e.g. X-Goog-Api-Key=abc123',
    'set.mcpSimpan': 'Save server',
    'set.mcpTambah': 'Add a server',
    'set.mcpTempel': 'Paste JSON',
    'set.mcpSambung': 'Connect all',
    'set.mcpJsonJudul': 'Paste JSON',
    'set.mcpImpor': 'Import',
    'set.mcpJsonPh':
      '{\n  "mcpServers": {\n    "stitch": {\n      "url": "https://stitch.googleapis.com/mcp",\n' +
      '      "headers": { "X-Goog-Api-Key": "YOUR-KEY" }\n    }\n  }\n}',
    'set.mcpJsonNote':
      'Copy the config block from any MCP server\'s docs as-is. The "mcpServers" shape, ' +
      'the "servers" shape, and a single bare server are all accepted. A server with a ' +
      'name you already have is updated rather than duplicated.',
    'set.mcpJsonSalah': 'Could not read the JSON: {pesan}',
    'set.mcpJsonKosong': 'No MCP server was recognised in that text.',
    'set.mcpTanyaJalankan':
      'This JSON runs programs on your computer:\n\n{daftar}\n\n' +
      'Only continue if you trust where it came from.',
    'set.mcpNoteHtml':
      'Put either a command (the server runs on this computer) or an ' +
      '<code>https://…</code> URL (a remote server) in the first field. Arguments are ' +
      'split on spaces; quote any that contain a space. Environment variables and ' +
      'headers are space-separated too, in <code>NAME=value</code> form.',
    'set.mcpAmanHtml':
      '<b>An MCP server is another program on this computer.</b> The project folder ' +
      'boundary does not apply to it — a filesystem server can reach any folder its own ' +
      'permissions allow. That is why MCP tools always ask for approval before running, ' +
      'even when the permission mode is not "supervised". Only install servers you trust.',
    'set.mcpBelumAda': 'No MCP servers yet.',
    'set.mcpSiap': 'connected — {jumlah} tools',
    'set.mcpMati': 'not connected',
    'set.mcpMenyala': 'connecting…',
    'set.mcpGalat': 'failed',
    'set.mcpNonaktif': 'disabled',
    'set.mcpNamaKosong': 'Name and command are both required.',
    'set.mcpHint': '{siap} of {total} connected',
    'set.mcpTanyaHapus': 'Delete the MCP server "{nama}"?',

    // --- Pengaturan: Telegram ---
    'set.tgToken': 'Telegram — Bot token',
    'set.tgTokenNoteHtml':
      'Open <strong>@BotFather</strong> in Telegram → send <code>/newbot</code> → ' +
      'follow the steps → paste the token it gives you here.',
    'set.tgChat': 'Telegram — Chat ID',
    'set.tgDeteksi': 'Detect',
    'set.tgDeteksiTip': 'Read it from the last message you sent the bot',
    'set.tgTes': 'Send a test',
    'set.tgTesTip': 'Send one test message to your phone',
    'set.tgChatNoteHtml':
      'Say hello to your bot in Telegram first (press <strong>Start</strong>, send one ' +
      'message), then click <strong>Detect</strong>. This chat ID doubles as the ' +
      'allowlist — only this chat is served.',
    'set.tgAktif': 'Enable the Telegram bridge (reply from your phone)',
    'set.tgNotify': 'Also send results of turns started on the desktop',
    'set.tgPenjelasanHtml':
      'While enabled, messages you send the bot run as agent commands in the project ' +
      'currently open, and tool permission requests appear as buttons in Telegram. ' +
      'Commands: <code>/proyek</code>, <code>/status</code>, <code>/ringkas</code>, ' +
      '<code>/stop</code>, <code>/bantuan</code>. <strong>The PC must be awake.</strong>',

    // --- Pengaturan: lanjutan ---
    'set.tavily': 'Tavily API key (optional)',
    'set.tavilyPh': 'Leave empty to use DuckDuckGo',
    'set.tavilyNote': 'Web search results come back tidier when this is filled in.',
    'set.lean': 'Lean context (Claude Code only)',
    'set.leanNote':
      'Skips the Claude Code system prompt preset: ~3,200 tokens lighter every turn, but ' +
      'its built-in tool guidance goes with it — the agent may pick tools less well. The ' +
      'remaining overhead (~18k tokens) comes from Claude Code\'s own tool schemas and ' +
      'cannot be removed from here.',
    'set.modeIzinNote':
      'Permission mode (Supervised / Auto-accept edits / Full access) is set with the ' +
      'button below the chat box, not here.',

    // === Tahap 2 ==========================================================

    // --- Layar kosong di area chat ---
    'chat.kosongJudul': 'No projects yet',
    'chat.kosongIsiHtml': 'Click the <strong>folder icon</strong> in the left panel, then pick its working folder.',
    'chat.siapJudul': 'What are we working on?',
    'chat.siapIsi': 'The agent works inside this project folder only.',

    // --- Baris keadaan selama agen bekerja ---
    'chat.berpikir': 'Thinking…',
    'chat.berjalan': 'Working…',
    'chat.berjalanLama': 'Working · {waktu}',
    'chat.penalaran': 'Reasoning · {detik}s',
    'chat.meringkas': 'Summarising the conversation…',
    'chat.tidakDijawab': '— not answered',
    'chat.langkahTool': '{jumlah} tool steps',

    // --- Login Claude Code ---
    'cc.judul': 'Claude account',
    'cc.tersambung': 'Connected — {email} ({langganan})',
    'cc.belumLogin': 'Not signed in',
    'cc.takAdaExe': 'Claude Code was not found in this build',
    'cc.memeriksa': 'Checking…',
    'cc.hubungkan': 'Connect',
    'cc.keluar': 'Sign out',
    'cc.menghubungkan': 'Connecting…',
    'cc.kirim': 'Send',
    'cc.kodePh': 'Paste the code from your browser here',
    'cc.note':
      'Your browser opens on its own. Approve there, then paste the code it gives you ' +
      'into the box above. What runs behind the scenes is the official Claude Code sign-in tool.',
    'cc.browserDibuka': 'Browser opened: {url}',
    'cc.berhasil': 'Connected successfully.',
    'cc.gagal': 'Sign-in did not complete. Try again.',
    'cc.perluRestart': 'Close and reopen the app to use this feature',

    // --- Panel pemasangan Claude Code ---
    'ccInstall.judul': 'Claude Code is not installed',
    'ccInstall.sub':
      'The Claude subscription provider uses the official Claude Code tool. Installing ' +
      'it is a one-off, about a minute.',
    'ccInstall.langkah1': '1. Open Command Prompt, paste this command, then press Enter',
    'ccInstall.langkah2': '2. Close Command Prompt, then come back here',
    'ccInstall.langkah2Ket':
      'No PATH changes and no terminal sign-in needed — this app looks for it where the ' +
      'installer puts it, and signing in happens in Settings.',
    'ccInstall.periksa': 'Check again',
    'ccInstall.belumKetemu': 'Still not found. Make sure the install finished.',

    // --- Antrean ---
    'antre.sekarang': 'Send now',
    'antre.sekarangTip': 'Slip this into the running turn without stopping it',
    'antre.batal': 'Cancel this message',

    // --- Kartu pilihan & pertanyaan agen ---
    'opsi.klik': 'Click to send this',
    'opsi.salin': 'Copy',
    'tanya.judul': 'The agent is waiting for your answer',
    'tanya.kirim': 'Send answer',

    // --- Permintaan izin tool ---
    'izin.judul': 'Allow this action?',
    'izin.selalu': 'Always allow this tool',
    'izin.tolak': 'Deny',
    'izin.izinkan': 'Allow',

    // --- Dialog konfirmasi ---
    'tanya.hapusSesi': 'Delete "{judul}"? This cannot be undone.',
    'tanya.hapusEndpoint': 'Delete endpoint "{nama}"? Its API key goes with it.',

    // --- Endpoint custom ---
    'ep.namaKosong': 'The name is still empty.',
    'ep.urlSalah': 'Base URL must start with http:// or https://',
    'hint.anthropic': 'Get one at console.anthropic.com → API Keys (format: sk-ant-…)',
    'hint.deepseek': 'platform.deepseek.com → API keys',
    'hint.kimi': 'platform.kimi.ai → API Keys. Chinese account: change baseURL to api.moonshot.cn/v1',
    'hint.glm': 'z.ai → API Keys. Chinese account: change baseURL to open.bigmodel.cn/api/paas/v4',
    'hint.custom': 'Custom endpoint — {url}. Optional: leave empty for a local server.',
    'ep.tersimpan': 'Saved. Click "Reload" in the Model section to fetch its model list.',
    'ep.simpanDulu': 'Save the endpoint first, then its model list can be fetched.',
    'ep.simpanDuluTombol': 'Save the endpoint first ("Save endpoint"), or press Cancel.',

    // --- Muat ulang daftar model ---
    'model.memuat': 'Loading…',
    'model.menghubungi': 'Contacting the provider…',
    'model.berhasil': '{jumlah} models loaded from {provider}.',
    'model.gagal': 'Failed: {pesan}. Falling back to the built-in list.',

    // --- Telegram ---
    'tg.isiToken': 'Enter the bot token first — get it from @BotFather in Telegram.',
    'tg.mencari': 'Looking for incoming messages…',
    'tg.mengirim': 'Sending a test message…',
    'tg.ketemu': 'Found: {siapa} → chat ID {chatId}. Remember to press Save.',
    'tg.gagal': 'Failed: {pesan}',
    'tg.gagalAktif': 'Telegram failed to start: {alasan}',

    // --- Waktu relatif di sidebar ---
    'waktu.baru': 'now',
    'waktu.menit': '{n}m',
    'waktu.jam': '{n}h',
    'waktu.hari': '{n}d',
    'waktu.locale': 'en-GB',
  },
};

/** Daftar untuk pemilih di Pengaturan. */
const BAHASA = [
  { id: 'id', nama: 'Bahasa Indonesia' },
  { id: 'en', nama: 'English' },
];

let bahasaAktif = 'id';

function setBahasa(kode) {
  bahasaAktif = KAMUS[kode] ? kode : 'id';
  document.documentElement.lang = bahasaAktif;
}

/**
 * Ambil satu teks. Kunci yang tidak ada dikembalikan apa adanya — jadi kalau
 * ada yang terlewat, yang muncul di layar adalah nama kuncinya, bukan kalimat
 * kosong. Itu disengaja: yang salah harus kelihatan, bukan menghilang.
 */
function t(kunci, ganti) {
  const meja = KAMUS[bahasaAktif] || KAMUS.id;
  let teks = meja[kunci];
  if (teks === undefined) teks = KAMUS.id[kunci];
  if (teks === undefined) return kunci;
  if (!ganti) return teks;
  return teks.replace(/\{(\w+)\}/g, (utuh, nama) =>
    ganti[nama] === undefined ? utuh : String(ganti[nama])
  );
}

/**
 * Pasang semua teks bertanda ke DOM.
 *
 * data-i18n       -> textContent
 * data-i18n-html  -> innerHTML (hanya untuk kunci berakhiran "Html")
 * data-i18n-title -> atribut title
 * data-i18n-ph    -> atribut placeholder
 */
function terapkanBahasa() {
  for (const n of document.querySelectorAll('[data-i18n]')) {
    n.textContent = t(n.dataset.i18n);
  }
  for (const n of document.querySelectorAll('[data-i18n-html]')) {
    n.innerHTML = t(n.dataset.i18nHtml);
  }
  for (const n of document.querySelectorAll('[data-i18n-title]')) {
    n.title = t(n.dataset.i18nTitle);
  }
  for (const n of document.querySelectorAll('[data-i18n-ph]')) {
    n.placeholder = t(n.dataset.i18nPh);
  }
}
