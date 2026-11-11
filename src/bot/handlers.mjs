// Foydalanuvchi oqimi: buyruqlar, tugmalar, test jarayoni.
import * as tg from '../lib/tg.mjs';
import { cfg, isAdmin } from '../lib/env.mjs';
import { exec, one } from '../lib/db.mjs';
import { createLoginToken } from '../lib/auth.mjs';
import { esc, fmtPercent, now, shortKey, userLabel } from '../lib/util.mjs';
import { getSetting } from '../services/settings.mjs';
import { getUser, markBlocked, setDisplayName, setState, userStats } from '../services/users.mjs';
import { getTest, getTestWithCount, listPublishedForBot } from '../services/tests.mjs';
import * as A from '../services/attempts.mjs';
import { show, update } from './screen.mjs';
import * as ui from './ui.mjs';
import { MAX_UPLOAD, commitImport, parseUpload } from '../services/importer.mjs';

// ---------- Yordamchilar ----------

async function siteBase(ctx) {
  return cfg.siteUrl || (await getSetting('site_url')) || ctx.origin || '';
}

/** Callback'ga bir marta javob beradi (tugma "aylanib qolmasligi" uchun). */
function makeAck(ctx) {
  let done = false;
  ctx.ack = (text, alert = false) => {
    if (done || !ctx.cbId) return;
    done = true;
    ctx.bg.push(tg.answerCallbackQuery(ctx.cbId, text, alert));
  };
  ctx.finalizeAck = () => ctx.ack();
}

const showHere = (ctx, view, extra = {}) =>
  show({ chatId: ctx.chatId, text: view.text, markup: view.markup, prev: { messageId: ctx.msgId }, ...extra });

export async function notifyAdmins(text) {
  await Promise.allSettled(cfg.adminIds.map((id) => tg.tryCall('sendMessage', { chat_id: id, text, parse_mode: 'HTML' })));
}

/** Urinishga bog'liq ekranni ko'rsatadi va xabar identifikatorlarini saqlaydi. */
async function showForAttempt(ctx, att, { text, markup, photo = null }) {
  if (att.message_id && att.message_id !== ctx.msgId) await tg.deleteMessage(ctx.chatId, att.message_id);
  const r = await show({
    chatId: ctx.chatId,
    text,
    markup,
    photo,
    prev: { messageId: ctx.msgId || undefined, auxId: att.aux_message_id },
  });
  if (r.messageId !== att.message_id || (r.auxId ?? null) !== (att.aux_message_id ?? null)) {
    await A.setMessageIds(att.id, { messageId: r.messageId, auxId: r.auxId, chatId: ctx.chatId });
    att.message_id = r.messageId;
    att.aux_message_id = r.auxId;
  }
  return r;
}

async function ownAttempt(ctx, id) {
  const att = await A.getAttempt(Number(id));
  if (!att || att.user_id !== ctx.user.id) return null;
  return att;
}

// ---------- Asosiy menyu va ro'yxatlar ----------

async function showMenu(ctx) {
  await showHere(ctx, { text: ui.menuText(), markup: ui.menuKb(isAdmin(ctx.user.id)) });
}

async function cmdStart(ctx, payload) {
  const m = /^t_(\d+)$/.exec(payload || '');
  if (m) return openTest(ctx, Number(m[1]));
  const custom = await getSetting('welcome_text');
  await tg.sendMessage(ctx.chatId, ui.welcomeText(ctx.user, custom), { reply_markup: ui.menuKb(isAdmin(ctx.user.id)) });
}

async function showTests(ctx) {
  const tests = await listPublishedForBot();
  if (!tests.length) return showHere(ctx, ui.noTestsView());
  const cats = ui.groupCategories(tests);
  if (cats.length === 1) return showHere(ctx, ui.testsListView(cats[0], 0, false));
  return showHere(ctx, ui.categoriesView(cats));
}

async function showCategory(ctx, key, page) {
  const tests = await listPublishedForBot();
  const cats = ui.groupCategories(tests);
  const cat = cats.find((c) => c.key === key);
  if (!cat) return showTests(ctx);
  return showHere(ctx, ui.testsListView(cat, page, cats.length > 1));
}

async function bestScore(userId, testId) {
  const r = await one(
    `SELECT MAX(score_percent) AS b FROM attempts WHERE user_id=? AND test_id=? AND kind='normal' AND is_preview=0 AND status IN ('finished','expired')`,
    [userId, testId],
  );
  return r?.b ?? null;
}

