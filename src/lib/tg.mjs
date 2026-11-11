// Telegram Bot API klienti (fetch asosida). Testlarda setTransport() bilan almashtiriladi.
import { cfg } from './env.mjs';
import { sleep } from './util.mjs';

export class TgError extends Error {
  constructor(method, code, description, retryAfter) {
    super(`${method}: ${description}`);
    this.method = method;
    this.code = code;
    this.description = description || '';
    this.retryAfter = retryAfter || 0;
  }
  get blocked() {
    return this.code === 403 || /bot was blocked|user is deactivated|chat not found/i.test(this.description);
  }
  get notModified() {
    return /message is not modified/i.test(this.description);
  }
  get gone() {
    return /message to edit not found|message can't be edited|message to delete not found|message can't be deleted|MESSAGE_ID_INVALID/i.test(this.description);
  }
}

/** transport(method, params, files?) -> {ok, result, error_code, description, parameters} */
async function defaultTransport(method, params, files) {
  const token = cfg.botToken;
  if (!token) throw new TgError(method, 0, 'BOT_TOKEN sozlanmagan');
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let res;
  if (files && Object.keys(files).length) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null) continue;
      fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    for (const [k, f] of Object.entries(files)) {
      fd.append(k, new Blob([f.buffer], { type: f.type || 'application/octet-stream' }), f.filename || k);
    }
    res = await fetch(url, { method: 'POST', body: fd });
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
  }
  return res.json().catch(() => ({ ok: false, error_code: res.status, description: 'Telegram javobi JSON emas' }));
}

let transport = defaultTransport;
export function setTransport(t) {
  transport = t || defaultTransport;
}

export async function call(method, params = {}, files) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await transport(method, params, files);
    if (r?.ok) return r.result;
    const retry = r?.parameters?.retry_after;
    if (r?.error_code === 429 && retry && retry <= 5 && attempt === 0) {
      await sleep(retry * 1000 + 100);
      continue;
    }
    throw new TgError(method, r?.error_code || 0, r?.description || 'noma\'lum xato', retry);
  }
}

/** Xatoni yutib yuboradigan variant (best-effort chaqiruvlar uchun). */
export async function tryCall(method, params, files) {
  try {
    return await call(method, params, files);
  } catch (e) {
    if (!(e instanceof TgError)) throw e;
    return null;
  }
}

export const sendMessage = (chat_id, text, extra = {}) =>
  call('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

export const editMessageText = (chat_id, message_id, text, extra = {}) =>
  call('editMessageText', {
    chat_id,
    message_id,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });

export const deleteMessage = (chat_id, message_id) => tryCall('deleteMessage', { chat_id, message_id });

export const answerCallbackQuery = (id, text, show_alert = false) =>
  tryCall('answerCallbackQuery', { callback_query_id: id, ...(text ? { text, show_alert } : {}) });

export const sendPhoto = (chat_id, photo, extra = {}) =>
  call('sendPhoto', { chat_id, photo, parse_mode: 'HTML', ...extra });

/** Rasmni yuklab, file_id oladi. */
export async function uploadPhoto(chat_id, buffer, mime = 'image/jpeg', filename = 'image.jpg') {
  const msg = await call(
    'sendPhoto',
    { chat_id, disable_notification: true, caption: '🖼 Test rasmi (saqlash uchun)' },
    { photo: { buffer, type: mime, filename } },
  );
  const sizes = msg?.photo || [];
  const best = sizes[sizes.length - 1];
  if (!best?.file_id) throw new TgError('sendPhoto', 0, 'Telegram file_id qaytarmadi');
  return { file_id: best.file_id, message_id: msg.message_id };
}

/** file_id bo'yicha rasm baytlarini olish (admin panelda ko'rsatish uchun). */
export async function downloadFile(file_id) {
  const info = await call('getFile', { file_id });
  if (!info?.file_path) throw new TgError('getFile', 0, 'file_path yo\'q');
  const token = cfg.botToken;
  if (transport !== defaultTransport) {
    // test rejimi
    const r = await transport('__download', { file_path: info.file_path });
    return r;
  }
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`);
  if (!res.ok) throw new TgError('download', res.status, 'Faylni yuklab bo\'lmadi');
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    type: res.headers.get('content-type') || 'image/jpeg',
  };
}

// --- Klaviatura yordamchilari ---
export const btn = (text, callback_data) => ({ text, callback_data });
export const urlBtn = (text, url) => ({ text, url });
export const webAppBtn = (text, url) => ({ text, web_app: { url } });
export const kb = (rows) => ({ inline_keyboard: rows.filter((r) => r && r.length) });
