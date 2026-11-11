// Telegram update'larini qabul qilish: takrorlanishdan himoya, foydalanuvchi, xatolarni ushlash.
import * as tg from '../lib/tg.mjs';
import { isAdmin } from '../lib/env.mjs';
import { exec } from '../lib/db.mjs';
import { ensureSchema } from '../lib/schema.mjs';
import { now } from '../lib/util.mjs';
import { markBlocked, upsertUser } from '../services/users.mjs';
import { BANNED } from './ui.mjs';
import { makeAck, onCallback, onMessage } from './handlers.mjs';

async function handle(update, origin) {
  // Bloklash / blokdan chiqarish
  if (update.my_chat_member) {
    const m = update.my_chat_member;
    if (m.chat?.type === 'private') {
      const status = m.new_chat_member?.status;
      if (status === 'kicked' || status === 'left') await markBlocked(m.from.id, true);
      else if (status === 'member') await markBlocked(m.from.id, false);
    }
    return;
  }

  const msg = update.message;
  const cq = update.callback_query;
  const from = msg?.from || cq?.from;
  const chat = msg?.chat || cq?.message?.chat;
  if (!from || !chat || from.is_bot) return;
  if (chat.type !== 'private') {
    if (cq) await tg.answerCallbackQuery(cq.id);
    return;
  }

  const user = await upsertUser(from);
  const ctx = {
    user,
    chatId: chat.id,
    origin,
    cbId: cq?.id || null,
    msgId: cq?.message?.message_id || null,
    bg: [],
  };
  makeAck(ctx);

  try {
    if (user.is_banned && !isAdmin(user.id)) {
      ctx.ack(BANNED, true);
      if (msg) await tg.sendMessage(chat.id, BANNED);
      return;
    }
    if (msg) await onMessage(ctx, msg);
    else await onCallback(ctx, cq);
  } catch (e) {
    if (e instanceof tg.TgError && e.blocked) {
      await markBlocked(user.id, true);
      return;
    }
    console.error('[bot] xato:', e?.stack || e);
    ctx.ack('⚠️ Vaqtincha xatolik. Qayta urinib ko\'ring.', true);
    if (msg) await tg.tryCall('sendMessage', { chat_id: chat.id, text: '⚠️ Vaqtincha xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.' });
  } finally {
    ctx.finalizeAck();
    await Promise.allSettled(ctx.bg);
  }
}

/** Webhook handler uchun asosiy kirish nuqtasi. */
export async function handleUpdate(update, { origin = '' } = {}) {
  await ensureSchema();
  if (update?.update_id != null) {
    const r = await exec('INSERT OR IGNORE INTO processed_updates(update_id, at) VALUES(?,?)', [update.update_id, now()]);
    if (!r.rowsAffected) return { duplicate: true };
  }
  try {
    await handle(update, origin);
  } catch (e) {
    // qayta yuborilganda qayta ishlanishi uchun belgini olib tashlaymiz
    if (update?.update_id != null) await exec('DELETE FROM processed_updates WHERE update_id=?', [update.update_id]).catch(() => {});
    throw e;
  }
  return { ok: true };
}