async function openTest(ctx, testId) {
  const test = await getTestWithCount(testId);
  const admin = isAdmin(ctx.user.id);
  if (!test || (!test.is_published && !admin) || test.question_count === 0) {
    ctx.ack(ui.NOT_FOUND, true);
    if (!ctx.cbId) await tg.sendMessage(ctx.chatId, ui.NOT_FOUND, { reply_markup: ui.menuKb(admin) });
    return;
  }
  const [used, best] = await Promise.all([A.countAttempts(ctx.user.id, testId), bestScore(ctx.user.id, testId)]);
  const isDraft = !test.is_published;
  const limitReached = !isDraft && test.max_attempts > 0 && used >= test.max_attempts;
  const view = {
    text: ui.testCard(test, { used, best, isDraft, limitReached }),
    markup: ui.testCardKb(test, { limitReached, backKey: shortKey(test.category) }),
  };
  await showHere(ctx, view);
}

// ---------- Test jarayoni ----------

async function startTest(ctx, testId) {
  const admin = isAdmin(ctx.user.id);
  const test = await getTestWithCount(testId);
  if (!test || (!test.is_published && !admin)) return ctx.ack(ui.NOT_FOUND, true);
  if (test.question_count === 0) return ctx.ack('Bu testda hali savollar yo\'q.', true);

  const active = await A.getActiveAttempt(ctx.user.id);
  if (active) return showConflict(ctx, active);

  const isDraft = !test.is_published;
  if (!isDraft && test.max_attempts > 0) {
    const used = await A.countAttempts(ctx.user.id, testId);
    if (used >= test.max_attempts) return ctx.ack('Bu test uchun urinishlar soni tugagan.', true);
  }
  const set = await A.pickForTest(test);
  const r = await A.createAttempt({ userId: ctx.user.id, test, set, chatId: ctx.chatId, isPreview: isDraft });
  if (r.conflict) {
    const again = await A.getActiveAttempt(ctx.user.id);
    return again ? showConflict(ctx, again) : ctx.ack('Qayta urinib ko\'ring.', true);
  }
  const att = await A.getAttempt(r.attempt.id);
  await renderQuestion(ctx, att);
}

async function showConflict(ctx, active) {
  const sum = await A.summary(active.id);
  await showHere(ctx, ui.activeConflict(active, sum.answered));
}

/** Joriy (javobsiz) savolni ko'rsatadi; savol qolmagan bo'lsa testni yakunlaydi. */
async function renderQuestion(ctx, att, pend) {
  pend = pend || (await A.pending(att.id));
  if (!pend.length) return finishAndShow(ctx, att, 'finished');
  const cur = pend[0];
  await showForAttempt(ctx, att, {
    text: ui.questionText(att, cur.s, cur.idx),
    markup: ui.questionKb(att, cur.idx, cur.s),
    photo: cur.s.img,
  });
}

async function onAnswer(ctx, aid, idx, choice) {
  const att = await ownAttempt(ctx, aid);
  if (!att) return ctx.ack('Bu urinish topilmadi.', true);
  if (att.status !== 'active') {
    ctx.ack('Bu test allaqachon yakunlangan.');
    if (att.status === 'finished' || att.status === 'expired') return showResultScreen(ctx, att);
    return;
  }
  if (att.deadline && now() > att.deadline + 2) return finishAndShow(ctx, att, 'expired');

  const pend = await A.pending(att.id);
  if (!pend.length) return finishAndShow(ctx, att, 'finished');
  const cur = pend[0];
  if (cur.idx !== idx) {
    ctx.ack('Bu savolga allaqachon javob berilgan.');
    return renderQuestion(ctx, att, pend);
  }
  const r = await A.recordAnswer(att.id, idx, choice, cur.s);
  if (r.status === 'dup') return ctx.ack('Javobingiz qabul qilingan.');
  if (r.status === 'bad') return ctx.ack('Noto\'g\'ri tanlov.', true);

  const next = pend[1];
  if (att.instant_feedback) {
    ctx.ack(r.correct ? '✅ To\'g\'ri!' : '❌ Noto\'g\'ri');
    const msgId = await update({
      chatId: ctx.chatId,
      messageId: ctx.msgId,
      text: ui.feedbackText(att, cur.s, idx, choice),
      markup: ui.feedbackKb(att, idx, !next),
    });
    if (msgId !== att.message_id) await A.setMessageIds(att.id, { messageId: msgId, auxId: att.aux_message_id, chatId: ctx.chatId });
    return;
  }
  ctx.ack();
  if (next) return renderQuestion(ctx, att, [next]);
  return finishAndShow(ctx, att, 'finished');
}

