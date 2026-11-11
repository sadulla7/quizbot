process.env.BOT_TOKEN ||= '123456:TEST-TOKEN';
process.env.ADMIN_IDS ||= '1001';
process.env.SETUP_KEY ||= 'test';
process.env.TURSO_DATABASE_URL ||= 'libsql://test.local';
process.env.TURSO_AUTH_TOKEN ||= 'test';

import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema } from '../src/lib/schema.mjs';
import { signSession } from '../src/lib/auth.mjs';
import { handleApi } from '../src/api/admin.mjs';
import { parseRaw, parseUpload } from '../src/services/importer.mjs';
import { adminApi, mockTelegram, useSqlite } from './helpers.mjs';

const real = readFileSync(new URL('./fixtures/logistika-1-100.docx', import.meta.url));
let api;
beforeEach(async () => { useSqlite(); mockTelegram(); api = adminApi(1001); await ensureSchema(); });

test('haqiqiy fayl: 100 ta savol, har birida 4 variant, #83 tuzatishni talab qiladi', () => {
  const r = parseUpload(real, 'a.docx');
  assert.equal(r.title, 'Logistika asoslari 2');
  assert.equal(r.stats.found, 100);
  assert.ok(r.questions.every((q) => q.options.length === 4));
  assert.deepEqual(r.questions.filter((q) => q.issues.length).map((q) => q.n), [83]);
  assert.deepEqual(r.expected, { from: 1, count: 100 });
  assert.deepEqual(r.warnings, []);
  assert.ok(!/\(To'g'ri javob\)/i.test(r.questions[0].options[2]), 'belgi variant matnidan olib tashlanadi');
  assert.match(r.questions[82].text, /Ta'minot \/ Taqsimot/);
});

test('oddiy matn: "Javob:" qatori, kirill harflar, ko\'p qatorli savol, izoh', () => {
  const r = parseRaw('Mening testim\n1. Birinchi qator\nikkinchi qator?\nA) x\nB) y\nJavob: B\nIzoh: sababi\nshu yerda\n2. Qaysi?\nА) p\nВ) q (To\'g\'ri javob)');
  assert.equal(r.title, 'Mening testim');
  assert.equal(r.questions[0].text, 'Birinchi qator\nikkinchi qator?');
  assert.equal(r.questions[0].correct_index, 1);
  assert.equal(r.questions[0].explanation, 'sababi shu yerda');
  assert.equal(r.questions[1].correct_index, 1);
  assert.deepEqual(r.questions.map((q) => q.issues), [[], []]);
});

test('belgilar: bir nechta belgi va belgisiz savol xato; o\'nlik son savol raqami emas', () => {
  const r = parseRaw('1. S?\nA) a *\nB) b ✓\n2. T?\nA) a\nB) b\n3. Son\nA) 3.14 ga teng\nB) boshqa *');
  assert.match(r.questions[0].issues[0], /Bir nechta/);
  assert.match(r.questions[1].issues[0], /belgilanmagan/);
  assert.equal(r.questions[2].issues.length, 0);
  assert.equal(parseRaw('1. S?\nA) 2\n3.14 ni bildiradi\nB) 4\nJavob: A').questions[0].options[0], '2 3.14 ni bildiradi');
  assert.equal(parseRaw('1. S?\nA) 2\n3.14 ni bildiradi\nB) 4\nJavob: A').stats.found, 1);
});

test('"Javob:" qatori belgidan ustun; noto\'g\'ri fayllar tushunarli xato beradi', () => {
  assert.equal(parseRaw('1. S?\nA) a *\nB) b\nJavob: B').questions[0].correct_index, 1);
  assert.throws(() => parseUpload(Buffer.from('zip emas'), 'x.docx'), /to'g'ri Word/);
  assert.throws(() => parseUpload(Buffer.from('x'), 'x.pdf'), /docx yoki .txt/);
});

test('API: docx o\'qiladi, #83 ni to\'g\'rilamaguncha saqlashni rad etadi; to\'g\'rilangach qoralama test yaratadi', async () => {
  const res = await handleApi(new Request('https://t.test/api/admin/import/parse', { method: 'POST', headers: { authorization: 'Bearer ' + signSession(1001), 'x-file-name': encodeURIComponent('t.docx') }, body: real }));
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.questions.length, 100);
  const bad = await api('POST', '/api/admin/import/commit', { test: { title: r.title }, questions: r.questions });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /#83/);
  r.questions[82].correct_index = 2;
  const ok = await api('POST', '/api/admin/import/commit', { test: { title: r.title, description: r.description }, questions: r.questions });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.added, 100);
  const t = (await api('GET', '/api/admin/tests')).data.tests[0];
  assert.equal(t.question_count, 100);
  assert.equal(t.is_published, false);
  const forbidden = await handleApi(new Request('https://t.test/api/admin/import/parse', { method: 'POST', headers: { authorization: 'Bearer ' + signSession(5555) }, body: real }));
  assert.notEqual(forbidden.status, 200);
});

test('Bot: admin docx yuboradi → qoralama test, #83 alohida ko\'rsatiladi; oddiy foydalanuvchi test yaratmaydi', async () => {
  const { handleUpdate } = await import('../src/bot/index.mjs');
  const tg2 = mockTelegram();
  tg2.state.download = { buffer: real, type: 'application/octet-stream' };
  const send = (id, name = 'logistika.docx') => handleUpdate({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 7, from: { id, is_bot: false, first_name: 'T' }, chat: { id, type: 'private' }, date: 0, document: { file_id: 'f1', file_name: name, file_size: 1000 } } }, { origin: 'https://t.test' });
  await send(2001);
  assert.equal((await api('GET', '/api/admin/tests')).data.tests.length, 0, 'oddiy foydalanuvchi test yarata olmaydi');
  await send(1001, 'x.pdf');
  assert.equal((await api('GET', '/api/admin/tests')).data.tests.length, 0, 'pdf qabul qilinmaydi');
  await send(1001);
  const text = tg2.screen(1001).text;
  assert.match(text, /100<\/b> ta savol o'qildi/);
  assert.match(text, /#83/);
  assert.match(text, /99<\/b> ta savol <b>qoralama/);
  const t = (await api('GET', '/api/admin/tests')).data.tests[0];
  assert.equal(t.question_count, 99);
  assert.equal(t.is_published, false);
});
