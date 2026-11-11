// Lokal ishlab chiqish serveri: SQLite + soxta Telegram + statik panel.
//   node dev/server.mjs            -> http://localhost:8787
// Brauzerda kirish: /dev/login (avtomatik token beradi)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BOT_TOKEN ||= '123456:DEV-TOKEN';
process.env.ADMIN_IDS ||= '1001';
process.env.SETUP_KEY ||= 'dev';
process.env.TURSO_DATABASE_URL ||= 'libsql://dev.local';
process.env.TURSO_AUTH_TOKEN ||= 'dev';

const { useSqlite, mockTelegram } = await import('../tests/helpers.mjs');
const { handleApi } = await import('../src/api/admin.mjs');
const { signSession } = await import('../src/lib/auth.mjs');
const { ensureSchema } = await import('../src/lib/schema.mjs');
const bot = (await import('../netlify/functions/bot.mjs')).default;
const setup = (await import('../netlify/functions/setup.mjs')).default;

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const dbFile = process.env.DEV_DB || ':memory:';
useSqlite(dbFile);
const tg = mockTelegram();
await ensureSchema();
if (process.env.SEED !== '0') (await import('./seed.mjs')).seed();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const toRequest = () => new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const send = async (r) => {
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    };
    if (url.pathname === '/dev/token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ session: signSession(1001) }));
    }
    if (url.pathname === '/dev/login') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<script>localStorage.setItem('qb_session','${signSession(1001)}');location.href='/'</script>`);
    }
    if (url.pathname === '/dev/outbox') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(tg.calls.slice(-50)));
    }
    if (url.pathname === '/api/bot') return send(await bot(toRequest()));
    if (url.pathname === '/api/setup') return send(await setup(toRequest()));
    if (url.pathname.startsWith('/api/')) return send(await handleApi(toRequest()));
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    try {
      const data = await readFile(join(root, p));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      const data = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(data);
    }
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('dev server error');
  }
});

const PORT = Number(process.env.PORT || 8787);
server.listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}  (kirish: /dev/login)`));