async function onNext(ctx, aid) {
  const att = await ownAttempt(ctx, aid);
  if (!att) return ctx.ack('Bu urinish topilmadi.', true);
  if (att.status !== 'active') {
    ctx.ack();
    return att.status === 'abandoned' ? showMenu(ctx) : showResultScreen(ctx, att);
  }
  if (att.deadline && now() > att.deadline + 2) return finishAndShow(ctx, att, 'expired');
  ctx.ack();
  return renderQuestion(ctx, att);
}

async function onFinishAsk(ctx, aid) {
  const att = await ownAttempt(ctx, aid);
  if (!att || att.status !== 'active') {
    ctx.ack('Bu test allaqachon yakunlangan.');
    return att ? showResultScreen(ctx, att) : undefined;
  }
  ctx.ack();
  const sum = await A.summary(att.id);
  await showForAttempt(ctx, att, ui.confirmFinish(att, sum.total - sum.answered));
}

async function finishAndShow(ctx, att, status) {
  const done = await A.finishAttempt(att.id, status);
  const fresh = await A.getAttempt(att.id);
  ctx.ack();
  await showResultScreen(ctx, fresh, { expired: fresh.status === 'expired' });
  if (done && fresh.notify_admins && !fresh.is_preview && fresh.kind === 'normal') {
    const sum = await A.summary(fresh.id);
    ctx.bg.push(
      notifyAdmins(
        `📥 <b>${esc(userLabel(ctx.user))}</b> testni yakunladi\n📚 ${esc(fresh.test_title || '')}\n✅ ${sum.correct}/${fresh.total} (${fmtPercent(fresh.score_percent)}%)`,
      ),
    );
  }
}

export async function buildResult(att, user) {
  const [sum, wrong] = await Promise.all([A.summary(att.id), A.wrongCount(att.id)]);
  let rank = 0;
  let ranked = 0;
  if (att.kind === 'normal' && att.show_leaderboard && !att.is_preview && att.test_title) {
    const lb = await A.leaderboard(att.test_id);
    ranked = lb.length;
    rank = lb.findIndex((r) => r.user_id === att.user_id) + 1;
  }
  let canRetake = !!att.test_title;
  if (canRetake && att.max_attempts > 0 && !att.is_preview) canRetake = (await A.countAttempts(att.user_id, att.test_id)) < att.max_attempts;
  return {
    text: ui.resultText(att, sum, user, { rank, ranked, expired: att.status === 'expired' }),
    markup: ui.resultKb(att, { wrong, canRetake }),
  };
}

async function showResultScreen(ctx, att) {
  const view = await buildResult(att, ctx.user);
  await showForAttempt(ctx, att, view);
}

/** Cron: vaqti tugagan urinishni yakunlab, foydalanuvchiga natijani yuboradi. */
export async function expireAttempt(att) {
  const done = await A.finishAttempt(att.id, 'expired');
  if (!done) return false;
  const fresh = await A.getAttempt(att.id);
  const user = await getUser(att.user_id);
  const ctx = { user, chatId: att.chat_id || att.user_id, msgId: null, bg: [], ack() {} };
  try {
    await showResultScreen(ctx, fresh);
  } catch (e) {
    if (e instanceof tg.TgError && e.blocked) await markBlocked(att.user_id, true);
    else throw e;
  }
  if (fresh.notify_admins && !fresh.is_preview && fresh.kind === 'normal') {
    const sum = await A.summary(fresh.id);
    await notifyAdmins(
      `📥 <b>${esc(userLabel(user))}</b> — vaqt tugadi\n📚 ${esc(fresh.test_title || '')}\n✅ ${sum.correct}/${fresh.total} (${fmtPercent(fresh.score_percent)}%)`,
    );
  }
  return true;
}

