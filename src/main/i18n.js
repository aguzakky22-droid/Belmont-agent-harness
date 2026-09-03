'use strict';

const config = require('./config');

/**
 * Kamus untuk proses main.
 *
 * TERPISAH dari renderer/i18n.js dengan sengaja, dan isinya sempit — karena
 * teks di proses main terbagi tiga, dan cuma dua di antaranya boleh ikut
 * setelan bahasa:
 *
 *  A. UNTUK MODEL — deskripsi tool, hasil tool, pesan galat yang diumpankan
 *     kembali ke percakapan, dan kerangka system prompt. Semua itu bagian dari
 *     prompt, bukan antarmuka. Menerjemahkannya lewat setelan UI berarti
 *     mengubah apa yang dibaca model, membatalkan prompt cache setiap kali
 *     bahasanya diganti, dan bisa menggeser perilaku agen. Sengaja DIBIARKAN.
 *
 *  B. UNTUK KAMU, DI JENDELA DESKTOP — pesan galat yang muncul sebagai baris
 *     merah di chat, judul dialog pilih file/folder. Ini antarmuka.
 *
 *  C. UNTUK KAMU, LEWAT TELEGRAM — balasan bot dan pesan statusnya. Ini juga
 *     antarmuka, cuma layarnya beda.
 *
 * Yang ada di berkas ini hanya B dan C.
 */

