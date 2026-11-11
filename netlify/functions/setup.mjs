// Bir martalik o'rnatish sahifasi: /api/setup?key=SETUP_KEY
import { checkSetupKey, renderSetupHtml, runSetup } from '../../src/api/setup.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  const page = (t) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h2>🔐 Bot o'rnatish</h2><p>${t}</p>`;

  const auth = checkSetupKey(key);
  if (!auth.ok) {
    return html(page(`${auth.reason}<br><br>Manzil: <code>/api/setup?key=SIZNING_SETUP_KEY</code>`), 403);
  }
  const result = await runSetup(url.origin);
  if (url.searchParams.get('format') === 'json') {
    return new Response(JSON.stringify(result, null, 2), { status: result.ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
  }
  return html(renderSetupHtml(result, { key }), result.ok ? 200 : 500);
};

export const config = { path: '/api/setup' };