async function onResume(ctx, aid) {
  const att = await ownAttempt(ctx, aid);
  if (!att || att.status !== 'active') {
    ctx.ack('Bu urinish endi faol emas.', true);
    return showMenu(ctx);
  }
  ctx.ack();
  if (att.deadline && now() > att.deadline + 2) return finishAndShow(ctx, att, 'expired');
  return renderQuestion(ctx, att);
}

async function onAbandon(ctx, aid) {
  const att = await ownAttempt(ctx, aid);
  if (att && att.status === 'active') {
    await A.abandonAttempt(att.id);
    if (att.message_id && att.message_id !== ctx.msgId) await tg.deleteMessage(ctx.chatId, att.message_id);
    if (att.aux_message_id) await tg.deleteMessage(ctx.chatId, att.aux_message_id);
  }
  ctx.ack('Bekor qilindi.');
  if (att) return startTest(ctx, att.test_id);
  return showMenu(ctx);
}

async function onRetryMistakes(ctx, aid) {
  const parent = await ownAttempt(ctx, aid);
  if (!parent) return ctx.ack('Urinish topilmadi.', true);
  const active = await A.getActiveAttempt(ctx.user.id);
  if (active) return showConflict(ctx, active);
  const set = await A.pickMistakes(parent.id);
  if (!set.length) return ctx.ack('Xatolar yo\'q — ajoyib! 🎉', true);
  const test = (await getTest(parent.test_id)) || { id: parent.test_id, instant_feedback: 1, time_limit_min: 0 };
  const r = await A.createAttempt({
    userId: ctx.user.id,
    test,
    set,
    kind: 'retry',
    parentId: parent.id,
    isPreview: !!parent.is_preview,
    chatId: ctx.chatId,
    instant: true,
    timeLimitMin: 0,
  });
  if (r.conflict) {
    const again = await A.getActiveAttempt(ctx.user.id);
    return again ? showConflict(ctx, again) : ctx.ack('Qayta urinib ko\'ring.', true);
  }
  ctx.ack();
  const att = await A.getAttempt(r.attempt.id);
  // natija xabari endi savol xabariga aylanadi — eski rasm (agar bo'lsa) tozalanadi
  await renderQuestion(ctx, att);
}

async function onReview(ctx, aid, p) {
  const att = await ownAttempt(ctx, aid);
  if (!att) return ctx.ack('Urinish topilmadi.', true);
  const total = await A.wrongCount(att.id);
  if (!total) return ctx.ack('Xatolar yo\'q — ajoyib! 🎉', true);
  p = ((p % total) + total) % total;
  const item = await A.reviewItem(att.id, p);
  if (!item) return ctx.ack('Topilmadi.', true);
  ctx.ack();
  await showForAttempt(ctx, att, { text: ui.reviewText(att, item, p, total), markup: ui.reviewKb(att, p, total), photo: item.s.img });
}

async function onResult(ctx, aid) {
  const att = await ownAttempt(ctx, aid);
  if (!att) return ctx.ack('Urinish topilmadi.', true);
  ctx.ack();
  if (att.status === 'active') return renderQuestion(ctx, att);
  return showResultScreen(ctx, att);
}

async function onLeaderboard(ctx, testId) {
  const test = await getTest(testId);
  if (!test || !test.show_leaderboard) return ctx.ack('Reyting mavjud emas.', true);
  const rows = await A.leaderboard(testId);
  const idx = rows.findIndex((r) => r.user_id === ctx.user.id);
  const me = idx >= 0 ? { rank: idx + 1, row: rows[idx] } : null;
  ctx.ack();
  await showHere(ctx, ui.leaderboardView(test, rows, ctx.user.id, { me }));
}

async function onHistory(ctx, page) {
  const total = await A.userAttemptCount(ctx.user.id);
  const pages = Math.max(1, Math.ceil(total / 8));
  page = Math.min(Math.max(0, page), pages - 1);
  const items = await A.userAttempts(ctx.user.id, 8, page * 8);
  ctx.ack();
  await showHere(ctx, ui.historyView(items, page, total));
}

async function onProfile(ctx) {
  const fresh = (await getUser(ctx.user.id)) || ctx.user;
  const st = await userStats(ctx.user.id);
  ctx.ack();
  await showHere(ctx, ui.profileView(fresh, st));
}