const KAMUS = {
  id: {
    // --- B: galat & dialog di desktop ---
    'galat.biner': 'file biner — hanya gambar dan teks yang didukung',
    'galat.formatTempelan': 'format {mediaType} tidak didukung',
    'galat.tanpaDaftarModel': '{provider} tidak punya daftar model online.',
    'galat.modelKosong': '{provider} tidak mengembalikan model apa pun.',
    'galat.belumPilihModel':
      '{provider}: belum ada model yang dipilih. Buka Pengaturan, lalu klik "Muat ulang" ' +
      'di bagian Model.',
    'galat.gagalMeringkas': 'Gagal meringkas: {pesan}',
    'galat.sebabTakDijelaskan': 'Claude Code tidak menjelaskan sebabnya.',
    'galat.ccLapor': 'Claude Code melaporkan error.',
    'galat.ccTanpaCompact': 'Versi Claude Code ini tidak punya perintah /compact.',
    'galat.isiKeyDulu': 'Isi API key dulu, lalu muat ulang.',
    'galat.keyKosong': 'API key untuk {provider} belum diisi. Buka Pengaturan.',
    'galat.dihentikan': 'Dihentikan.',
    'galat.compactTidakDidukung': 'Provider ini belum mendukung ringkas.',
    'galat.belumAdaRingkas': 'Belum ada yang bisa diringkas.',
    'galat.ringkasanKosong': 'Model tidak mengembalikan ringkasan apa pun.',
    'sesi.baru': 'Percakapan baru',
    // --- B: menu klik-kanan ---
    'menu.potong': 'Potong',
    'menu.salin': 'Salin',
    'menu.tempel': 'Tempel',
    'menu.pilihSemua': 'Pilih semua',

    'dialog.pilihFile': 'Pilih file untuk dilampirkan',
    'dialog.pilihFolder': 'Pilih folder untuk proyek ini',
    'dialog.gantiFolder': 'Ganti folder proyek',
    'dialog.pakaiFolder': 'Pakai folder ini',

    // --- B: Telegram, disetel dari panel Pengaturan ---
    'tg.tokenKosong': 'Bot token Telegram belum diisi.',
    'tg.chatKosong': 'Chat ID Telegram belum diisi.',
    'tg.tokenAtauChatKosong': 'Bot token atau Chat ID belum diisi.',
    'tg.tidakTersambung': 'Tidak bisa menghubungi Telegram: {pesan}',
    'tg.belumAdaPesan':
      'Belum ada pesan masuk. Buka Telegram, cari @{bot}, tekan Start lalu kirim satu ' +
      'pesan apa saja — setelah itu klik Deteksi lagi.',
    'tg.uji': 'Belmont Tools tersambung. Kalau pesan ini muncul di HP-mu, jalurnya sudah benar.',
    'tg.gagalKirim': 'Gagal mengirim ke Telegram: {pesan}',
    'tg.gagalProses': 'Gagal memproses pesan Telegram: {pesan}',
    'tg.gagal': 'Gagal: {pesan}',

    // --- C: balasan bot ---
    'bot.bantuan': [
      'Perintah yang tersedia:',
      '',
      '/proyek — daftar proyek, dan pindah dengan /proyek <nomor>',
      '/status — proyek aktif, model, dan sisa konteks',
      '/ringkas — ringkas percakapan supaya konteks mengecil',
      '/stop — hentikan giliran yang sedang berjalan',
      '/bantuan — pesan ini',
      '',
      'Selain itu, apa pun yang kamu tulis dikirim ke agen sebagai pesan biasa.',
    ].join('\n'),
    'bot.perintahTakDikenal': 'Perintah /{perintah} tidak dikenal.',
    'bot.siap': 'Belmont Tools aktif. Kirim pesan untuk mulai.',
    'bot.belumAdaProyek': 'Belum ada proyek. Buat dulu lewat tombol + di desktop.',
    'bot.belumAdaAktif': 'Belum ada proyek aktif.',
    'bot.belumAdaAktifPilih': 'Belum ada proyek aktif. Pilih dengan /proyek, atau buat di desktop.',
    'bot.pindah': 'Pindah ke: {judul}\nFolder: {folder}',
    'bot.daftarJudul': 'Proyek (kirim /proyek <nomor> untuk pindah):',
    'bot.statusProyek': 'Proyek ',
    'bot.statusFolder': 'Folder ',
    'bot.statusModel': 'Model  ',
    'bot.statusIzin': 'Izin   ',
    'bot.statusKonteks': 'Konteks',
    'bot.statusStatus': 'Status ',
    'bot.statusLatar': 'Latar  ',
    'bot.sisaKonteks': '{persen}% sisa',
    'bot.belumTerukur': 'belum terukur',
    'bot.sedangBekerja': 'sedang bekerja',
    'bot.menganggur': 'menganggur',
    'bot.latarLain': '{jumlah} proyek lain juga sedang bekerja',
    'bot.takAdaBerjalan': 'Tidak ada yang sedang berjalan.',
    'bot.dihentikan': 'Dihentikan.',
    'bot.masihBekerja': 'Masih bekerja — coba lagi setelah selesai.',
    'bot.meringkas': 'Meringkas percakapan…',
    'bot.diantrekan': 'Masih mengerjakan yang sebelumnya — pesanmu diantrekan.',
    'bot.sudahDijawab': 'Permintaan ini sudah dijawab dari desktop.',
    'bot.sudahDijawabPendek': 'Sudah dijawab dari desktop.',
    'bot.adaPertanyaan':
      'Agen menunggu jawaban pertanyaan{nama} — buka desktop untuk memilih:',
    'bot.defaultFolder': '(default)',
    'bot.langkahTool': '— {jumlah} langkah tool: {daftar}',
    'bot.selesaiTanpaTeks': 'Selesai, tanpa jawaban teks.',
  },

  en: {
    // --- B: galat & dialog di desktop ---
    'galat.biner': 'binary file — only images and text are supported',
    'galat.formatTempelan': '{mediaType} format is not supported',
    'galat.tanpaDaftarModel': '{provider} has no online model list.',
    'galat.modelKosong': '{provider} returned no models at all.',
    'galat.belumPilihModel':
      '{provider}: no model selected yet. Open Settings, then click "Reload" in the ' +
      'Model section.',
    'galat.gagalMeringkas': 'Could not summarise: {pesan}',
    'galat.sebabTakDijelaskan': 'Claude Code did not say why.',
    'galat.ccLapor': 'Claude Code reported an error.',
    'galat.ccTanpaCompact': 'This version of Claude Code has no /compact command.',
    'galat.isiKeyDulu': 'Enter the API key first, then reload.',
    'galat.keyKosong': 'The API key for {provider} is empty. Open Settings.',
    'galat.dihentikan': 'Stopped.',
    'galat.compactTidakDidukung': 'This provider does not support summarising yet.',
    'galat.belumAdaRingkas': 'There is nothing to summarise yet.',
    'galat.ringkasanKosong': 'The model returned no summary at all.',
    'sesi.baru': 'New conversation',
    // --- B: menu klik-kanan ---
    'menu.potong': 'Cut',
    'menu.salin': 'Copy',
    'menu.tempel': 'Paste',
    'menu.pilihSemua': 'Select all',

    'dialog.pilihFile': 'Choose files to attach',
    'dialog.pilihFolder': 'Choose a folder for this project',
    'dialog.gantiFolder': 'Change the project folder',
    'dialog.pakaiFolder': 'Use this folder',

    // --- B: Telegram, disetel dari panel Pengaturan ---
    'tg.tokenKosong': 'The Telegram bot token is empty.',
    'tg.chatKosong': 'The Telegram chat ID is empty.',
    'tg.tokenAtauChatKosong': 'The bot token or chat ID is empty.',
    'tg.tidakTersambung': 'Could not reach Telegram: {pesan}',
    'tg.belumAdaPesan':
      'No incoming messages yet. Open Telegram, find @{bot}, press Start and send any ' +
      'message — then click Detect again.',
    'tg.uji': 'Belmont Tools is connected. If this shows up on your phone, the link works.',
    'tg.gagalKirim': 'Failed to send to Telegram: {pesan}',
    'tg.gagalProses': 'Failed to process the Telegram message: {pesan}',
    'tg.gagal': 'Failed: {pesan}',

    // --- C: balasan bot ---
    'bot.bantuan': [
      'Available commands:',
      '',
      '/proyek — list projects, and switch with /proyek <number>',
      '/status — active project, model, and context left',
      '/ringkas — summarise the conversation to shrink the context',
      '/stop — stop the turn currently running',
      '/bantuan — this message',
      '',
      'Anything else you type is sent to the agent as an ordinary message.',
    ].join('\n'),
    'bot.perintahTakDikenal': 'Unknown command /{perintah}.',
    'bot.siap': 'Belmont Tools is running. Send a message to start.',
    'bot.belumAdaProyek': 'No projects yet. Create one with the + button on the desktop.',
    'bot.belumAdaAktif': 'No active project.',
    'bot.belumAdaAktifPilih': 'No active project. Pick one with /proyek, or create one on the desktop.',
    'bot.pindah': 'Switched to: {judul}\nFolder: {folder}',
    'bot.daftarJudul': 'Projects (send /proyek <number> to switch):',
    'bot.statusProyek': 'Project',
    'bot.statusFolder': 'Folder ',
    'bot.statusModel': 'Model  ',
    'bot.statusIzin': 'Perms  ',
    'bot.statusKonteks': 'Context',
    'bot.statusStatus': 'Status ',
    'bot.statusLatar': 'Backgr ',
    'bot.sisaKonteks': '{persen}% left',
    'bot.belumTerukur': 'not measured yet',
    'bot.sedangBekerja': 'working',
    'bot.menganggur': 'idle',
    'bot.latarLain': '{jumlah} other projects are also working',
    'bot.takAdaBerjalan': 'Nothing is running.',
    'bot.dihentikan': 'Stopped.',
    'bot.masihBekerja': 'Still working — try again once it finishes.',
    'bot.meringkas': 'Summarising the conversation…',
    'bot.diantrekan': 'Still on the previous one — your message has been queued.',
    'bot.sudahDijawab': 'This request was already answered from the desktop.',
    'bot.sudahDijawabPendek': 'Answered from the desktop.',
    'bot.adaPertanyaan': 'The agent is waiting on a question{nama} — open the desktop to choose:',
    'bot.defaultFolder': '(default)',
    'bot.langkahTool': '— {jumlah} tool steps: {daftar}',
    'bot.selesaiTanpaTeks': 'Done, with no text answer.',
  },
};

/**
 * Dibaca dari config tiap kali dipanggil, bukan disimpan di variabel modul:
 * bahasa bisa diganti dari panel Pengaturan tanpa restart, dan proses main
 * tidak diberi tahu saat itu terjadi.
 */
function t(kunci, ganti) {
  let kode = 'id';
  try {
    kode = config.load().language || 'id';
  } catch {
    /* config belum siap — pakai bawaan */
  }
  const meja = KAMUS[kode] || KAMUS.id;
  let teks = meja[kunci];
  if (teks === undefined) teks = KAMUS.id[kunci];
  if (teks === undefined) return kunci;
  if (!ganti) return teks;
  return teks.replace(/\{(\w+)\}/g, (utuh, nama) =>
    ganti[nama] === undefined ? utuh : String(ganti[nama])
  );
}

module.exports = { t };
