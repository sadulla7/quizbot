// Test yordamchilari: lokal SQLite drayveri, soxta Telegram, foydalanuvchi simulyatori.
import { DatabaseSync } from 'node:sqlite';
import { setDriver } from '../src/lib/db.mjs';
import { setTransport } from '../src/lib/tg.mjs';
import { resetSchemaCache } from '../src/lib/schema.mjs';
import { clearSettingsCache } from '../src/services/settings.mjs';
import { handleUpdate } from '../src/bot/index.mjs';
import { handleApi } from '../src/api/admin.mjs';
import { createLoginToken, signSession } from '../src/lib/auth.mjs';

export function useSqlite(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF;');
  const run1 = ({ sql, args = [] }) => {
    const st = db.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
    if (st.columns().length) {
      const rows = st.all(...params).map((r) => ({ ...r }));
      return { rows, rowsAffected: /^\s*(insert|update|delete)/i.test(sql) ? rows.length : 0, lastInsertId: null };
    }
    const r = st.run(...params);
    return { rows: [], rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  };
  setDriver({ async run(stmts) { return stmts.map(run1); } });
  resetSchemaCache();
  clearSettingsCache();
  return db;
}

export function mockTelegram() {
  const calls = [];
  const messages = new Map(); // id -> {chat, text, markup, photo}
  let nextId = 5000;
  const state = { failPhoto: false };
  async function transport(method, params = {}, files) {
    calls.push({ method, params, files });
    const ok = (result) => ({ ok: true, result });
    const err = (code, description, parameters) => ({ ok: false, error_code: code, description, parameters });
    switch (method) {
      case 'sendMessage': {
        const id = ++nextId;
        messages.set(id, { chat: params.chat_id, text: params.text, markup: params.reply_markup || null, photo: false });
        return ok({ message_id: id });
      }
      case 'sendPhoto': {
        if (files) return ok({ message_id: ++nextId, photo: [{ file_id: 'SMALL_' + nextId + '_xxxxxxxxxxxxxxxxxxxx' }, { file_id: 'BIG_' + nextId + '_xxxxxxxxxxxxxxxxxxxxxxxx' }] });
        if (state.failPhoto) return err(400, 'Bad Request: wrong file identifier/HTTP URL specified');
        const id = ++nextId;
        messages.set(id, { chat: params.chat_id, photo: true, text: '', markup: null });
        return ok({ message_id: id });
      }
      case 'editMessageText': {
        const m = messages.get(params.message_id);
        if (!m) return err(400, 'Bad Request: message to edit not found');
        const same = m.text === params.text && JSON.stringify(m.markup) === JSON.stringify(params.reply_markup || null);
        if (same) return err(400, 'Bad Request: message is not modified');
        m.text = params.text;
        m.markup = params.reply_markup || null;
        return ok({ message_id: params.message_id });
      }
      case 'deleteMessage': {
        if (!messages.has(params.message_id)) return err(400, 'Bad Request: message to delete not found');
        messages.delete(params.message_id);
        return ok(true);
      }
      case 'getMe': return ok({ id: 1, is_bot: true, username: 'test_quiz_bot' });
      case 'getFile': return ok({ file_path: 'photos/file.jpg' });
      case '__download': if (state.download) return state.download; return { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#cfd8e8"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#4a5875">Savol rasmi</text></svg>'), type: 'image/svg+xml' };
      case 'getWebhookInfo': return ok({ pending_update_count: 0 });
      default: return ok(true);
    }
  }
  setTransport(transport);
  const api = {
    calls, messages, state,
    reset() { calls.length = 0; },
    sent(method) { return calls.filter((c) => c.method === method); },
    last(method = 'sendMessage') { return calls.filter((c) => c.method === method).at(-1); },
    /** Chatdagi oxirgi ko'rinadigan xabar (id, matn, tugmalar) */
    screen(chat) {
      const ids = [...messages.keys()].filter((id) => messages.get(id).chat === chat && !messages.get(id).photo);
      const id = ids.at(-1);
      return id ? { id, ...messages.get(id) } : null;
    },
    photos(chat) { return [...messages.entries()].filter(([, m]) => m.chat === chat && m.photo).map(([id]) => id); },
  };
  return api;
}

export function buttons(msg) {
  return (msg?.markup?.inline_keyboard || []).flat();
}

export function findBtn(msg, re) {
  return buttons(msg).find((b) => (re instanceof RegExp ? re.test(b.text) : b.text === re));
}

let updateId = 1;
const baseUser = (id) => ({ id, is_bot: false, first_name: 'User' + id, username: 'user' + id, language_code: 'uz' });

export function userSim(tg, id, chat = id) {
  const from = baseUser(id);
  return {
    id,
    async say(text) {
      await handleUpdate({ update_id: updateId++, message: { message_id: updateId, from, chat: { id: chat, type: 'private' }, date: 0, text } }, { origin: 'https://example.test' });
    },
    async tap(messageId, data) {
      await handleUpdate({ update_id: updateId++, callback_query: { id: 'cb' + updateId, from, data, message: { message_id: messageId, chat: { id: chat, type: 'private' } } } }, { origin: 'https://example.test' });
    },
    /** Joriy ekrandagi tugmani matn bo'yicha bosadi */
    async press(re) {
      const s = tg.screen(chat);
      const b = findBtn(s, re);
      if (!b) throw new Error(`Tugma topilmadi: ${re}\nEkran: ${s?.text}\nTugmalar: ${buttons(s).map((x) => x.text).join(' | ')}`);
      await this.tap(s.id, b.callback_data);
      return tg.screen(chat);
    },
    screen() { return tg.screen(chat); },
  };
}

/** Admin API chaqiruvi: api(method, path, body) */
export function adminApi(uid = 1001) {
  const session = signSession(uid);
  return async function api(method, path, body, { raw, headers } = {}) {
    const init = { method, headers: { authorization: 'Bearer ' + session, ...(headers || {}) } };
    if (raw) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const res = await handleApi(new Request('https://example.test' + path, init));
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, res };
  };
}

export { createLoginToken };

export const SAMPLE_QUESTIONS = [
  { text: '2 + 2 nechiga teng?', options: ['3', '4', '5', '22'], correct_index: 1, explanation: 'Oddiy qo\'shish.' },
  { text: 'Poytaxt qaysi?', options: ['Samarqand', 'Toshkent', 'Buxoro'], correct_index: 1, explanation: '' },
  { text: 'Eng katta sayyora?', options: ['Yer', 'Mars', 'Yupiter', 'Venera', 'Saturn'], correct_index: 2, explanation: 'Yupiter — Quyosh tizimidagi eng katta sayyora.' },
  { text: '<b>HTML</b> & belgilari xavfsizmi?', options: ['Ha < >', 'Yo\'q & &amp;'], correct_index: 0, explanation: 'Izoh <i>matni</i>' },
];
