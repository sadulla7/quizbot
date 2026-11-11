import { all, exec } from '../lib/db.mjs';

const cache = new Map(); // key -> {v, t}
const TTL = 30_000;

export const DEFAULTS = {
  welcome_text: '',
  help_text: '',
  site_url: '',
  bot_username: '',
};

export async function getSetting(key) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return c.v;
  const rows = await all('SELECT value FROM settings WHERE key=?', [key]);
  const v = rows[0] ? rows[0].value : DEFAULTS[key] ?? '';
  cache.set(key, { v, t: Date.now() });
  return v;
}

export async function setSetting(key, value) {
  await exec(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, String(value ?? '')],
  );
  cache.set(key, { v: String(value ?? ''), t: Date.now() });
}

export function clearSettingsCache() {
  cache.clear();
}
