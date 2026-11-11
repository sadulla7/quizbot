// Fayl / matndan test yaratish: o'qish va saqlash.
import { readDocx } from '../lib/docx.mjs';
import { parseQuiz } from '../lib/quizparse.mjs';
import { checkQuestion, validateTest } from '../lib/validate.mjs';
import { ApiError } from '../lib/util.mjs';
import * as T from './tests.mjs';

export const MAX_UPLOAD = 5 * 1024 * 1024;

export function parseRaw(text, name = '') {
  const r = parseQuiz(String(text).split(/\r?\n/).map((t) => ({ text: t, bold: false })));
  return { ...r, source: name };
}

export function parseUpload(buf, name = '') {
  if (buf.length > MAX_UPLOAD) throw new ApiError(413, 'Fayl 5 MB dan oshmasin.');
  if (/\.txt$/i.test(name)) return parseRaw(buf.toString('utf8'), name);
  if (!/\.docx$/i.test(name)) throw new ApiError(400, 'Faqat .docx yoki .txt fayl qabul qilinadi.');
  let d;
  try { d = readDocx(buf); } catch (e) { throw new ApiError(400, e.message); }
  const r = parseQuiz(d.paragraphs);
  if (d.hasImages) r.warnings.push('Hujjatda rasmlar bor — rasmlar import qilinmaydi. Rasmli savollarni keyin panelda qo\'shing.');
  if (d.hasTables && !r.stats.found) r.warnings.push('Hujjatda jadval bor. Savollarni jadvalsiz, oddiy matn ko\'rinishida yozing.');
  return { ...r, source: name };
}

/** Tekshirilgan savollarni saqlaydi. Yangi test qoralama bo'ladi. */
export async function commitImport({ test, testId, questions }) {
  const list = [];
  questions.forEach((q, i) => {
    const { errors, value } = checkQuestion(q);
    if (errors.length) throw new ApiError(400, `${q.n ? '#' + q.n : i + 1}-savolda xato: ${errors[0]}`);
    list.push(value);
  });
  if (!list.length) throw new ApiError(400, 'Saqlash uchun savol yo\'q.');
  let id = testId;
  if (!id) id = await T.createTest(validateTest({ title: test?.title || 'Yangi test', description: test?.description || '', category: test?.category || '' }));
  else if (!(await T.getTestWithCount(id))) throw new ApiError(404, 'Test topilmadi.');
  const added = await T.bulkAddQuestions(id, list);
  return { test_id: id, added };
}