async function onPanel(ctx) {
  if (!isAdmin(ctx.user.id)) return ctx.ack();
  const base = await siteBase(ctx);
  if (!base) {
    ctx.ack();
    return tg.sendMessage(ctx.chatId, 'Sayt manzili aniqlanmadi. <code>/api/setup</code> sahifasini bir marta oching yoki SITE_URL o\'zgaruvchisini kiriting.');
  }
  const token = await createLoginToken(ctx.user.id);
  ctx.ack();
  const view = ui.panelView(`${base}/#/login/${token}`, `${base}/`);
  // xavfsizlik: login havolasi chatda qolib ketmasligi uchun alohida xabar sifatida yuboramiz
  await tg.sendMessage(ctx.chatId, view.text, { reply_markup: view.markup, protect_content: true });
}

// ---------- Kirish nuqtalari ----------


// ---------- Fayldan test yaratish (admin) ----------

const IMPORT_HELP =
  `📄 <b>Fayldan test yaratish</b>\n\nWord (.docx) yoki .txt faylni shu yerga yuboring — bot savollarni o'qib, <b>qoralama test</b> yaratadi.\n\n` +
  `<b>Fayl ko'rinishi:</b>\n<pre>Test nomi\n\n1. Savol matni?\nA) variant\nB) variant\nC) variant\nD) variant\nJavob: C</pre>\n` +
  `To'g'ri javob "Javob: C" qatori, variant oxiridagi "(To'g'ri javob)" yozuvi yoki qalin (bold) variant bilan belgilanadi.`;

async function onDocument(ctx, msg) {
  if (!isAdmin(ctx.user.id)) return tg.sendMessage(ctx.chatId, 'Quyidagi menyudan foydalaning 👇', { reply_markup: ui.menuKb(false) });
  const doc = msg.document;
  const name = doc.file_name || 'test';
  if (!/\.(docx|txt)$/i.test(name)) return tg.sendMessage(ctx.chatId, `❌ <b>${esc(name)}</b> qabul qilinmaydi.\n\n${IMPORT_HELP}`);
  if (doc.file_size && doc.file_size > MAX_UPLOAD) return tg.sendMessage(ctx.chatId, '❌ Fayl 5 MB dan oshmasin.');
  let res;
  try {
    const f = await tg.downloadFile(doc.file_id);
    res = parseUpload(Buffer.from(f.buffer), name);
  } catch (e) {
    if (e instanceof tg.TgError) return tg.sendMessage(ctx.chatId, '❌ Faylni Telegramdan yuklab bo\'lmadi. Qayta yuboring.');
    if (e?.status) return tg.sendMessage(ctx.chatId, `❌ ${esc(e.message)}`);
    throw e;
  }
  const good = res.questions.filter((q) => !q.issues.length);
  const bad = res.questions.filter((q) => q.issues.length);
  const title = (String(msg.caption || '').trim() || res.title || 'Yangi test').slice(0, 120);
  const lines = [`📄 <b>${esc(title)}</b>`, `Fayldan <b>${res.stats.found}</b> ta savol o'qildi.`];
  if (res.expected && res.expected.count === res.stats.found) lines.push(`Sarlavhadagi son bilan mos: ${res.expected.count} ta ✅`);
  if (bad.length) lines.push('', `⚠ Tuzatish kerak (<b>${bad.length}</b> ta, saqlanmadi):`, ...bad.slice(0, 8).map((q) => `#${q.n}: ${esc(String(q.issues[0]).slice(0, 110))}`));
  for (const w of res.warnings) lines.push('', `⚠ ${esc(w)}`);
  if (!good.length) return tg.sendMessage(ctx.chatId, [...lines, '', 'Saqlash uchun tayyor savol yo\'q.'].join('\n'));
  const saved = await commitImport({ test: { title, description: res.description }, questions: good });
  lines.push('', `✅ <b>${saved.added}</b> ta savol <b>qoralama test</b> sifatida saqlandi (ID ${saved.test_id}).`, 'Foydalanuvchilarga ochish uchun testni panelda e\'lon qiling.');
  return tg.sendMessage(ctx.chatId, lines.join('\n'), { reply_markup: ui.menuKb(true) });
}

