// Muhit o'zgaruvchilari va undan hosil qilinadigan sirlar.
import { createHmac } from 'node:crypto';

const g = (k, d = '') => {
  const v = process.env[k];
  return v === undefined || String(v).trim() === '' ? d : String(v).trim();
};

export const cfg = {
  get botToken() { return g('BOT_TOKEN'); },
  get adminIds() {
    return g('ADMIN_IDS')
      .split(/[,\s;]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
  },
  get tursoUrl() { return g('TURSO_DATABASE_URL').replace(/^libsql:\/\//, 'https://').replace(/\/+$/, ''); },
  get tursoToken() { return g('TURSO_AUTH_TOKEN'); },
  get setupKey() { return g('SETUP_KEY'); },
  get storageChatId() { return g('STORAGE_CHAT_ID'); },
  get siteUrl() { return g('SITE_URL').replace(/\/+$/, ''); },
  get tzOffsetHours() {
    const n = Number(g('TZ_OFFSET_HOURS', '5'));
    return Number.isFinite(n) ? n : 5;
  },
};

export function isAdmin(id) {
  return cfg.adminIds.includes(Number(id));
}

/** Bot tokenidan (va ixtiyoriy SESSION_SECRET dan) deterministik sir hosil qiladi. */
export function derive(label) {
  return createHmac('sha256', cfg.botToken + '|' + g('SESSION_SECRET'))
    .update('quizbot:' + label)
    .digest('hex');
}

/** Telegram webhook uchun secret_token (A-Z a-z 0-9 _ - ruxsat etilgan). */
export function webhookSecret() {
  return derive('webhook').slice(0, 64);
}

export function missingEnv() {
  const miss = [];
  if (!cfg.botToken) miss.push('BOT_TOKEN');
  if (!cfg.adminIds.length) miss.push('ADMIN_IDS');
  if (!cfg.tursoUrl) miss.push('TURSO_DATABASE_URL');
  if (!cfg.tursoToken) miss.push('TURSO_AUTH_TOKEN');
  return miss;
}
