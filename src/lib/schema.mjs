// Baza sxemasi. Birinchi so'rovda avtomatik yaratiladi — qo'lda SQL yurgizish shart emas.
import { exec, all } from './db.mjs';

// Har bir element — bitta migratsiya (SQL buyruqlar ro'yxati). Yangi o'zgarish kerak bo'lsa oxiriga qo'shing.
export const MIGRATIONS = [
  [
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      display_name TEXT,
      lang TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      state TEXT,
      state_data TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 0,
      is_listed INTEGER NOT NULL DEFAULT 1,
      instant_feedback INTEGER NOT NULL DEFAULT 1,
      time_limit_min INTEGER NOT NULL DEFAULT 0,
      questions_per_attempt INTEGER NOT NULL DEFAULT 0,
      shuffle_questions INTEGER NOT NULL DEFAULT 1,
      shuffle_options INTEGER NOT NULL DEFAULT 1,
      max_attempts INTEGER NOT NULL DEFAULT 0,
      pass_percent INTEGER NOT NULL DEFAULT 60,
      show_leaderboard INTEGER NOT NULL DEFAULT 1,
      notify_admins INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      image_file_id TEXT,
      options TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      keep_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS ix_questions_test ON questions(test_id, deleted_at, position)`,
    `CREATE TABLE IF NOT EXISTS images (
      file_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      test_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'normal',
      parent_id INTEGER,
      status TEXT NOT NULL,
      is_preview INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      correct_count INTEGER NOT NULL DEFAULT 0,
      score_percent REAL,
      instant_feedback INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER NOT NULL,
      deadline INTEGER,
      finished_at INTEGER,
      chat_id INTEGER,
      message_id INTEGER,
      aux_message_id INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS ix_attempts_user ON attempts(user_id, id)`,
    `CREATE INDEX IF NOT EXISTS ix_attempts_test ON attempts(test_id, status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_attempt_active ON attempts(user_id) WHERE status IN ('preparing','active')`,
    `CREATE TABLE IF NOT EXISTS attempt_questions (
      attempt_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      chosen INTEGER,
      chosen_orig INTEGER,
      is_correct INTEGER,
      answered_at INTEGER,
      PRIMARY KEY (attempt_id, idx)
    )`,
    `CREATE INDEX IF NOT EXISTS ix_aq_question ON attempt_questions(question_id)`,
    `CREATE TABLE IF NOT EXISTS processed_updates (
      update_id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS login_tokens (
      hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )`,
  ],
];

let ready = null;

async function currentVersion() {
  try {
    const rows = await all(`SELECT value FROM settings WHERE key='schema_version'`);
    return rows[0] ? Number(rows[0].value) : 0;
  } catch {
    return 0; // jadval hali yo'q
  }
}

async function migrate() {
  let v = await currentVersion();
  while (v < MIGRATIONS.length) {
    for (const sql of MIGRATIONS[v]) {
      try {
        await exec(sql);
      } catch (e) {
        // parallel sovuq ishga tushishlarda "already exists" / "duplicate column" xatolari zararsiz
        if (!/already exists|duplicate column/i.test(String(e?.message))) throw e;
      }
    }
    v++;
    await exec(
      `INSERT INTO settings(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [String(v)],
    );
  }
  return v;
}

/** Bir instansiyada faqat bir marta tekshiradi. */
export function ensureSchema() {
  if (!ready) {
    ready = migrate().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export function resetSchemaCache() {
  ready = null;
}
