// Admin panel REST API.
import * as tg from '../lib/tg.mjs';
import { cfg, isAdmin } from '../lib/env.mjs';
import { all, exec, one } from '../lib/db.mjs';
import { consumeLoginToken, signSession, verifyInitData } from '../lib/auth.mjs';
import { ApiError, esc, fmtDate, now, sleep, userLabel } from '../lib/util.mjs';
import { checkQuestion, validateQuestion, validateTest } from '../lib/validate.mjs';
import { getSetting, setSetting } from '../services/settings.mjs';
import { allUserIds, getUser, markBlocked, setBanned, upsertUser, userStats } from '../services/users.mjs';
import * as T from '../services/tests.mjs';
import * as A from '../services/attempts.mjs';
import { createRouter } from './router.mjs';
import { MAX_UPLOAD, commitImport, parseRaw, parseUpload } from '../services/importer.mjs';

const VALID = `a.kind='normal' AND a.is_preview=0 AND a.status IN ('finished','expired')`;

const int = (v, d, min = 0, max = 1e9) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

async function botUsername() {
  let u = await getSetting('bot_username');
  if (!u) {
    try {
      const me = await tg.call('getMe');
      u = me.username || '';
      if (u) await setSetting('bot_username', u);
    } catch {
      u = '';
    }
  }
  return u;
}

function pubUser(u) {
  return {
    id: u.id,
    name: userLabel(u),
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    display_name: u.display_name,
    is_banned: !!u.is_banned,
    is_blocked: !!u.is_blocked,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
  };
}

async function requireTest(id) {
  const t = await T.getTest(int(id, 0));
  if (!t) throw new ApiError(404, 'Test topilmadi.');
  return t;
}

// ---------------- Auth ----------------

async function authToken(c) {
  const { token } = await c.body(10_000);
  const uid = await consumeLoginToken(token);
  if (!uid) throw new ApiError(401, 'Havola yaroqsiz yoki muddati tugagan. Botda /panel buyrug\'ini qaytadan yuboring.');
  if (!isAdmin(uid)) throw new ApiError(403, 'Siz admin emassiz.');
  return { session: signSession(uid), id: uid };
}

async function authWebApp(c) {
  const { initData } = await c.body(20_000);
  const u = verifyInitData(initData);
  if (!u?.id) throw new ApiError(401, 'Telegram ma\'lumotlari tasdiqlanmadi. Panelni botdagi tugma orqali oching.');
  if (!isAdmin(u.id)) throw new ApiError(403, `Siz admin emassiz (ID: ${u.id}). ADMIN_IDS ga qo'shing.`);
  return { session: signSession(u.id), id: u.id };
}


// ---------------- Fayldan test yaratish ----------------

async function importParse(c) {
  const type = (c.req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') {
    const { text, name } = await c.body(MAX_UPLOAD);
    if (!String(text || '').trim()) throw new ApiError(400, 'Matn bo\'sh.');
    return parseRaw(text, String(name || ''));
  }
  const buf = Buffer.from(await c.req.arrayBuffer());
  let name = '';
  try { name = decodeURIComponent(c.req.headers.get('x-file-name') || ''); } catch {}
  return parseUpload(buf, name);
}

async function importCommit(c) {
  const b = await c.body(MAX_UPLOAD);
  if (!Array.isArray(b.questions) || b.questions.length > 1000) throw new ApiError(400, 'Savollar ro\'yxati noto\'g\'ri.');
  return commitImport({ test: b.test || {}, testId: b.test_id ? Number(b.test_id) : null, questions: b.questions });
}

// ---------------- Dashboard ----------------