export async function onMessage(ctx, msg) {
  if (msg.document) return onDocument(ctx, msg);
  const text = (msg.text || '').trim();
  const cmdMatch = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+(.*))?$/s.exec(text);
  const cmd = cmdMatch ? cmdMatch[1].toLowerCase() : null;
  const arg = cmdMatch ? (cmdMatch[2] || '').trim() : '';

  // Har qanday buyruq kutilayotgan holatni (masalan, ism kiritishni) bekor qiladi
  if (cmd && ctx.user.state) {
    await setState(ctx.user.id, null);
    ctx.user.state = null;
  }

  if (ctx.user.state === 'await_name' && !cmd) {
    const name = text.replace(/\s+/g, ' ').trim();
    if (!msg.text || name.length < 2 || name.length > 40) {
      return tg.sendMessage(ctx.chatId, 'Ism 2 dan 40 belgigacha bo\'lishi kerak. Qaytadan yuboring yoki /cancel bosing.');
    }
    await setDisplayName(ctx.user.id, name);
    ctx.user.display_name = name;
    ctx.user.state = null;
    const st = await userStats(ctx.user.id);
    const v = ui.profileView(ctx.user, st);
    await tg.sendMessage(ctx.chatId, `✅ Ism yangilandi: <b>${esc(name)}</b>`);
    return tg.sendMessage(ctx.chatId, v.text, { reply_markup: v.markup });
  }

  switch (cmd) {
    case 'start':
      return cmdStart(ctx, arg);
    case 'menu':
    case 'cancel':
      return tg.sendMessage(ctx.chatId, ui.menuText(), { reply_markup: ui.menuKb(isAdmin(ctx.user.id)) });
    case 'tests':
    case 'testlar':
      return showTests(ctx);
    case 'history':
    case 'natijalar':
      return onHistory(ctx, 0);
    case 'profile':
    case 'profil':
    case 'stats':
      return onProfile(ctx);
    case 'help':
    case 'yordam':
      return tg.sendMessage(ctx.chatId, ui.helpText(await getSetting('help_text')), { reply_markup: ui.menuKb(isAdmin(ctx.user.id)) });
    case 'import':
      return isAdmin(ctx.user.id) ? tg.sendMessage(ctx.chatId, IMPORT_HELP) : null;
    case 'panel':
    case 'admin':
      return onPanel(ctx);
    default:
      return tg.sendMessage(ctx.chatId, 'Quyidagi menyudan foydalaning 👇', { reply_markup: ui.menuKb(isAdmin(ctx.user.id)) });
  }
}

export async function onCallback(ctx, cq) {
  const [cmd, ...p] = String(cq.data || '').split(':');
  const n = (i) => Number(p[i]);
  switch (cmd) {
    case 'noop':
      return ctx.ack();
    case 'm':
      ctx.ack();
      if (p[0] === 'home') return showMenu(ctx);
      if (p[0] === 'tests') return showTests(ctx);
      if (p[0] === 'help') return showHere(ctx, { text: ui.helpText(await getSetting('help_text')), markup: tg.kb([ui.backHome()]) });
      if (p[0] === 'panel') return onPanel(ctx);
      return;
    case 'l':
      ctx.ack();
      return showCategory(ctx, p[0], n(1) || 0);
    case 't':
      ctx.ack();
      return openTest(ctx, n(0));
    case 's':
      return startTest(ctx, n(0));
    case 'a':
      return onAnswer(ctx, n(0), n(1), n(2));
    case 'n':
      return onNext(ctx, n(0));
    case 'f':
      return onFinishAsk(ctx, n(0));
    case 'fy': {
      const att = await ownAttempt(ctx, n(0));
      if (!att) return ctx.ack('Urinish topilmadi.', true);
      if (att.status !== 'active') {
        ctx.ack();
        return showResultScreen(ctx, att);
      }
      return finishAndShow(ctx, att, 'finished');
    }
    case 'rs':
      return onResume(ctx, n(0));
    case 'ab':
      return onAbandon(ctx, n(0));
    case 'x':
      return onRetryMistakes(ctx, n(0));
    case 'r':
      return onReview(ctx, n(0), n(1) || 0);
    case 'rv':
      return onResult(ctx, n(0));
    case 'lb':
      return onLeaderboard(ctx, n(0));
    case 'h':
      return onHistory(ctx, n(0) || 0);
    case 'pr':
      if (ctx.user.state) await setState(ctx.user.id, null);
      return onProfile(ctx);
    case 'pn':
      await setState(ctx.user.id, 'await_name');
      ctx.ack();
      return showHere(ctx, ui.askName());
    default:
      return ctx.ack();
  }
}

export { makeAck };
