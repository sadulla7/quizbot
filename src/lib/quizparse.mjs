// Matn / Word abzatslaridan savollarni ajratib oladi.
import { checkQuestion } from './validate.mjs';

const norm = (s) => s.replace(/[’‘ʻʼ`´]/g, "'").replace(/\u00a0/g, ' ');
const CYR = { А: 'A', В: 'B', С: 'C', Д: 'D', Е: 'E' };
const MARK = /\s*(?:\((?:to'g'ri javob|togri javob|правильный ответ|correct)\)|[✓✔*])\s*$/i;
const L = (c) => (CYR[c] || c).toUpperCase().charCodeAt(0) - 65;

export function parseQuiz(paras) {
  const lines = paras.map((p) => ({ text: norm(p.text || '').trim(), bold: !!p.bold })).filter((l) => l.text);
  const head = [], list = [], stray = [];
  let q = null, mode = 'q';
  for (const l of lines) {
    const t = l.text;
    const m = /^(\d{1,4})\s*[.)](?!\d)\s*(.*)$/.exec(t);
    const ans = /^(?:javob|to'g'ri javob|ответ|answer)\s*[:=-]\s*([A-Fa-f])\b/i.exec(t);
    const ex = /^(?:izoh|tushuntirish|explanation|пояснение)\s*[:-]\s*(.*)$/i.exec(t);
    const o = /^([A-FАВСДЕa-f])\s*[.)]\s*(.*)$/.exec(t);
    if (m) { q = { n: +m[1], text: m[2], options: [], marks: [], answer: null, explanation: '' }; list.push(q); mode = 'q'; }
    else if (!q) head.push(t);
    else if (ans) q.answer = L(ans[1]);
    else if (ex) { q.explanation = ex[1]; mode = 'e'; }
    else if (o) {
      const star = o[2].startsWith('*');
      const txt = o[2].replace(/^\*\s*/, '').replace(MARK, '').trim();
      if (l.bold || star || MARK.test(o[2])) q.marks.push(q.options.length);
      q.options.push(txt);
      mode = 'o';
    } else if (mode === 'q') q.text += '\n' + t;
    else if (mode === 'o') q.options[q.options.length - 1] += ' ' + t;
    else if (mode === 'e') q.explanation += ' ' + t;
    else stray.push(t);
  }
  const questions = list.map((x) => {
    const issues = [];
    let correct = null;
    if (x.answer !== null) correct = x.answer < x.options.length ? x.answer : (issues.push('Javob qatoridagi variant mavjud emas.'), null);
    else if (x.marks.length === 1) correct = x.marks[0];
    else if (x.marks.length > 1) issues.push(`Bir nechta variant belgilangan: ${x.marks.map((i) => String.fromCharCode(65 + i)).join(', ')}.`);
    else issues.push('To\'g\'ri javob belgilanmagan.');
    const { errors } = checkQuestion({ text: x.text, options: x.options, correct_index: correct ?? -1, explanation: x.explanation });
    for (const e of errors) if (!issues.includes(e) && !(correct === null && /belgilanmagan/.test(e))) issues.push(e);
    return { n: x.n, text: x.text, options: x.options, correct_index: correct, explanation: x.explanation, issues };
  });

  const warnings = [];
  const headText = head.join(' ');
  let expected = null;
  const r = /(\d+)\s*[–—-]\s*(\d+)[\s-]*savol/i.exec(headText), c = /(\d+)\s*ta\s*savol/i.exec(headText);
  if (r) expected = { from: +r[1], count: +r[2] - +r[1] + 1 };
  else if (c) expected = { from: null, count: +c[1] };
  const nums = questions.map((x) => x.n);
  if (nums.length) {
    const have = new Set(nums), missing = [];
    for (let i = nums[0]; i <= Math.max(...nums); i++) if (!have.has(i)) missing.push(i);
    if (missing.length) warnings.push(`Raqamlashda tushib qolgan savollar: ${missing.slice(0, 15).join(', ')}.`);
    if (have.size !== nums.length) warnings.push('Takrorlangan savol raqamlari bor.');
  }
  if (expected && expected.count !== questions.length) warnings.push(`Sarlavhada ${expected.count} ta savol deyilgan, lekin ${questions.length} ta savol topildi.`);
  if (!questions.length) warnings.push('Birorta savol topilmadi. Savollar "1." yoki "1)" bilan, variantlar "A)", "B)" bilan boshlanishi kerak.');
  return { title: head[0] || '', description: head.slice(1).join(' '), questions, warnings, expected, stats: { found: questions.length, bad: questions.filter((x) => x.issues.length).length } };
}