async function stats() {
  const tz = cfg.tzOffsetHours * 3600;
  const t = now();
  const dayStart = Math.floor((t + tz) / 86400) * 86400 - tz;
  const from14 = dayStart - 13 * 86400;

  const [u, tt, qq, aa, daily, topTests, recent, hardest, usersDaily] = await Promise.all([
    one(`SELECT COUNT(*) AS total, SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS today,
                SUM(CASE WHEN last_seen_at>=? THEN 1 ELSE 0 END) AS active7, SUM(is_blocked) AS blocked FROM users`, [dayStart, t - 7 * 86400]),
    one(`SELECT COUNT(*) AS total, COALESCE(SUM(is_published),0) AS published FROM tests WHERE deleted_at IS NULL`),
    one(`SELECT COUNT(*) AS total FROM questions q JOIN tests t ON t.id=q.test_id WHERE q.deleted_at IS NULL AND t.deleted_at IS NULL`),
    one(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN a.finished_at>=? THEN 1 ELSE 0 END),0) AS today,
                COALESCE(ROUND(AVG(a.score_percent),1),0) AS avg_percent FROM attempts a WHERE ${VALID}`, [dayStart]),
    all(`SELECT strftime('%Y-%m-%d', a.finished_at + ?, 'unixepoch') AS d, COUNT(*) AS attempts, COUNT(DISTINCT a.user_id) AS users
           FROM attempts a WHERE ${VALID} AND a.finished_at>=? GROUP BY d`, [tz, from14]),
    all(`SELECT t.id, t.title, COUNT(*) AS attempts, ROUND(AVG(a.score_percent),1) AS avg_percent
           FROM attempts a JOIN tests t ON t.id=a.test_id
          WHERE ${VALID} AND a.finished_at>=? AND t.deleted_at IS NULL GROUP BY t.id ORDER BY attempts DESC LIMIT 5`, [t - 30 * 86400]),
    all(`SELECT a.id, a.test_id, a.correct_count, a.total, a.score_percent, a.finished_at, t.title AS test_title,
                u.first_name, u.last_name, u.username, u.display_name, u.id AS user_id
           FROM attempts a JOIN users u ON u.id=a.user_id LEFT JOIN tests t ON t.id=a.test_id
          WHERE ${VALID} ORDER BY a.id DESC LIMIT 8`),
    all(`SELECT q.id, q.text, q.test_id, t.title AS test_title, COUNT(*) AS shown, SUM(aq.is_correct) AS correct
           FROM attempt_questions aq JOIN attempts a ON a.id=aq.attempt_id
           JOIN questions q ON q.id=aq.question_id JOIN tests t ON t.id=q.test_id
          WHERE ${VALID} AND q.deleted_at IS NULL AND t.deleted_at IS NULL
          GROUP BY q.id HAVING COUNT(*) >= 3 ORDER BY (1.0*SUM(aq.is_correct)/COUNT(*)) ASC LIMIT 5`),
    Promise.resolve(null),
  ]);

  const byDay = new Map(daily.map((r) => [r.d, r]));
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const ts = dayStart - i * 86400;
    const d = new Date((ts + tz) * 1000).toISOString().slice(0, 10);
    const r = byDay.get(d);
    series.push({ date: d, attempts: r?.attempts || 0, users: r?.users || 0 });
  }
  void usersDaily;
  return {
    users: { total: u.total, today: u.today || 0, active7: u.active7 || 0, blocked: u.blocked || 0 },
    tests: { total: tt.total, published: tt.published },
    questions: qq.total,
    attempts: { total: aa.total, today: aa.today, avg_percent: aa.avg_percent },
    series,
    top_tests: topTests,
    recent: recent.map((r) => ({
      id: r.id, test_id: r.test_id, test_title: r.test_title, user_id: r.user_id, user: userLabel(r),
      correct: r.correct_count, total: r.total, percent: r.score_percent, finished_at: r.finished_at,
    })),
    hardest: hardest.map((r) => ({
      id: r.id, test_id: r.test_id, test_title: r.test_title, text: r.text.slice(0, 140),
      shown: r.shown, percent: Math.round((100 * r.correct) / r.shown),
    })),
  };
}

// ---------------- Testlar ----------------

async function listTests() {
  const rows = await T.listTestsAdmin();
  return { tests: rows.map(T.publicTest), categories: [...new Set(rows.map((r) => r.category).filter(Boolean))] };
}

async function createTest(c) {
  const v = validateTest(await c.body(50_000));
  const id = await T.createTest(v);
  return { id };
}

async function getTestDetail(c) {
  const row = await T.getTestWithCount(int(c.params.id, 0));
  if (!row) throw new ApiError(404, 'Test topilmadi.');
  const [questions, qstats, username] = await Promise.all([T.listQuestions(row.id), T.questionStats(row.id), botUsername()]);
  return {
    test: T.publicTest(row),
    questions: questions.map((q) => ({ ...T.publicQuestion(q), stats: qstats[q.id] || null })),
    link: username ? `https://t.me/${username}?start=t_${row.id}` : null,
  };
}

