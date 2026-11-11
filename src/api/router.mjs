// Kichik, bog'liqliksiz router.
import { adminFromRequest } from '../lib/auth.mjs';
import { ensureSchema } from '../lib/schema.mjs';
import { ApiError, json } from '../lib/util.mjs';

function compile(pattern) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === ':' ? m : '\\' + m)).replace(/:([A-Za-z_]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$',
  );
  return { re, keys };
}

export function createRouter(routes) {
  const table = routes.map(([method, pattern, handler, opts = {}]) => ({ method, ...compile(pattern), handler, opts }));

  return async function route(req, { origin } = {}) {
    const url = new URL(req.url);
    try {
      const path = decodeURIComponent(url.pathname);
      let pathMatched = false;
      for (const r of table) {
        const m = r.re.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = m[i + 1]));
        await ensureSchema();
        const c = {
          req,
          url,
          params,
          query: Object.fromEntries(url.searchParams),
          origin: origin || url.origin,
          uid: null,
          async body(max = 2_000_000) {
            const text = await req.text();
            if (text.length > max) throw new ApiError(413, 'So\'rov juda katta.');
            try {
              return text ? JSON.parse(text) : {};
            } catch {
              throw new ApiError(400, 'JSON noto\'g\'ri.');
            }
          },
        };
        if (!r.opts.public) c.uid = adminFromRequest(req);
        const out = await r.handler(c);
        return out instanceof Response ? out : json(out ?? { ok: true });
      }
      if (pathMatched) throw new ApiError(405, 'Metod ruxsat etilmagan.');
      throw new ApiError(404, 'Topilmadi.');
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message, ...e.extra }, e.status);
      console.error('[api] xato:', req.method, url.pathname, e?.stack || e);
      return json({ error: 'Serverda xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.' }, 500);
    }
  };
}
