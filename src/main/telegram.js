'use strict';

/**
 * Penghubung ke Telegram Bot API.
 *
 * Dipakai supaya aplikasi bisa mengirim pesan ke HP-mu. Arahnya keluar: PC yang
 * menghubungi server Telegram, jadi tidak ada port yang perlu dibuka dan tidak
 * perlu tunnel — ini yang membuat Telegram jauh lebih aman daripada membuka
 * aplikasi ini ke internet.
 *
 * Bot token disimpan di settings.json, sejajar dengan API key provider lain.
 */

const { t } = require('./i18n');

const API = 'https://api.telegram.org';

/** Panggil satu method Bot API; lempar Error dengan pesan asli kalau gagal. */
async function call(token, method, params) {
  if (!token) throw new Error(t('tg.tokenKosong'));

  let res;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
  } catch (err) {
    // Gagal sebelum sampai ke Telegram: DNS, tanpa internet, atau diblokir.
    throw new Error(t('tg.tidakTersambung', { pesan: err?.message || err }));
  }

  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    // description dari Telegram jauh lebih berguna daripada kode HTTP-nya.
    throw new Error(body.description || `Telegram menolak (HTTP ${res.status}).`);
  }
  return body.result;
}

/** Pastikan token-nya benar, sekalian ambil nama botnya. */
async function whoAmI(token) {
  const me = await call(token, 'getMe');
  return { id: me.id, username: me.username, name: me.first_name };
}

/**
 * Tebak Chat ID dari pesan terakhir yang dikirim ke bot.
 *
 * Telegram tidak punya cara mencari "chat saya" — bot baru tahu keberadaanmu
 * setelah kamu menyapanya lebih dulu. Karena itu fungsi ini membaca antrean
 * update dan mengambil pengirim terakhir.
 */
async function detectChatId(token) {
  const updates = await call(token, 'getUpdates', { limit: 20, timeout: 0 });

  // Ambil dari yang terbaru — kalau kamu pernah menyapa dari beberapa akun,
  // yang paling baru hampir pasti yang kamu maksud.
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = updates[i]?.message?.chat || updates[i]?.channel_post?.chat;
    if (chat?.id) {
      return {
        chatId: String(chat.id),
        name: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || '',
        username: chat.username || '',
      };
    }
  }

  const bot = await whoAmI(token);
  throw new Error(
    t('tg.belumAdaPesan', { bot: bot.username })
  );
}

/** Batas keras Telegram 4096 karakter; disisakan ruang untuk awalan. */
const MAX_LEN = 3800;

/**
 * Pecah teks panjang jadi beberapa pesan.
 * Dipotong di batas baris kalau bisa — memotong di tengah kalimat membuat
 * blok kode dan tabel jadi kacau.
 */
function chunk(text) {
  const out = [];
  let sisa = String(text || '');

  while (sisa.length > MAX_LEN) {
    let potong = sisa.lastIndexOf('\n', MAX_LEN);
    if (potong < MAX_LEN * 0.5) potong = MAX_LEN; // tidak ada baris baru yang wajar
    out.push(sisa.slice(0, potong));
    sisa = sisa.slice(potong).replace(/^\n/, '');
  }
  if (sisa) out.push(sisa);
  return out;
}

/** Kirim pesan teks ke satu chat. Teks panjang otomatis dipecah. */
async function sendMessage(token, chatId, text, extra) {
  if (!chatId) throw new Error(t('tg.chatKosong'));

  const bagian = chunk(text);
  let terakhir = null;
  for (let i = 0; i < bagian.length; i++) {
    terakhir = await call(token, 'sendMessage', {
      chat_id: chatId,
      text: bagian[i],
      // Sengaja tanpa parse_mode: teks dari agen sering memuat karakter yang
      // dianggap markup oleh Telegram, dan pesannya jadi ditolak mentah-mentah.
      disable_web_page_preview: true,
      // Tombol hanya ikut di potongan terakhir.
      ...(i === bagian.length - 1 ? extra || {} : {}),
    });
  }
  return terakhir;
}

/**
 * Ambil update baru. `timeout` detik menahan koneksi sampai ada pesan masuk
 * (long polling) — jauh lebih hemat daripada menanyai server tiap detik, dan
 * pesannya sampai seketika.
 */
async function getUpdates(token, offset, timeout) {
  return call(token, 'getUpdates', {
    offset,
    timeout: timeout ?? 25,
    allowed_updates: ['message', 'callback_query'],
  });
}

/** Hentikan animasi "memuat" pada tombol yang baru ditekan. */
async function answerCallback(token, id, text) {
  try {
    await call(token, 'answerCallbackQuery', { callback_query_id: id, text: text || '' });
  } catch {
    /* callback kedaluwarsa setelah ~1 menit — tidak apa-apa */
  }
}

/** Ubah teks pesan yang sudah terkirim, mis. mencatat keputusan pada tombol. */
async function editMessage(token, chatId, messageId, text) {
  try {
    await call(token, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] }, // buang tombolnya
    });
  } catch {
    /* pesan sudah dihapus atau tidak berubah — abaikan */
  }
}

/** Uji ujung-ke-ujung: token valid, dan pesan benar-benar sampai ke HP. */
async function test(token, chatId) {
  const bot = await whoAmI(token);
  await sendMessage(
    token,
    chatId,
    t('tg.uji')
  );
  return bot;
}

module.exports = {
  call,
  whoAmI,
  detectChatId,
  sendMessage,
  getUpdates,
  answerCallback,
  editMessage,
  chunk,
  test,
};