async function updateTest(c) {
  const t = await requireTest(c.params.id);
  const v = validateTest(await c.body(50_000), { partial: true });
  if (v.is_published) {
    const n = (await T.getTestWithCount(t.id)).question_count;
    if (!n) throw new ApiError(400, 'Savolsiz testni e\'lon qilib bo\'lmaydi. Avval savol qo\'shing.');
  }
  await T.updateTest(t.id, v);
  return { ok: true };
}

async function deleteTest(c) {
  const t = await requireTest(c.params.id);
  await T.deleteTest(t.id);
  return { ok: true };
}

async function duplicateTest(c) {
  const t = await requireTest(c.params.id);
  return { id: await T.duplicateTest(t.id) };
}

async function reorder(c) {
  const t = await requireTest(c.params.id);
  const { ids } = await c.body(50_000);
  if (!Array.isArray(ids) || ids.some((x) => !Number.isInteger(x))) throw new ApiError(400, 'ids noto\'g\'ri.');
  await T.reorderQuestions(t.id, ids);
  return { ok: true };
}

// ---------------- Savollar ----------------

async function addQuestion(c) {
  const t = await requireTest(c.params.id);
  const v = validateQuestion(await c.body(100_000));
  return { id: await T.addQuestion(t.id, v) };
}

async function bulkQuestions(c) {
  const t = await requireTest(c.params.id);
  const { questions } = await c.body(2_000_000);
  if (!Array.isArray(questions) || !questions.length) throw new ApiError(400, 'Savollar ro\'yxati bo\'sh.');
  if (questions.length > 500) throw new ApiError(400, 'Bir martada 500 tadan ortiq savol qo\'shib bo\'lmaydi.');
  const list = [];
  const problems = [];
  questions.forEach((q, i) => {
    const { errors, value } = checkQuestion(q);
    if (errors.length) problems.push({ index: i, errors });
    else list.push(value);
  });
  if (problems.length) throw new ApiError(400, `${problems.length} ta savolda xato bor.`, { problems });
  const added = await T.bulkAddQuestions(t.id, list);
  return { added };
}

async function updateQuestion(c) {
  const q = await T.getQuestion(int(c.params.id, 0));
  if (!q) throw new ApiError(404, 'Savol topilmadi.');
  const v = validateQuestion(await c.body(100_000));
  await T.updateQuestion(q.id, v);
  return { ok: true };
}

async function deleteQuestion(c) {
  const q = await T.getQuestion(int(c.params.id, 0));
  if (!q) throw new ApiError(404, 'Savol topilmadi.');
  await T.deleteQuestion(q.id);
  return { ok: true };
}

// ---------------- Rasmlar ----------------

const MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function upload(c) {
  const type = (c.req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!MIMES[type]) throw new ApiError(400, 'Faqat JPG, PNG yoki WEBP rasm yuklash mumkin.');
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!buf.length) throw new ApiError(400, 'Fayl bo\'sh.');
  if (buf.length > 5 * 1024 * 1024) throw new ApiError(413, 'Rasm 5 MB dan oshmasin.');
  const chat = cfg.storageChatId || c.uid;
  let up;
  try {
    up = await tg.uploadPhoto(chat, buf, type, `image.${MIMES[type]}`);
  } catch (e) {
    throw new ApiError(502, `Rasmni Telegramga yuklab bo'lmadi: ${e.description || e.message}. Botga avval /start yuborganingizga ishonch hosil qiling.`);
  }
  await exec('INSERT OR IGNORE INTO images(file_id, created_at) VALUES(?,?)', [up.file_id, now()]);
  return { file_id: up.file_id };
}

