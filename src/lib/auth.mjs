// Admin panel autentifikatsiyasi:
//  1) botdagi /panel buyrug'i bergan bir martalik havola (magic link)
//  2) Telegram Mini App (initData imzosi tekshiriladi)
// Har ikkalasi ham imzolangan sessiya tokeni beradi (Bearer).
import { createHmac } from 'node:crypto';
import { cfg, derive, isAdmin } from './env.mjs';
import { exec } from './db.mjs';
import { ApiError, now, randToken, safeEq, sha256 } from './util.mjs';

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

export function signSession(uid, ttlSec = 14 * 86400) {
  const payload = b64(JSON.stringify({ u: Number(uid), exp: now() + ttlSec }));
  const sig = createHmac('sha256', derive('session')).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = createHmac('sha256', derive('session')).update(payload).digest('base64url');
  if (!safeEq(sig, expect)) return null;
  try {
    const { u, exp } = JSON.parse(unb64(payload));
    if (!u || !exp || exp < now()) return null;
    return Number(u);
  } catch {
    return null;
  }
}

/** Telegram Mini App initData ni tekshiradi. Muvaffaqiyatda user obyektini qaytaradi. */
export function verifyInitData(initData, maxAgeSec = 86400) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(cfg.botToken).digest();
  const calc = createHmac('sha256', secretKey).update(dcs).digest('hex');
  if (!safeEq(calc, hash)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now() - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

export async function createLoginToken(uid, ttlSec = 600) {
  const raw = randToken(24);
  await exec('INSERT INTO login_tokens(hash, user_id, expires_at) VALUES(?,?,?)', [sha256(raw), uid, now() + ttlSec]);
  return raw;
}

/** Bir martalik tokenni "yeydi". Muvaffaqiyatda user_id qaytaradi. */
export async function consumeLoginToken(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 200) return null;
  const r = await exec(
    'UPDATE login_tokens SET used=1 WHERE hash=? AND used=0 AND expires_at>? RETURNING user_id',
    [sha256(raw), now()],
  );
  return r.rows[0]?.user_id ?? null;
}

/** So'rovdan adminni aniqlaydi, aks holda 401/403 beradi. */
export function adminFromRequest(req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const uid = verifySession(m?.[1]);
  if (!uid) throw new ApiError(401, 'Sessiya yaroqsiz yoki muddati tugagan. Qaytadan kiring.');
  if (!isAdmin(uid)) throw new ApiError(403, 'Siz admin emassiz.');
  return uid;
}
