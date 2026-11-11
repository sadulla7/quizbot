process.env.BOT_TOKEN ||= '123456:TEST-TOKEN';
process.env.ADMIN_IDS ||= '1001';
process.env.SETUP_KEY ||= 'test';
process.env.TURSO_DATABASE_URL ||= 'libsql://test.local';
process.env.TURSO_AUTH_TOKEN ||= 'test';

import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema } from '../src/lib/schema.mjs';
import { SAMPLE_QUESTIONS, adminApi, buttons, mockTelegram, useSqlite, userSim } from './helpers.mjs';

let tg;
let api;
beforeEach(async () => {
  useSqlite();
  tg = mockTelegram();
  api = adminApi(1001);
  await ensureSchema();
});

async function mkTest(title, questions = SAMPLE_QUESTIONS, extra = {}) {
  const t = await api('POST', '/api/admin/tests', { title, shuffle_questions: false, shuffle_options: false, ...extra });
  assert.equal(t.status, 200);
  const b = await api('POST', `/api/admin/tests/${t.data.id}/questions/bulk`, { questions });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  const p = await api('PUT', `/api/admin/tests/${t.data.id}`, { is_published: true });
  assert.equal(p.status, 200);
  return t.data.id;
}

test('start: menyu ko\'rinadi, admin tugmasi faqat adminda', async () => {
  const u = userSim(tg, 2001);
  await u.say('/start');
  assert.ok(!buttons(tg.screen(2001)).some((b) => /panel/i.test(b.text)));
  const a = userSim(tg, 1001);
  await a.say('/start');
  assert.ok(buttons(tg.screen(1001)).some((b) => /panel/i.test(b.text)));
});

test('to\'liq oqim: savol → izoh → natija', async () => {
  const id = await mkTest('Sinov testi');
  const u = userSim(tg, 2001);
  await u.say('/start');
  await u.tap(tg.screen(2001).id, `t:${id}`);
  await u.press(/Boshlash/);
  assert.match(tg.screen(2001).text, /Savol 1\/4/);
  await u.press(/^B$/);
  assert.match(tg.screen(2001).text, /To'g'ri!/);
  await u.press(/Keyingi/);
  await u.press(/^A$/);
  assert.match(tg.screen(2001).text, /Noto'g'ri\.<\/b> To'g'ri javob: <b>B/);
  await u.press(/Keyingi/);
  await u.press(/^C$/);
  await u.press(/Keyingi/);
  await u.press(/^A$/);
  await u.press(/Natijani/);
  assert.match(tg.screen(2001).text, /3|75/);
  const list = (await api('GET', `/api/admin/tests/${id}/attempts`)).data;
  assert.equal(list.total, 1);
  assert.equal(list.attempts[0].correct, 3);
});
