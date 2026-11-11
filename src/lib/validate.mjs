// Kiruvchi ma'lumotlarni tekshirish (admin API uchun).
import { ApiError } from './util.mjs';

export const LIMITS = {
  title: 120,
  description: 600,
  category: 60,
  qtext: 2500,
  option: 500,
  explanation: 800,
  minOptions: 2,
  maxOptions: 6,
  combined: 3300, // savol + variantlar + izoh jami (Telegram 4096 chegarasi uchun zaxira bilan)
};

const str = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');
const bool = (v, d) => (v === undefined ? d : v ? 1 : 0);
const int = (v, d, min, max) => {
  if (v === undefined || v === null || v === '') return d;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
};

export function validateTest(input, { partial = false } = {}) {
  const errors = [];
  const out = {};
  if (!partial || input.title !== undefined) {
    out.title = str(input.title);
    if (!out.title) errors.push('Test nomini kiriting.');
    if (out.title.length > LIMITS.title) errors.push(`Test nomi ${LIMITS.title} belgidan oshmasin.`);
  }
  if (!partial || input.description !== undefined) {
    out.description = str(input.description);
    if (out.description.length > LIMITS.description) errors.push(`Tavsif ${LIMITS.description} belgidan oshmasin.`);
  }
  if (!partial || input.category !== undefined) {
    out.category = str(input.category);
    if (out.category.length > LIMITS.category) errors.push(`Kategoriya ${LIMITS.category} belgidan oshmasin.`);
  }
  const flags = ['is_published', 'is_listed', 'instant_feedback', 'shuffle_questions', 'shuffle_options', 'show_leaderboard', 'notify_admins'];
  const defaults = { is_published: 0, is_listed: 1, instant_feedback: 1, shuffle_questions: 1, shuffle_options: 1, show_leaderboard: 1, notify_admins: 0 };
  for (const f of flags) {
    if (!partial || input[f] !== undefined) out[f] = bool(input[f], defaults[f]);
  }
  if (!partial || input.time_limit_min !== undefined) out.time_limit_min = int(input.time_limit_min, 0, 0, 600);
  if (!partial || input.questions_per_attempt !== undefined) out.questions_per_attempt = int(input.questions_per_attempt, 0, 0, 500);
  if (!partial || input.max_attempts !== undefined) out.max_attempts = int(input.max_attempts, 0, 0, 1000);
  if (!partial || input.pass_percent !== undefined) out.pass_percent = int(input.pass_percent, 60, 0, 100);
  if (!partial || input.sort_order !== undefined) out.sort_order = int(input.sort_order, 0, -100000, 100000);
  if (errors.length) throw new ApiError(400, errors.join(' '), { errors });
  return out;
}

/** Savolni tekshiradi; xatolar ro'yxatini qaytaradi (bulk import uchun ham ishlatiladi). */
export function checkQuestion(input) {
  const errors = [];
  const text = str(input?.text);
  const options = Array.isArray(input?.options) ? input.options.map(str) : [];
  const explanation = str(input?.explanation);
  const correct = Number(input?.correct_index ?? input?.correct);

  if (!text) errors.push('Savol matni bo\'sh.');
  if (text.length > LIMITS.qtext) errors.push(`Savol matni ${LIMITS.qtext} belgidan oshmasin (hozir ${text.length}).`);
  if (options.length < LIMITS.minOptions) errors.push(`Kamida ${LIMITS.minOptions} ta variant kerak.`);
  if (options.length > LIMITS.maxOptions) errors.push(`Variantlar ${LIMITS.maxOptions} tadan oshmasin.`);
  options.forEach((o, i) => {
    if (!o) errors.push(`${String.fromCharCode(65 + i)} varianti bo'sh.`);
    if (o.length > LIMITS.option) errors.push(`${String.fromCharCode(65 + i)} varianti ${LIMITS.option} belgidan oshmasin.`);
  });
  const lower = options.filter(Boolean).map((o) => o.toLowerCase());
  if (new Set(lower).size !== lower.length) errors.push('Bir xil variantlar bor.');
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) errors.push('To\'g\'ri javob belgilanmagan.');
  if (explanation.length > LIMITS.explanation) errors.push(`Izoh ${LIMITS.explanation} belgidan oshmasin.`);
  const total = text.length + options.reduce((a, o) => a + o.length, 0) + explanation.length;
  if (total > LIMITS.combined) errors.push(`Savol, variantlar va izoh jami ${LIMITS.combined} belgidan oshmasin (hozir ${total}).`);

  const image = input?.image_file_id ?? input?.image ?? null;
  return {
    errors,
    value: {
      text,
      options,
      correct_index: correct,
      explanation,
      image_file_id: image ? String(image) : null,
      keep_order: bool(input?.keep_order, 0),
    },
  };
}

export function validateQuestion(input) {
  const { errors, value } = checkQuestion(input);
  if (errors.length) throw new ApiError(400, errors.join(' '), { errors });
  return value;
}
