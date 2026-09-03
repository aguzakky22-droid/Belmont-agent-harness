'use strict';

const tg = require('./telegram');

/**
 * Jembatan Telegram: membuat HP jadi remote control aplikasi ini.
 *
 * Arah koneksinya keluar — PC yang menghubungi server Telegram, bukan
 * sebaliknya. Jadi tidak ada port yang dibuka, tidak perlu tunnel, dan jalan
 * juga lewat data seluler saat kamu di luar rumah.
 *
 * Modul ini sengaja tidak tahu apa-apa soal Agent, sesi, atau jendela. Semua
 * yang perlu dikerjakan diminta lewat `handlers` — supaya bagian yang rapuh
 * (jaringan, protokol Telegram) terpisah dari bagian yang penting (menjalankan
 * agen di folder proyek).
 */

const { t } = require('./i18n');

const JEDA_ERROR_MS = 5000; // jeda sebelum mencoba lagi setelah gagal

// Fungsi, bukan konstanta: bahasa bisa diganti saat aplikasi berjalan, dan
// teks bantuan yang dibekukan saat modul dimuat akan tertinggal di bahasa lama.
const bantuan = () => t('bot.bantuan');

function createBridge(handlers) {
  let berjalan = false;
  let token = '';
  let chatId = '';
  let offset = 0;
  let siklus = null;

  /** Kirim pesan ke chat yang terdaftar. Diam saja kalau jembatan mati. */
  async function kirim(text, extra) {
    if (!berjalan || !token || !chatId) return null;
    try {
      return await tg.sendMessage(token, chatId, text, extra);
    } catch (err) {
      handlers.onError?.(t('tg.gagalKirim', { pesan: err?.message || err }));
      return null;
    }
  }

  /**
   * Buang antrean update lama sebelum mulai melayani.
   *
   * Tanpa ini, pesan yang kamu kirim ke bot saat mencari Chat ID akan diproses
   * sebagai perintah begitu jembatan dinyalakan — agen tiba-tiba mengerjakan
   * "halo" yang kamu ketik kemarin.
   */
  async function lewatiAntreanLama() {
    const lama = await tg.getUpdates(token, undefined, 0);
    if (lama.length) offset = lama[lama.length - 1].update_id + 1;
  }

  async function tanganiUpdate(u) {
    offset = u.update_id + 1;

    // --- Tombol persetujuan ---
    if (u.callback_query) {
      const cb = u.callback_query;
      const dari = String(cb.message?.chat?.id || '');
      if (dari !== chatId) return; // bukan chat yang terdaftar
      await tg.answerCallback(token, cb.id);
      await handlers.onCallback?.(cb.data || '', {
        messageId: cb.message?.message_id,
        edit: (teks) => tg.editMessage(token, chatId, cb.message?.message_id, teks),
      });
      return;
    }

    // --- Pesan biasa ---
    const msg = u.message;
    const teks = msg?.text;
    if (!teks) return;

    // Daftar putih: hanya chat milikmu yang dilayani. Ini satu-satunya hal yang
    // memisahkan bot ini dari "siapa pun boleh menjalankan perintah di PC-ku".
    if (String(msg.chat?.id || '') !== chatId) {
      handlers.onError?.(`Pesan Telegram dari chat tak dikenal (${msg.chat?.id}) diabaikan.`);
      return;
    }

    if (teks.startsWith('/')) {
      const [perintah, ...sisa] = teks.slice(1).split(/\s+/);
      await tanganiPerintah(perintah.toLowerCase(), sisa.join(' '));
      return;
    }

    await handlers.onText?.(teks);
  }

  async function tanganiPerintah(perintah, argumen) {
    switch (perintah) {
      case 'start':
      case 'bantuan':
      case 'help':
        return kirim(bantuan());

      case 'proyek':
      case 'projects':
        return kirim(await handlers.onProjects?.(argumen));

      case 'status':
        return kirim(await handlers.onStatus?.());

      case 'ringkas':
      case 'compact':
        return handlers.onCompact?.();

      case 'stop':
        return kirim(await handlers.onStop?.());

      default:
        return kirim(`${t('bot.perintahTakDikenal', { perintah })}\n\n${bantuan()}`);
    }
  }

  async function loop() {
    while (berjalan) {
      try {
        const updates = await tg.getUpdates(token, offset, 25);
        for (const u of updates) {
          if (!berjalan) break;
          try {
            await tanganiUpdate(u);
          } catch (err) {
            // Satu pesan bermasalah tidak boleh mematikan loop-nya.
            handlers.onError?.(t('tg.gagalProses', { pesan: err?.message || err }));
            await kirim(t('tg.gagal', { pesan: err?.message || err }));
          }
        }
      } catch (err) {
        if (!berjalan) break;
        handlers.onError?.(`Koneksi Telegram terputus: ${err?.message || err}`);
        await new Promise((r) => setTimeout(r, JEDA_ERROR_MS));
      }
    }
  }

  return {
    isRunning: () => berjalan,

    async start(cfgTelegram) {
      // Bukan `t`: nama itu sudah dipakai fungsi penerjemah di berkas ini.
      const tok = (cfgTelegram && cfgTelegram.botToken) || '';
      const c = (cfgTelegram && cfgTelegram.chatId) || '';
      if (!tok || !c) return { ok: false, reason: t('tg.tokenAtauChatKosong') };
      if (berjalan && tok === token && c === chatId) return { ok: true, already: true };

      await this.stop();
      token = tok;
      chatId = c;

      let bot;
      try {
        bot = await tg.whoAmI(token);
        await lewatiAntreanLama();
      } catch (err) {
        token = '';
        chatId = '';
        return { ok: false, reason: err?.message || String(err) };
      }

      berjalan = true;
      siklus = loop();
      await kirim(`${t('bot.siap')}\n\n${bantuan()}`);
      return { ok: true, username: bot.username };
    },

    async stop() {
      if (!berjalan) return;
      berjalan = false;
      // Long poll yang sedang menggantung akan selesai sendiri (maks 25 detik);
      // loop-nya berhenti di pengecekan berikutnya.
      const s = siklus;
      siklus = null;
      if (s) await Promise.race([s, new Promise((r) => setTimeout(r, 100))]);
    },

    kirim,
  };
}

module.exports = { createBridge };
