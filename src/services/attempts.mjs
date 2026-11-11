// Test topshirish urinishlari: boshlash, javob yozish, yakunlash, reyting.
import { all, batch, exec, isUniqueViolation, one } from '../lib/db.mjs';
import { now, parseJSON, shuffle } from '../lib/util.mjs';

const DONE = `('finished','expired')`;

const WITH_TEST = `SELECT a.*, t.title AS test_title, t.pass_percent, t.show_leaderboard, t.max_attempts, t.notify_admins
  FROM attempts a LEFT JOIN tests t ON t.id=a.test_id`;

export const getAttempt = (id) => one(`${WITH_TEST} WHERE a.id=?`, [id]);

export const getActiveAttempt = (userId) =>
  one(`${WITH_TEST} WHERE a.user_id=? AND a.status='active' ORDER BY a.id DESC LIMIT 1`, [userId]);

/** Foydalanuvchi shu testni necha marta boshlagan (bekor qilinganlari ham hisobga olinadi). */
export async function countAttempts(userId, testId) {
  const r = await one(
    `SELECT COUNT(*) AS c FROM attempts
      WHERE user_id=? AND test_id=? AND kind='normal' AND is_preview=0 AND status IN ('active','finished','expired','abandoned')`,
    [userId, testId],
  );
  return r.c;
}

// ---------- Savollar to'plamini tayyorlash ----------

function snapshotFromQuestion(q, shuffleOpts) {
  const opts = parseJSON(q.options, []);
  let order = opts.map((_, i) => i);
  if (shuffleOpts && !q.keep_order) order = shuffle(order);
  return { qid: q.id, s: { t: q.text, img: q.image_file_id || null, o: order.map((i) => opts[i]), c: order.indexOf(q.correct_index), e: q.explanation || '', m: order } };
}

function reshuffleSnapshot(s) {
  const order = shuffle(s.o.map((_, i) => i));
  return { ...s, o: order.map((i) => s.o[i]), c: order.indexOf(s.c), m: order.map((i) => s.m[i]) };
}

export async function pickForTest(test) {
  const rows = await all('SELECT * FROM questions WHERE test_id=? AND deleted_at IS NULL ORDER BY position, id', [test.id]);
  let picked = rows;
  const n = test.questions_per_attempt;
  if (n > 0 && n < rows.length) {
    picked = shuffle(rows).slice(0, n);
    if (!test.shuffle_questions) picked.sort((a, b) => a.position - b.position || a.id - b.id);
  }
  if (test.shuffle_questions) picked = shuffle(picked);
  return picked.map((q) => snapshotFromQuestion(q, !!test.shuffle_options));
}

/** Oldingi urinishdagi xato (yoki javobsiz) savollar asosida yangi to'plam. */
export async function pickMistakes(parentId) {
  const rows = await all(
    `SELECT question_id, snapshot FROM attempt_questions WHERE attempt_id=? AND (is_correct IS NULL OR is_correct=0) ORDER BY idx`,
    [parentId],
  );
  return shuffle(rows).map((r) => ({ qid: r.question_id, s: reshuffleSnapshot(parseJSON(r.snapshot)) }));
}

/**
 * Yangi urinish yaratadi. Foydalanuvchida faol urinish bo'lsa { conflict:true } qaytaradi.
 * set: [{qid, s}] — tayyor savollar.
 */
export async function createAttempt({ userId, test, set, kind = 'normal', parentId = null, isPreview = false, chatId, instant, timeLimitMin }) {
  const t = now();
  const limit = timeLimitMin ?? test.time_limit_min;
  let attempt;
  try {
    const r = await exec(
      `INSERT INTO attempts(user_id, test_id, kind, parent_id, status, is_preview, total, instant_feedback, started_at, deadline, chat_id)
       VALUES(?,?,?,?, 'preparing', ?,?,?,?,?,?) RETURNING *`,
      [userId, test.id, kind, parentId, isPreview ? 1 : 0, set.length, (instant ?? test.instant_feedback) ? 1 : 0, t, limit > 0 ? t + limit * 60 : null, chatId],
    );
    attempt = r.rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) return { conflict: true };
    throw e;
  }
  try {
    const args = [];
    const marks = set.map((item, i) => {
      args.push(attempt.id, i, item.qid, JSON.stringify(item.s));
      return '(?,?,?,?)';
    });
    await exec(`INSERT INTO attempt_questions(attempt_id, idx, question_id, snapshot) VALUES ${marks.join(',')}`, args);
    await exec(`UPDATE attempts SET status='active' WHERE id=?`, [attempt.id]);
  } catch (e) {
    await exec(`DELETE FROM attempts WHERE id=?`, [attempt.id]).catch(() => {});
    throw e;
  }
  return { attempt: { ...attempt, status: 'active' } };
}

// ---------- Jarayon ----------

/** Javobsiz qolgan eng boshidagi 2 ta savol: [joriy, keyingi]. */
export async function pending(attemptId) {
  const rows = await all(
    `SELECT idx, question_id, snapshot FROM attempt_questions WHERE attempt_id=? AND chosen IS NULL ORDER BY idx LIMIT 2`,
    [attemptId],
  );
  return rows.map((r) => ({ idx: r.idx, qid: r.question_id, s: parseJSON(r.snapshot) }));
}

