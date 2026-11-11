// Bir martalik o'rnatish: baza sxemasi, webhook, buyruqlar menyusi, admin tugmasi.
import * as tg from '../lib/tg.mjs';
import { cfg, missingEnv, webhookSecret } from '../lib/env.mjs';
import { ensureSchema } from '../lib/schema.mjs';
import { safeEq } from '../lib/util.mjs';
import { setSetting } from '../services/settings.mjs';

const USER_COMMANDS = [
  { command: 'start', description: 'Bosh menyu' },
  { command: 'tests', description: 'Testlar ro\'yxati' },
  { command: 'history', description: 'Natijalarim' },
  { command: 'profile', description: 'Profil va statistika' },
  { command: 'help', description: 'Yordam' },
  { command: 'cancel', description: 'Joriy amalni bekor qilish' },
];

export function checkSetupKey(key) {
  if (!cfg.setupKey) return { ok: false, reason: 'SETUP_KEY o\'zgaruvchisi Netlify\'da kiritilmagan.' };
  if (!key || !safeEq(key, cfg.setupKey)) return { ok: false, reason: 'Kalit noto\'g\'ri.' };
  return { ok: true };
}

export async function runSetup(origin) {
  const steps = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail ?? '' });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, detail: e?.description || e?.message || String(e) });
      return false;
    }
  };

  const miss = missingEnv();
  steps.push({
    name: 'Muhit o\'zgaruvchilari',
    ok: miss.length === 0,
    detail: miss.length ? `Yetishmayapti: ${miss.join(', ')}` : 'BOT_TOKEN, ADMIN_IDS, TURSO_* — hammasi kiritilgan',
  });
  if (miss.length) return { ok: false, steps };

  if (!(await step('Baza (jadvallar yaratildi)', async () => `schema v${await ensureSchema()}`))) return { ok: false, steps };

  let username = '';
  if (!(await step('Bot tokeni tekshirildi', async () => {
    const me = await tg.call('getMe');
    username = me.username;
    await setSetting('bot_username', username);
    return `@${username}`;
  }))) return { ok: false, steps };

  const base = cfg.siteUrl || origin;
  await step('Sayt manzili saqlandi', async () => {
    await setSetting('site_url', base);
    return base;
  });

  await step('Webhook o\'rnatildi', async () => {
    await tg.call('setWebhook', {
      url: `${base}/api/bot`,
      secret_token: webhookSecret(),
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      max_connections: 20,
    });
    return `${base}/api/bot`;
  });

  await step('Buyruqlar menyusi', async () => {
    await tg.call('setMyCommands', { commands: USER_COMMANDS });
    for (const id of cfg.adminIds) {
      await tg.tryCall('setMyCommands', {
        commands: [...USER_COMMANDS, { command: 'panel', description: '🖥 Admin panel' }],
        scope: { type: 'chat', chat_id: id },
      });
    }
    return `${USER_COMMANDS.length} ta buyruq (adminlar uchun +/panel)`;
  });

  if (base.startsWith('https://')) {
    await step('Adminlar uchun "Panel" tugmasi', async () => {
      let n = 0;
      for (const id of cfg.adminIds) {
        const r = await tg.tryCall('setChatMenuButton', {
          chat_id: id,
          menu_button: { type: 'web_app', text: '🖥 Panel', web_app: { url: `${base}/` } },
        });
        if (r) n++;
      }
      return `${n}/${cfg.adminIds.length} admin (admin botga /start yuborgan bo'lishi kerak)`;
    });
  }

  await step('Webhook holati', async () => {
    const info = await tg.call('getWebhookInfo');
    return `kutilayotgan: ${info.pending_update_count || 0}${info.last_error_message ? `, oxirgi xato: ${info.last_error_message}` : ''}`;
  });

  return { ok: steps.every((s) => s.ok), steps, username, panel: `${base}/` };
}

export function renderSetupHtml(result, { key }) {
  const rows = result.steps
    .map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><b>${s.ok ? '✅' : '❌'} ${esc(s.name)}</b><span>${esc(s.detail)}</span></li>`)
    .join('');
  const next = result.ok
    ? `<div class="done"><h2>🎉 Hammasi tayyor!</h2><p>Endi Telegramda <b>@${esc(result.username)}</b> botiga o'tib <code>/start</code> yuboring, so'ng admin sifatida <code>/panel</code> buyrug'ini yuboring.</p></div>`
    : `<div class="fail"><h2>Bajarilmadi</h2><p>Yuqoridagi ❌ qatorni tuzating va bu sahifani yangilang (<a href="?key=${encodeURIComponent(key)}">qayta ishga tushirish</a>).</p></div>`;
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot o'rnatish</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f6fb;color:#1b2333}
main{max-width:720px;margin:0 auto;padding:24px 16px}
h1{font-size:22px} ul{list-style:none;padding:0;margin:16px 0}
li{background:#fff;border-radius:12px;padding:12px 14px;margin:8px 0;box-shadow:0 1px 3px #0001;display:flex;flex-direction:column;gap:2px}
li span{color:#5b667a;font-size:14px;word-break:break-all} li.bad{outline:2px solid #e5484d}
.done,.fail{background:#fff;border-radius:12px;padding:6px 16px;box-shadow:0 1px 3px #0001}.done{border-left:5px solid #30a46c}.fail{border-left:5px solid #e5484d}
code{background:#eef1f7;padding:1px 6px;border-radius:6px}
@media (prefers-color-scheme:dark){body{background:#0f141d;color:#e6eaf2}li,.done,.fail{background:#182030}li span{color:#9aa6bd}code{background:#243049}}
</style></head><body><main><h1>🤖 Bot o'rnatish natijasi</h1><ul>${rows}</ul>${next}</main></body></html>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
