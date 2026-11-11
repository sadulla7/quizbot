// Testlar va savollar bilan ishlash (CRUD + statistika).
import { all, batch, exec, one } from '../lib/db.mjs';
import { ApiError, now, parseJSON } from '../lib/util.mjs';

const COUNT_SQL = `(SELECT COUNT(*) FROM questions q WHERE q.test_id=t.id AND q.deleted_at IS NULL)`;
const VALID_ATTEMPTS = `a.test_id=t.id AND a.kind='normal' AND a.is_preview=0 AND a.status IN ('finished','expired')`;

export function publicTest(t) {
  if (!t) return null;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    is_published: !!t.is_published,
    is_listed: !!t.is_listed,
    instant_feedback: !!t.instant_feedback,
    time_limit_min: t.time_limit_min,
    questions_per_attempt: t.questions_per_attempt,
    shuffle_questions: !!t.shuffle_questions,
    shuffle_options: !!t.shuffle_options,
    max_attempts: t.max_attempts,
    pass_percent: t.pass_percent,
    show_leaderboard: !!t.show_leaderboard,
    notify_admins: !!t.notify_admins,
    sort_order: t.sort_order,
    created_at: t.created_at,
    updated_at: t.updated_at,
    ...(t.question_count !== undefined ? { question_count: t.question_count } : {}),
    ...(t.attempt_count !== undefined ? { attempt_count: t.attempt_count, avg_percent: t.avg_percent, user_count: t.user_count } : {}),
  };
}

export function publicQuestion(q) {
  return {
    id: q.id,
    test_id: q.test_id,
    position: q.position,
    text: q.text,
    image_file_id: q.image_file_id || null,
    options: parseJSON(q.options, []),
    correct_index: q.correct_index,
    explanation: q.explanation || '',
    keep_order: !!q.keep_order,
    updated_at: q.updated_at,
  };
}

export async function listTestsAdmin() {
  return all(
    `SELECT t.*,
        ${COUNT_SQL} AS question_count,
        (SELECT COUNT(*) FROM attempts a WHERE ${VALID_ATTEMPTS}) AS attempt_count,
        (SELECT ROUND(AVG(a.score_percent),1) FROM attempts a WHERE ${VALID_ATTEMPTS}) AS avg_percent,
        (SELECT COUNT(DISTINCT a.user_id) FROM attempts a WHERE ${VALID_ATTEMPTS}) AS user_count
       FROM tests t WHERE t.deleted_at IS NULL
      ORDER BY t.sort_order, t.id DESC`,
  );
}

export const getTest = (id) => one('SELECT * FROM tests WHERE id=? AND deleted_at IS NULL', [id]);

export async function getTestWithCount(id) {
  return one(`SELECT t.*, ${COUNT_SQL} AS question_count FROM tests t WHERE t.id=? AND t.deleted_at IS NULL`, [id]);
}

/** Botda ko'rinadigan testlar (e'lon qilingan, ro'yxatda ko'rinadigan, savoli bor). */
export async function listPublishedForBot() {
  return all(
    `SELECT t.*, ${COUNT_SQL} AS question_count FROM tests t
      WHERE t.deleted_at IS NULL AND t.is_published=1 AND t.is_listed=1
        AND EXISTS (SELECT 1 FROM questions q WHERE q.test_id=t.id AND q.deleted_at IS NULL)
      ORDER BY t.category, t.sort_order, t.id`,
  );
}

const TEST_FIELDS = [
  'title', 'description', 'category', 'is_published', 'is_listed', 'instant_feedback', 'time_limit_min',
  'questions_per_attempt', 'shuffle_questions', 'shuffle_options', 'max_attempts', 'pass_percent',
  'show_leaderboard', 'notify_admins', 'sort_order',
];

export async function createTest(v) {
  const t = now();
  const cols = TEST_FIELDS.filter((f) => v[f] !== undefined);
  const r = await exec(
    `INSERT INTO tests(${cols.join(',')}, created_at, updated_at) VALUES(${cols.map(() => '?').join(',')}, ?, ?)`,
    [...cols.map((c) => v[c]), t, t],
  );
  return r.lastInsertId;
}

export async function updateTest(id, v) {
  const cols = TEST_FIELDS.filter((f) => v[f] !== undefined);
  if (!cols.length) return;
  await exec(`UPDATE tests SET ${cols.map((c) => c + '=?').join(',')}, updated_at=? WHERE id=? AND deleted_at IS NULL`, [
    ...cols.map((c) => v[c]),
    now(),
    id,
  ]);
}

export async function deleteTest(id) {
  await exec('UPDATE tests SET deleted_at=?, is_published=0 WHERE id=? AND deleted_at IS NULL', [now(), id]);
}

