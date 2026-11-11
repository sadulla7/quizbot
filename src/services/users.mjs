import { all, exec, one } from '../lib/db.mjs';
import { now } from '../lib/util.mjs';

/** Telegram `from` obyektidan foydalanuvchini yaratadi/yangilaydi va qatorni qaytaradi. */
export async function upsertUser(from) {
  const t = now();
  const r = await exec(
    `INSERT INTO users(id, first_name, last_name, username, lang, created_at, last_seen_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       first_name=excluded.first_name, last_name=excluded.last_name, username=excluded.username,
       lang=excluded.lang, last_seen_at=excluded.last_seen_at, is_blocked=0
     RETURNING *`,
    [from.id, from.first_name || '', from.last_name || '', from.username || '', from.language_code || '', t, t],
  );
  return r.rows[0];
}

export const getUser = (id) => one('SELECT * FROM users WHERE id=?', [id]);

export async function setState(id, state, data = null) {
  await exec('UPDATE users SET state=?, state_data=? WHERE id=?', [state, data ? JSON.stringify(data) : null, id]);
}

export async function setDisplayName(id, name) {
  await exec('UPDATE users SET display_name=?, state=NULL, state_data=NULL WHERE id=?', [name, id]);
}

export async function markBlocked(id, blocked = true) {
  await exec('UPDATE users SET is_blocked=? WHERE id=?', [blocked ? 1 : 0, id]);
}

export async function setBanned(id, banned) {
  await exec('UPDATE users SET is_banned=? WHERE id=?', [banned ? 1 : 0, id]);
}

/** Foydalanuvchining shaxsiy statistikasi. */
export async function userStats(userId) {
  const r = await one(
    `SELECT COUNT(*) AS attempts,
            COALESCE(ROUND(AVG(score_percent),1),0) AS avg_percent,
            COALESCE(MAX(score_percent),0) AS best_percent,
            COALESCE(SUM(correct_count),0) AS correct,
            COALESCE(SUM(total),0) AS total_q,
            COUNT(DISTINCT test_id) AS tests
       FROM attempts
      WHERE user_id=? AND kind='normal' AND is_preview=0 AND status IN ('finished','expired')`,
    [userId],
  );
  return r;
}

export const allUserIds = (after = 0, limit = 25) =>
  all('SELECT id FROM users WHERE id>? AND is_blocked=0 AND is_banned=0 ORDER BY id LIMIT ?', [after, limit]);
