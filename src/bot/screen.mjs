// Ekran almashtirish: imkon bo'lsa xabarni joyida tahrirlaydi, bo'lmasa o'chirib qayta yuboradi.
import * as tg from '../lib/tg.mjs';

/**
 * @param {object} p
 * @param {number} p.chatId
 * @param {string} p.text   HTML matn
 * @param {object} p.markup inline klaviatura
 * @param {string|null} p.photo Telegram file_id (ixtiyoriy) — alohida xabar sifatida yuboriladi
 * @param {{messageId?:number, auxId?:number}} p.prev oldingi xabar(lar)
 * @returns {{messageId:number, auxId:number|null}}
 */
export async function show({ chatId, text, markup, photo = null, prev = {} }) {
  if (prev.auxId) await tg.deleteMessage(chatId, prev.auxId);

  if (!photo && prev.messageId) {
    try {
      await tg.editMessageText(chatId, prev.messageId, text, { reply_markup: markup });
      return { messageId: prev.messageId, auxId: null };
    } catch (e) {
      if (!(e instanceof tg.TgError)) throw e;
      if (e.notModified) return { messageId: prev.messageId, auxId: null };
      if (e.blocked) throw e;
      // tahrirlab bo'lmadi (eski xabar va h.k.) — pastda yangisini yuboramiz
    }
  }
  if (prev.messageId) await tg.deleteMessage(chatId, prev.messageId);

  let auxId = null;
  let note = '';
  if (photo) {
    try {
      const m = await tg.sendPhoto(chatId, photo);
      auxId = m.message_id;
    } catch (e) {
      if (!(e instanceof tg.TgError) || e.blocked) throw e;
      note = '⚠️ <i>(Savol rasmini ko\'rsatib bo\'lmadi)</i>\n\n';
    }
  }
  const m = await tg.sendMessage(chatId, note + text, { reply_markup: markup });
  return { messageId: m.message_id, auxId };
}

/** Xuddi shu xabarning matni/klaviaturasini yangilaydi (rasm xabariga tegmaydi). */
export async function update({ chatId, messageId, text, markup }) {
  try {
    await tg.editMessageText(chatId, messageId, text, { reply_markup: markup });
    return messageId;
  } catch (e) {
    if (!(e instanceof tg.TgError)) throw e;
    if (e.notModified) return messageId;
    if (e.blocked) throw e;
    const m = await tg.sendMessage(chatId, text, { reply_markup: markup });
    return m.message_id;
  }
}