async function image(c) {
  const id = c.params.id;
  if (!/^[A-Za-z0-9_-]{20,300}$/.test(id)) throw new ApiError(404, 'Topilmadi.');
  const ok = await one('SELECT 1 AS ok FROM images WHERE file_id=?', [id]);
  if (!ok) throw new ApiError(404, 'Topilmadi.');
  let f;
  try {
    f = await tg.downloadFile(id);
  } catch {
    throw new ApiError(404, 'Rasm topilmadi.');
  }
  return new Response(f.buffer, {
    headers: { 'content-type': f.type || 'image/jpeg', 'cache-control': 'public, max-age=86400, immutable' },
  });
}

// ---------------- Natijalar ----------------

async function attemptsList(c) {
  const t = await requireTest(c.params.id);
  const limit = int(c.query.limit, 50, 1, 200);
  const offset = int(c.query.offset, 0, 0);
  const kind = c.query.kind === 'all' ? '' : `AND a.kind='normal'`;
  const [rows, total] = await Promise.all([
    all(
      `SELECT a.id, a.user_id, a.kind, a.status, a.correct_count, a.total, a.score_percent, a.started_at, a.finished_at,
              u.first_name, u.last_name, u.username, u.display_name
         FROM attempts a JOIN users u ON u.id=a.user_id
        WHERE a.test_id=? AND a.is_preview=0 AND a.status IN ('finished','expired') ${kind}
        ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [t.id, limit, offset],
    ),
    one(`SELECT COUNT(*) AS c FROM attempts a WHERE a.test_id=? AND a.is_preview=0 AND a.status IN ('finished','expired') ${kind}`, [t.id]),
  ]);
  return {
    total: total.c,
    attempts: rows.map((r) => ({
      id: r.id, user_id: r.user_id, user: userLabel(r), username: r.username, kind: r.kind, status: r.status,
      correct: r.correct_count, total: r.total, percent: r.score_percent, started_at: r.started_at, finished_at: r.finished_at,
      duration: r.finished_at ? r.finished_at - r.started_at : null,
    })),
  };
}

async function attemptDetail(c) {
  const a = await A.getAttempt(int(c.params.id, 0));
  if (!a) throw new ApiError(404, 'Urinish topilmadi.');
  const [user, rows] = await Promise.all([
    getUser(a.user_id),
    all('SELECT idx, question_id, snapshot, chosen, is_correct, answered_at FROM attempt_questions WHERE attempt_id=? ORDER BY idx', [a.id]),
  ]);
  return {
    attempt: {
      id: a.id, test_id: a.test_id, test_title: a.test_title, kind: a.kind, status: a.status, is_preview: !!a.is_preview,
      correct: a.correct_count, total: a.total, percent: a.score_percent, started_at: a.started_at, finished_at: a.finished_at,
    },
    user: user ? pubUser(user) : null,
    items: rows.map((r) => {
      const s = JSON.parse(r.snapshot);
      return {
        idx: r.idx, question_id: r.question_id, text: s.t, image_file_id: s.img, options: s.o, correct: s.c,
        explanation: s.e, chosen: r.chosen, is_correct: r.is_correct === null ? null : !!r.is_correct, answered_at: r.answered_at,
      };
    }),
  };
}

async function leaderboard(c) {
  const t = await requireTest(c.params.id);
  const rows = await A.leaderboard(t.id, 200);
  return {
    rows: rows.map((r, i) => ({
      rank: i + 1, user_id: r.user_id, user: userLabel(r), username: r.username,
      correct: r.correct_count, total: r.total, percent: r.score_percent, duration: r.dur,
    })),
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportCsv(c) {
  const t = await requireTest(c.params.id);
  const rows = await all(
    `SELECT a.id, a.user_id, a.status, a.correct_count, a.total, a.score_percent, a.started_at, a.finished_at,
            u.first_name, u.last_name, u.username, u.display_name
       FROM attempts a JOIN users u ON u.id=a.user_id
      WHERE a.test_id=? AND a.kind='normal' AND a.is_preview=0 AND a.status IN ('finished','expired') ORDER BY a.id`,
    [t.id],
  );
  const head = ['№', 'Ism', 'Username', 'Telegram ID', 'To\'g\'ri', 'Jami', 'Foiz', 'Holat', 'Boshlangan', 'Tugagan', 'Davomiyligi (s)'];
  const lines = [head.map(csvCell).join(';')];
  rows.forEach((r, i) => {
    lines.push(
      [i + 1, userLabel(r), r.username ? '@' + r.username : '', r.user_id, r.correct_count, r.total, r.score_percent, r.status === 'expired' ? 'vaqt tugadi' : 'yakunlangan', fmtDate(r.started_at), fmtDate(r.finished_at), (r.finished_at || 0) - r.started_at]
        .map(csvCell)
        .join(';'),
    );
  });
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="natijalar-test-${t.id}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

// ---------------- Foydalanuvchilar ----------------

async function usersList(c) {
  const q = String(c.query.q || '').trim().toLowerCase();
  const limit = int(c.query.limit, 50, 1, 200);
  const offset = int(c.query.offset, 0, 0);
  const like = `%${q}%`;
  const where = q
    ? `WHERE lower(coalesce(u.first_name,'')||' '||coalesce(u.last_name,'')||' '||coalesce(u.display_name,'')||' '||coalesce(u.username,'')) LIKE ? OR CAST(u.id AS TEXT) LIKE ?`
    : '';
  const args = q ? [like, like] : [];
  const [rows, total] = await Promise.all([
    all(
      `SELECT u.*,
          (SELECT COUNT(*) FROM attempts a WHERE a.user_id=u.id AND ${VALID}) AS attempts,
          (SELECT ROUND(AVG(a.score_percent),1) FROM attempts a WHERE a.user_id=u.id AND ${VALID}) AS avg_percent
         FROM users u ${where} ORDER BY u.last_seen_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    ),
    one(`SELECT COUNT(*) AS c FROM users u ${where}`, args),
  ]);
  return { total: total.c, users: rows.map((r) => ({ ...pubUser(r), attempts: r.attempts, avg_percent: r.avg_percent })) };
}

