// Ma'lumotlar bazasi qatlami.
// Ishlab chiqarishda Turso (libSQL) HTTP API'si ishlatiladi (hech qanday npm paket kerak emas).
// Testlarda setDriver() orqali lokal SQLite ulanadi.
import { cfg } from './env.mjs';

let driver = null;

export function setDriver(d) {
  driver = d;
}

export class DbError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** JS qiymatni Turso typed-value ko'rinishiga o'tkazadi. */
function encodeArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { type: 'null' };
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
}

function decodeValue(c) {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer') return Number(c.value);
  if (c.type === 'float') return Number(c.value);
  return c.value; // text, blob(base64)
}

function decodeResult(r) {
  const cols = (r.cols || []).map((c) => c.name);
  const rows = (r.rows || []).map((row) => {
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = decodeValue(row[i]);
    return o;
  });
  return {
    rows,
    rowsAffected: Number(r.affected_row_count || 0),
    lastInsertId: r.last_insert_rowid == null ? null : Number(r.last_insert_rowid),
  };
}

const tursoDriver = {
  async run(stmts) {
    const url = cfg.tursoUrl;
    const token = cfg.tursoToken;
    if (!url || !token) throw new DbError('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN sozlanmagan');
    const body = {
      requests: [
        ...stmts.map((s) => ({
          type: 'execute',
          stmt: { sql: s.sql, args: (s.args || []).map(encodeArg) },
        })),
        { type: 'close' },
      ],
    };
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url + '/v2/pipeline', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status >= 500 || res.status === 429) {
          lastErr = new DbError('Turso HTTP ' + res.status);
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          throw new DbError('Turso xatosi: ' + (data?.error || res.status));
        }
        const out = [];
        for (let i = 0; i < stmts.length; i++) {
          const item = data.results?.[i];
          if (!item || item.type === 'error') {
            throw new DbError(item?.error?.message || 'Noma\'lum SQL xatosi', item?.error?.code);
          }
          out.push(decodeResult(item.response.result));
        }
        return out;
      } catch (e) {
        if (e instanceof DbError) throw e;
        lastErr = e; // tarmoq xatosi — qayta urinib ko'ramiz
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    throw new DbError('Bazaga ulanib bo\'lmadi: ' + (lastErr?.message || lastErr));
  },
};

function getDriver() {
  return driver || tursoDriver;
}

/** Bitta so'rov. Natija: { rows:[{...}], rowsAffected, lastInsertId } */
export async function exec(sql, args = []) {
  const [r] = await getDriver().run([{ sql, args }]);
  return r;
}

/** Bir nechta so'rov bitta HTTP chaqiruvda ketma-ket bajariladi (tranzaksiyasiz). */
export async function batch(stmts) {
  if (!stmts.length) return [];
  return getDriver().run(stmts);
}

export async function all(sql, args = []) {
  return (await exec(sql, args)).rows;
}

export async function one(sql, args = []) {
  return (await exec(sql, args)).rows[0] || null;
}

export const isUniqueViolation = (e) => /UNIQUE constraint|constraint failed/i.test(String(e?.message || ''));
