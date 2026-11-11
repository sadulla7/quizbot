// Telegram webhook: POST /api/bot
import { handleUpdate } from '../../src/bot/index.mjs';
import { webhookSecret } from '../../src/lib/env.mjs';
import { safeEq } from '../../src/lib/util.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Quiz bot ishlayapti ✅', { status: 200 });

  const secret = req.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!safeEq(secret, webhookSecret())) return new Response('forbidden', { status: 403 });

  let update;
  try {
    update = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    await handleUpdate(update, { origin: new URL(req.url).origin });
  } catch (e) {
    // Faqat infratuzilma xatolari bu yerga yetib keladi (baza ishlamay qolgan va h.k.) — Telegram keyinroq qayta yuboradi.
    console.error('[webhook] xato:', e?.stack || e);
    return new Response('retry', { status: 500 });
  }
  return new Response('OK');
};

export const config = { path: '/api/bot' };