async function userDetail(c) {
  const u = await getUser(int(c.params.id, 0));
  if (!u) throw new ApiError(404, 'Foydalanuvchi topilmadi.');
  const [st, recent] = await Promise.all([
    userStats(u.id),
    all(
      `SELECT a.id, a.test_id, a.kind, a.status, a.correct_count, a.total, a.score_percent, a.finished_at, t.title AS test_title
         FROM attempts a LEFT JOIN tests t ON t.id=a.test_id
        WHERE a.user_id=? AND a.is_preview=0 AND a.status IN ('finished','expired') ORDER BY a.id DESC LIMIT 30`,
      [u.id],
    ),
  ]);
  return {
    user: pubUser(u),
    stats: st,
    attempts: recent.map((r) => ({ id: r.id, test_id: r.test_id, test_title: r.test_title, kind: r.kind, correct: r.correct_count, total: r.total, percent: r.score_percent, finished_at: r.finished_at })),
  };
}

async function banUser(c) {
  const u = await getUser(int(c.params.id, 0));
  if (!u) throw new ApiError(404, 'Foydalanuvchi topilmadi.');
  if (isAdmin(u.id)) throw new ApiError(400, 'Adminni bloklab bo\'lmaydi.');
  const { banned } = await c.body(1000);
  await setBanned(u.id, !!banned);
  return { ok: true };
}

async function renameUser(c) {
  const u = await getUser(int(c.params.id, 0));
  if (!u) throw new ApiError(404, 'Foydalanuvchi topilmadi.');
  const { name } = await c.body(1000);
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  await exec('UPDATE users SET display_name=? WHERE id=?', [n || null, u.id]);
  return { ok: true };
}

// ---------------- E'lon (broadcast) ----------------

