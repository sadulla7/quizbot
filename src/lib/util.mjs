import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cfg } from './env.mjs';

export const now = () => Math.floor(Date.now() / 1000);

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const clip = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
};

export const letter = (i) => String.fromCharCode(65 + i);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (key, data) => createHmac('sha256', key).update(data).digest('hex');
export const randToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseJSON(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sana-vaqt: "11.11.2026 03:57" (TZ_OFFSET_HOURS, standart UTC+5). */
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date((Number(ts) + cfg.tzOffsetHours * 3600) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h} soat ${m} daq`;
  if (m) return s ? `${m} daq ${s} s` : `${m} daq`;
  return `${s} s`;
}

export function fmtPercent(p) {
  p = Number(p) || 0;
  return Number.isInteger(p) ? String(p) : p.toFixed(1).replace(/\.0$/, '');
}

export function userLabel(u) {
  if (!u) return 'Noma\'lum';
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return (u.display_name || full || (u.username ? '@' + u.username : '') || 'ID ' + u.id).trim();
}

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/** Qisqa, o'zgarmas kalit (kategoriya nomi uchun callback_data). */
export const shortKey = (s) => (s ? createHash('sha1').update(String(s)).digest('hex').slice(0, 8) : 'x');