/** Javobni bir martalik yozadi. */
export async function recordAnswer(attemptId, idx, choice, snap) {
  if (!Number.isInteger(choice) || choice < 0 || choice >= snap.o.length) return { status: 'bad' };
  const ok = choice === snap.c ? 1 : 0;
  const r = await exec(
    `UPDATE attempt_questions SET chosen=?, chosen_orig=?, is_correct=?, answered_at=? WHERE attempt_id=? AND idx=? AND chosen IS NULL`,
    [choice, snap.m?.[choice] ?? choice, ok, now(), attemptId, idx],
  );
  if (!r.rowsAffected) return { status: 'dup' };
  return { status: 'ok', correct: !!ok };
}

/** Faqat bir marta muvaffaqiyatli bo'ladi (status='active' sharti). */
export async function finishAttempt(id, status = 'finished') {
  const r = await exec(
    `UPDATE attempts SET status=?, finished_at=?,
        correct_count=(SELECT COUNT(*) FROM attempt_questions WHERE attempt_id=? AND is_correct=1),
        score_percent=ROUND(100.0*(SELECT COUNT(*) FROM attempt_questions WHERE attempt_id=? AND is_correct=1)/MAX(total,1),1)
      WHERE id=? AND status='active' RETURNING *`,
    [status, now(), id, id, id],
  );
  return r.rows[0] || null;
}

export async function abandonAttempt(id) {
  const r = await exec(`UPDATE attempts SET status='abandoned', finished_at=? WHERE id=? AND status='active' RETURNING *`, [now(), id]);
  return r.rows[0] || null;
}

export async function setMessageIds(id, { messageId, auxId, chatId }) {
  await exec('UPDATE attempts SET message_id=?, aux_message_id=?, chat_id=COALESCE(?, chat_id) WHERE id=?', [messageId ?? null, auxId ?? null, chatId ?? null, id]);
}

export async function summary(id) {
  const r = await one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN chosen IS NOT NULL THEN 1 ELSE 0 END) AS answered,
            SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN is_correct=0 THEN 1 ELSE 0 END) AS wrong
       FROM attempt_questions WHERE attempt_id=?`,
    [id],
  );
  const total = r.total || 0;
  const answered = r.answered || 0;
  return { total, answered, correct: r.correct || 0, wrong: r.wrong || 0, skipped: total - answered };
}

export const wrongCount = async (attemptId) =>
  (await one('SELECT COUNT(*) AS c FROM attempt_questions WHERE attempt_id=? AND (is_correct IS NULL OR is_correct=0)', [attemptId])).c;

/** Xatolar ro'yxatidagi p-chi element (tartib raqami bo'yicha). */
export async function reviewItem(attemptId, p) {
  const r = await one(
    `SELECT idx, snapshot, chosen FROM attempt_questions
      WHERE attempt_id=? AND (is_correct IS NULL OR is_correct=0) ORDER BY idx LIMIT 1 OFFSET ?`,
    [attemptId, p],
  );
  return r ? { idx: r.idx, s: parseJSON(r.snapshot), chosen: r.chosen } : null;
}

export const userAttempts = (userId, limit = 8, offset = 0) =>
  all(
    `SELECT a.*, t.title AS test_title FROM attempts a LEFT JOIN tests t ON t.id=a.test_id
      WHERE a.user_id=? AND a.status IN ${DONE} AND a.is_preview=0 ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );

export const userAttemptCount = async (userId) =>
  (await one(`SELECT COUNT(*) AS c FROM attempts WHERE user_id=? AND status IN ${DONE} AND is_preview=0`, [userId])).c;

/** Reyting: har bir foydalanuvchining eng yaxshi urinishi. */
export async function leaderboard(testId, limit = 500) {
  return all(
    `WITH best AS (
       SELECT a.id, a.user_id, a.correct_count, a.total, a.score_percent,
              (a.finished_at - a.started_at) AS dur,
              ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a.score_percent DESC, (a.finished_at - a.started_at) ASC, a.id ASC) AS rn
         FROM attempts a
        WHERE a.test_id=? AND a.kind='normal' AND a.is_preview=0 AND a.status IN ${DONE})
     SELECT b.*, u.first_name, u.last_name, u.username, u.display_name
       FROM best b JOIN users u ON u.id=b.user_id
      WHERE b.rn=1 ORDER BY b.score_percent DESC, b.dur ASC, b.id ASC LIMIT ?`,
    [testId, limit],
  );
}

// ---------- Texnik xizmat (cron) ----------

export const expiredActive = (limit = 50) =>
  all(`SELECT * FROM attempts WHERE status='active' AND deadline IS NOT NULL AND deadline < ? ORDER BY deadline LIMIT ?`, [now(), limit]);

export async function cleanup() {
  const t = now();
  const out = await batch([
    { sql: `DELETE FROM attempts WHERE status='preparing' AND started_at < ?`, args: [t - 300] },
    { sql: `DELETE FROM processed_updates WHERE at < ?`, args: [t - 2 * 86400] },
    { sql: `DELETE FROM login_tokens WHERE expires_at < ?`, args: [t - 3600] },
    {
      // 7 kun harakatsiz, vaqt chegarasiz urinishlar "tashlab ketilgan" deb belgilanadi
      sql: `UPDATE attempts SET status='abandoned', finished_at=?
             WHERE status='active' AND deadline IS NULL
               AND COALESCE((SELECT MAX(answered_at) FROM attempt_questions WHERE attempt_id=attempts.id), started_at) < ?`,
      args: [t, t - 7 * 86400],
    },
  ]);
  return { abandoned: out[3].rowsAffected };
}