async function broadcast(c) {
  const { text, after = 0, test = false } = await c.body(20_000);
  const msg = String(text || '').trim();
  if (!msg) throw new ApiError(400, 'Xabar matnini kiriting.');
  if (msg.length > 3500) throw new ApiError(400, 'Xabar 3500 belgidan oshmasin.');
  const body = `📢 ${esc(msg)}`;

  if (test) {
    await tg.sendMessage(c.uid, body);
    return { sent: 1, failed: 0, done: true, next_after: 0, remaining: 0 };
  }
  const BATCH = 20;
  const users = await allUserIds(Number(after) || 0, BATCH);
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      await tg.sendMessage(u.id, body);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof tg.TgError && e.blocked) await markBlocked(u.id, true);
    }
    await sleep(45); // ~22 xabar/soniya — Telegram chegarasidan past
  }
  const next = users.length ? users[users.length - 1].id : Number(after) || 0;
  const rem = await one('SELECT COUNT(*) AS c FROM users WHERE id>? AND is_blocked=0 AND is_banned=0', [next]);
  return { sent, failed, next_after: next, remaining: rem.c, done: users.length < BATCH || rem.c === 0 };
}

async function broadcastCount() {
  const r = await one('SELECT COUNT(*) AS c FROM users WHERE is_blocked=0 AND is_banned=0');
  return { recipients: r.c };
}

// ---------------- Sozlamalar / me ----------------

async function me(c) {
  const [username, user] = await Promise.all([botUsername(), getUser(c.uid)]);
  return { id: c.uid, name: user ? userLabel(user) : 'Admin', bot_username: username, tz_offset: cfg.tzOffsetHours };
}

async function getSettings() {
  const [welcome_text, help_text] = await Promise.all([getSetting('welcome_text'), getSetting('help_text')]);
  return { welcome_text, help_text };
}

async function putSettings(c) {
  const b = await c.body(20_000);
  for (const k of ['welcome_text', 'help_text']) {
    if (b[k] !== undefined) {
      const v = String(b[k]).trim();
      if (v.length > 1000) throw new ApiError(400, 'Matn 1000 belgidan oshmasin.');
      await setSetting(k, v);
    }
  }
  return { ok: true };
}

// ---------------- Marshrutlar ----------------

export const handleApi = createRouter([
  ['POST', '/api/auth/token', authToken, { public: true }],
  ['POST', '/api/auth/webapp', authWebApp, { public: true }],
  ['GET', '/api/img/:id', image, { public: true }],

  ['POST', '/api/admin/import/parse', importParse],
  ['POST', '/api/admin/import/commit', importCommit],
  ['GET', '/api/admin/me', me],
  ['GET', '/api/admin/stats', stats],
  ['GET', '/api/admin/tests', listTests],
  ['POST', '/api/admin/tests', createTest],
  ['GET', '/api/admin/tests/:id', getTestDetail],
  ['PUT', '/api/admin/tests/:id', updateTest],
  ['DELETE', '/api/admin/tests/:id', deleteTest],
  ['POST', '/api/admin/tests/:id/duplicate', duplicateTest],
  ['POST', '/api/admin/tests/:id/reorder', reorder],
  ['POST', '/api/admin/tests/:id/questions', addQuestion],
  ['POST', '/api/admin/tests/:id/questions/bulk', bulkQuestions],
  ['GET', '/api/admin/tests/:id/attempts', attemptsList],
  ['GET', '/api/admin/tests/:id/leaderboard', leaderboard],
  ['GET', '/api/admin/tests/:id/export', exportCsv],
  ['PUT', '/api/admin/questions/:id', updateQuestion],
  ['DELETE', '/api/admin/questions/:id', deleteQuestion],
  ['POST', '/api/admin/upload', upload],
  ['GET', '/api/admin/attempts/:id', attemptDetail],
  ['GET', '/api/admin/users', usersList],
  ['GET', '/api/admin/users/:id', userDetail],
  ['POST', '/api/admin/users/:id/ban', banUser],
  ['POST', '/api/admin/users/:id/rename', renameUser],
  ['GET', '/api/admin/broadcast/count', broadcastCount],
  ['POST', '/api/admin/broadcast', broadcast],
  ['GET', '/api/admin/settings', getSettings],
  ['PUT', '/api/admin/settings', putSettings],
]);