export async function duplicateTest(id) {
  const t = now();
  const r = await exec(
    `INSERT INTO tests(title, description, category, is_published, is_listed, instant_feedback, time_limit_min,
        questions_per_attempt, shuffle_questions, shuffle_options, max_attempts, pass_percent, show_leaderboard,
        notify_admins, sort_order, created_at, updated_at)
     SELECT substr('Nusxa: ' || title, 1, 120), description, category, 0, is_listed, instant_feedback, time_limit_min,
        questions_per_attempt, shuffle_questions, shuffle_options, max_attempts, pass_percent, show_leaderboard,
        notify_admins, sort_order, ?, ? FROM tests WHERE id=? AND deleted_at IS NULL`,
    [t, t, id],
  );
  if (!r.rowsAffected) throw new ApiError(404, 'Test topilmadi.');
  const newId = r.lastInsertId;
  await exec(
    `INSERT INTO questions(test_id, position, text, image_file_id, options, correct_index, explanation, keep_order, created_at, updated_at)
     SELECT ?, position, text, image_file_id, options, correct_index, explanation, keep_order, ?, ?
       FROM questions WHERE test_id=? AND deleted_at IS NULL`,
    [newId, t, t, id],
  );
  return newId;
}

// ---------- Savollar ----------

export const listQuestions = (testId) =>
  all('SELECT * FROM questions WHERE test_id=? AND deleted_at IS NULL ORDER BY position, id', [testId]);

export const getQuestion = (id) => one('SELECT * FROM questions WHERE id=? AND deleted_at IS NULL', [id]);

async function assertImage(file_id) {
  if (!file_id) return;
  const r = await one('SELECT 1 AS ok FROM images WHERE file_id=?', [file_id]);
  if (!r) throw new ApiError(400, 'Rasm topilmadi. Uni qaytadan yuklang.');
}

async function nextPosition(testId) {
  const r = await one('SELECT COALESCE(MAX(position),0)+1 AS p FROM questions WHERE test_id=? AND deleted_at IS NULL', [testId]);
  return r.p;
}

export async function addQuestion(testId, v) {
  await assertImage(v.image_file_id);
  const t = now();
  const pos = await nextPosition(testId);
  const r = await exec(
    `INSERT INTO questions(test_id, position, text, image_file_id, options, correct_index, explanation, keep_order, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [testId, pos, v.text, v.image_file_id, JSON.stringify(v.options), v.correct_index, v.explanation, v.keep_order, t, t],
  );
  return r.lastInsertId;
}

export async function bulkAddQuestions(testId, list) {
  if (!list.length) return 0;
  const t = now();
  let pos = await nextPosition(testId);
  let added = 0;
  const CHUNK = 40;
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    const args = [];
    const marks = part.map((v) => {
      args.push(testId, pos++, v.text, v.image_file_id || null, JSON.stringify(v.options), v.correct_index, v.explanation || '', v.keep_order || 0, t, t);
      return '(?,?,?,?,?,?,?,?,?,?)';
    });
    const r = await exec(
      `INSERT INTO questions(test_id, position, text, image_file_id, options, correct_index, explanation, keep_order, created_at, updated_at) VALUES ${marks.join(',')}`,
      args,
    );
    added += r.rowsAffected || part.length;
  }
  return added;
}

export async function updateQuestion(id, v) {
  await assertImage(v.image_file_id);
  const r = await exec(
    `UPDATE questions SET text=?, image_file_id=?, options=?, correct_index=?, explanation=?, keep_order=?, updated_at=?
      WHERE id=? AND deleted_at IS NULL`,
    [v.text, v.image_file_id, JSON.stringify(v.options), v.correct_index, v.explanation, v.keep_order, now(), id],
  );
  if (!r.rowsAffected) throw new ApiError(404, 'Savol topilmadi.');
}

export async function deleteQuestion(id) {
  await exec('UPDATE questions SET deleted_at=? WHERE id=? AND deleted_at IS NULL', [now(), id]);
}

export async function reorderQuestions(testId, ids) {
  if (!ids.length) return;
  await batch(ids.map((id, i) => ({ sql: 'UPDATE questions SET position=? WHERE id=? AND test_id=?', args: [i + 1, id, testId] })));
}

/** Har bir savol bo'yicha statistika: necha kishi javob bergan, necha % to'g'ri, variantlar taqsimoti. */
export async function questionStats(testId) {
  const base = await all(
    `SELECT aq.question_id AS qid,
            SUM(CASE WHEN aq.chosen IS NOT NULL THEN 1 ELSE 0 END) AS answered,
            SUM(CASE WHEN aq.is_correct=1 THEN 1 ELSE 0 END) AS correct,
            COUNT(*) AS shown
       FROM attempt_questions aq JOIN attempts a ON a.id=aq.attempt_id
      WHERE a.test_id=? AND a.kind='normal' AND a.is_preview=0 AND a.status IN ('finished','expired')
      GROUP BY aq.question_id`,
    [testId],
  );
  const dist = await all(
    `SELECT aq.question_id AS qid, aq.chosen_orig AS opt, COUNT(*) AS c
       FROM attempt_questions aq JOIN attempts a ON a.id=aq.attempt_id
      WHERE a.test_id=? AND a.kind='normal' AND a.is_preview=0 AND a.status IN ('finished','expired') AND aq.chosen_orig IS NOT NULL
      GROUP BY aq.question_id, aq.chosen_orig`,
    [testId],
  );
  const map = {};
  for (const b of base) {
    map[b.qid] = { shown: b.shown, answered: b.answered, correct: b.correct, percent: b.shown ? Math.round((100 * b.correct) / b.shown) : null, options: {} };
  }
  for (const d of dist) if (map[d.qid]) map[d.qid].options[d.opt] = d.c;
  return map;
}
