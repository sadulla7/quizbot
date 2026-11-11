// Bot matnlari va klaviaturalari (o'zbek tilida).
import { btn, kb, urlBtn, webAppBtn } from '../lib/tg.mjs';
import { clip, esc, fmtDate, fmtDuration, fmtPercent, letter, now, shortKey, userLabel } from '../lib/util.mjs';

export const PAGE = 8;

const MEDALS = ['🥇', '🥈', '🥉'];

// ---------- Asosiy menyu ----------

export function welcomeText(user, custom) {
  return (
    `👋 Assalomu alaykum, <b>${esc(userLabel(user))}</b>!\n\n` +
    `Bu bot orqali testlarni ishlab, bilimingizni sinab ko'rishingiz mumkin.\n\n` +
    `📚 <b>Testlar</b> — mavjud testlar ro'yxati\n` +
    `📊 <b>Natijalarim</b> — avvalgi urinishlaringiz\n` +
    `👤 <b>Profil</b> — reytingda ko'rinadigan ismingiz\n` +
    (custom ? `\n${esc(custom)}\n` : '')
  );
}

export function menuText() {
  return `🏠 <b>Asosiy menyu</b>\n\nKerakli bo'limni tanlang:`;
}

export function menuKb(isAdmin) {
  return kb([
    [btn('📚 Testlar', 'm:tests')],
    [btn('📊 Natijalarim', 'h:0'), btn('👤 Profil', 'pr')],
    [btn('ℹ️ Yordam', 'm:help')],
    isAdmin ? [btn('🖥 Admin panel', 'm:panel')] : [],
  ]);
}

export function helpText(custom) {
  return (
    `ℹ️ <b>Yordam</b>\n\n` +
    `1️⃣ <b>📚 Testlar</b> bo'limidan testni tanlang va <b>Boshlash</b> tugmasini bosing.\n` +
    `2️⃣ Har bir savol ostidagi <b>A, B, C...</b> tugmalaridan to'g'ri javobni tanlang.\n` +
    `3️⃣ Test oxirida natija, xatolaringiz va reyting ko'rsatiladi.\n` +
    `4️⃣ <b>Xatolar ustida ishlash</b> tugmasi faqat noto'g'ri javob bergan savollaringizni qayta mashq qildiradi.\n\n` +
    `<b>Buyruqlar</b>\n` +
    `/start — bosh menyu\n` +
    `/tests — testlar ro'yxati\n` +
    `/history — natijalarim\n` +
    `/profile — profil\n` +
    `/cancel — joriy amalni bekor qilish\n` +
    (custom ? `\n${esc(custom)}` : '')
  );
}

export const backHome = () => [btn('🏠 Menyu', 'm:home')];

// ---------- Testlar ro'yxati ----------

export function groupCategories(tests) {
  const map = new Map();
  for (const t of tests) {
    const key = shortKey(t.category);
    if (!map.has(key)) map.set(key, { key, name: t.category || 'Boshqa', tests: [] });
    map.get(key).tests.push(t);
  }
  return [...map.values()].sort((a, b) => (a.key === 'x') - (b.key === 'x') || a.name.localeCompare(b.name, 'uz'));
}

export function categoriesView(cats) {
  return {
    text: `📚 <b>Fanlar / bo'limlar</b>\n\nBo'limni tanlang:`,
    markup: kb([
      ...cats.map((c) => [btn(`📁 ${clip(c.name, 40)} (${c.tests.length})`, `l:${c.key}:0`)]),
      backHome(),
    ]),
  };
}

export function testsListView(cat, page, showBack) {
  const pages = Math.max(1, Math.ceil(cat.tests.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = cat.tests.slice(page * PAGE, page * PAGE + PAGE);
  const nav = [];
  if (pages > 1) {
    nav.push(btn('◀️', `l:${cat.key}:${Math.max(0, page - 1)}`), btn(`${page + 1}/${pages}`, 'noop'), btn('▶️', `l:${cat.key}:${Math.min(pages - 1, page + 1)}`));
  }
  return {
    text: `📚 <b>${showBack ? '📁 ' + esc(cat.name) : 'Testlar'}</b>\n\nTestni tanlang:`,
    markup: kb([
      ...slice.map((t) => [btn(`📝 ${clip(t.title, 38)} · ${t.question_count}`, `t:${t.id}`)]),
      nav,
      showBack ? [btn('⬅️ Bo\'limlar', 'm:tests'), btn('🏠 Menyu', 'm:home')] : backHome(),
    ]),
  };
}

export function noTestsView() {
  return { text: `📭 Hozircha testlar yo'q.\n\nKeyinroq qayta urinib ko'ring.`, markup: kb([backHome()]) };
}

// ---------- Test kartasi ----------

export function testCard(test, { used, best, isDraft, limitReached }) {
  const perAttempt = test.questions_per_attempt > 0 && test.questions_per_attempt < test.question_count;
  let s = `📚 <b>${esc(test.title)}</b>\n`;
  if (test.description) s += `\n${esc(test.description)}\n`;
  s += `\n❓ Savollar: <b>${test.question_count}</b>${perAttempt ? ` (har urinishda ${test.questions_per_attempt} ta tasodifiy)` : ''}`;
  s += `\n⏱ Vaqt: <b>${test.time_limit_min > 0 ? test.time_limit_min + ' daqiqa' : 'cheklanmagan'}</b>`;
  s += `\n💡 Rejim: <b>${test.instant_feedback ? 'Mashq' : 'Imtihon'}</b> — ${test.instant_feedback ? 'har javobdan so\'ng natija va izoh ko\'rsatiladi' : 'natija test oxirida ko\'rsatiladi'}`;
  s += `\n🎯 O'tish balli: <b>${test.pass_percent}%</b>`;
  s += `\n🔁 Urinishlar: <b>${test.max_attempts > 0 ? `${used}/${test.max_attempts}` : 'cheklanmagan'}</b>`;
  if (best != null) s += `\n🏅 Eng yaxshi natijangiz: <b>${fmtPercent(best)}%</b>`;
  if (isDraft) s += `\n\n🛠 <i>Bu test hali e'lon qilinmagan (qoralama). Faqat adminlarga ko'rinadi, natijalar hisobga olinmaydi.</i>`;
  if (limitReached) s += `\n\n⛔️ Urinishlar soni tugagan.`;
  return s;
}

export function testCardKb(test, { limitReached, backKey }) {
  return kb([
    limitReached ? [] : [btn('▶️ Boshlash', `s:${test.id}`)],
    test.show_leaderboard ? [btn('🏆 Reyting', `lb:${test.id}`)] : [],
    [btn('⬅️ Orqaga', backKey ? `l:${backKey}:0` : 'm:tests'), btn('🏠 Menyu', 'm:home')],
  ]);
}

// ---------- Savol ----------

export function fmtTimer(deadline) {
  const left = Math.max(0, deadline - now());
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function optionLines(snap, marks = {}) {
  return snap.o
    .map((o, i) => `${marks[i] ? marks[i] + ' ' : ''}<b>${letter(i)})</b> ${esc(o)}`)
    .join('\n');
}

/** Telegram 4096 chegarasiga sig'dirish uchun matnni kerak bo'lsa qisqartiradi. */
function fit(build, snap) {
  let text = snap.t;
  let expl = snap.e;
  let out = build(text, expl);
  for (let i = 0; i < 6 && out.length > 4000; i++) {
    text = clip(text, Math.floor(text.length * 0.8));
    expl = clip(expl, Math.floor(expl.length * 0.8));
    out = build(text, expl);
  }
  return out;
}

export function questionText(att, snap, idx) {
  const timer = att.deadline ? `  ·  ⏱ <b>${fmtTimer(att.deadline)}</b>` : '';
  const head = `<b>📚 ${esc(clip(att.test_title || 'Test', 60))}</b>\n<b>Savol ${idx + 1}/${att.total}</b>${timer}`;
  return fit((t) => `${head}\n\n${esc(t)}\n\n${optionLines(snap)}`, snap);
}

export function questionKb(att, idx, snap) {
  const letters = snap.o.map((_, i) => btn(letter(i), `a:${att.id}:${idx}:${i}`));
  const rows = snap.o.length <= 4 ? [letters] : [letters.slice(0, 3), letters.slice(3)];
  rows.push([btn('🏁 Yakunlash', `f:${att.id}`)]);
  return kb(rows);
}

export function feedbackText(att, snap, idx, choice) {
  const ok = choice === snap.c;
  const marks = {};
  for (let i = 0; i < snap.o.length; i++) marks[i] = '▫️';
  marks[snap.c] = '✅';
  if (!ok && choice != null) marks[choice] = '❌';
  const head = `<b>📚 ${esc(clip(att.test_title || 'Test', 60))}</b>\n<b>Savol ${idx + 1}/${att.total}</b>`;
  const verdict = ok ? '✅ <b>To\'g\'ri!</b>' : `❌ <b>Noto'g'ri.</b> To'g'ri javob: <b>${letter(snap.c)}</b>`;
  return fit(
    (t, e) => `${head}\n\n${verdict}\n\n${esc(t)}\n\n${optionLines(snap, marks)}${e ? `\n\n💡 <b>Izoh:</b> ${esc(e)}` : ''}`,
    snap,
  );
}

export function feedbackKb(att, idx, isLast) {
  return kb([[btn(isLast ? '🏁 Natijani ko\'rish' : 'Keyingi savol ➡️', `n:${att.id}:${idx}`)]]);
}

export function confirmFinish(att, unanswered) {
  return {
    text:
      `🏁 <b>Testni yakunlaysizmi?</b>\n\n` +
      (unanswered > 0 ? `Javob berilmagan savollar: <b>${unanswered}</b> ta (ular noto'g'ri deb hisoblanadi).` : `Barcha savollarga javob berdingiz.`),
    markup: kb([[btn('✅ Ha, yakunlash', `fy:${att.id}`)], [btn('↩️ Davom etish', `rs:${att.id}`)]]),
  };
}

export function activeConflict(att, answered) {
  return {
    text: `⚠️ <b>Sizda tugallanmagan test bor</b>\n\n📚 ${esc(att.test_title || 'Test')}\nJavob berilgan: <b>${answered}/${att.total}</b>\n\nAvval uni davom ettiring yoki bekor qiling.`,
    markup: kb([[btn('▶️ Davom etish', `rs:${att.id}`)], [btn('🗑 Bekor qilib, yangisini boshlash', `ab:${att.id}`)], backHome()]),
  };
}

// ---------- Natija ----------

function grade(p) {
  if (p >= 90) return '🔥 Ajoyib natija!';
  if (p >= 70) return '👏 Yaxshi natija!';
  if (p >= 50) return '👍 Fikr yomon emas.';
  return '📚 Yana bir oz mashq qiling.';
}

export function resultText(att, sum, user, { rank, ranked, expired }) {
  const percent = att.score_percent ?? (att.total ? Math.round((1000 * sum.correct) / att.total) / 10 : 0);
  const dur = (att.finished_at || now()) - att.started_at;
  const retry = att.kind === 'retry';
  const passed = percent >= (att.pass_percent ?? 60);
  let s = expired ? `⏰ <b>Vaqt tugadi!</b>\n\n` : retry ? `🔁 <b>Xatolar ustida ishlash yakunlandi</b>\n\n` : `🏁 <b>Test yakunlandi</b>\n\n`;
  s += `📚 ${esc(att.test_title || 'Test')}\n👤 ${esc(userLabel(user))}\n\n`;
  s += `✅ To'g'ri: <b>${sum.correct}</b> / ${att.total}\n`;
  s += `❌ Noto'g'ri: <b>${sum.wrong}</b>\n`;
  if (sum.skipped) s += `⏭ Javobsiz: <b>${sum.skipped}</b>\n`;
  s += `📈 Natija: <b>${fmtPercent(percent)}%</b>\n`;
  s += `⏱ Sarflangan vaqt: ${fmtDuration(dur)}\n`;
  if (!retry && att.pass_percent != null) s += `🎯 O'tish balli ${att.pass_percent}%: ${passed ? '<b>o\'tdingiz ✅</b>' : '<b>o\'tolmadingiz ❌</b>'}\n`;
  if (!retry && rank) s += `🏆 Reytingdagi o'rningiz: <b>${rank}</b> / ${ranked}\n`;
  s += `\n${grade(percent)}`;
  if (att.is_preview) s += `\n\n🛠 <i>Sinov urinishi — natijalar hisobga olinmadi.</i>`;
  return s;
}

export function resultKb(att, { wrong, canRetake }) {
  const rows = [];
  if (wrong > 0) rows.push([btn(`📋 Xatolarni ko'rish (${wrong})`, `r:${att.id}:0`)]);
  if (wrong > 0) rows.push([btn('🔁 Xatolar ustida ishlash', `x:${att.id}`)]);
  const row3 = [];
  if (att.kind === 'normal' && att.show_leaderboard && !att.is_preview) row3.push(btn('🏆 Reyting', `lb:${att.test_id}`));
  if (canRetake) row3.push(btn('🔄 Qayta topshirish', `s:${att.test_id}`));
  if (row3.length) rows.push(row3);
  rows.push(backHome());
  return kb(rows);
}

// ---------- Xatolarni ko'rish ----------

export function reviewText(att, item, p, total) {
  const s = item.s;
  const marks = {};
  for (let i = 0; i < s.o.length; i++) marks[i] = '▫️';
  marks[s.c] = '✅';
  if (item.chosen != null && item.chosen !== s.c) marks[item.chosen] = '❌';
  const head = `📋 <b>Xatolar ustida ishlash</b> · ${p + 1}/${total}\n<b>Savol №${item.idx + 1}</b>`;
  const mine = item.chosen == null ? '⏭ <i>Siz bu savolga javob bermagansiz.</i>' : `Sizning javobingiz: <b>${letter(item.chosen)}</b>`;
  return fit(
    (t, e) => `${head}\n\n${esc(t)}\n\n${optionLines(s, marks)}\n\n${mine}\nTo'g'ri javob: <b>${letter(s.c)}</b>${e ? `\n\n💡 <b>Izoh:</b> ${esc(e)}` : ''}`,
    s,
  );
}

export function reviewKb(att, p, total) {
  const nav = [];
  if (total > 1) nav.push(btn('◀️', `r:${att.id}:${(p - 1 + total) % total}`), btn(`${p + 1}/${total}`, 'noop'), btn('▶️', `r:${att.id}:${(p + 1) % total}`));
  return kb([nav, [btn('⬅️ Natijaga qaytish', `rv:${att.id}`)]]);
}

// ---------- Reyting ----------

export function leaderboardView(test, rows, userId, { me }) {
  const top = rows.slice(0, 10);
  let s = `🏆 <b>Reyting</b>\n📚 ${esc(test.title)}\n<i>Har bir ishtirokchining eng yaxshi natijasi</i>\n\n`;
  if (!rows.length) s += `Hozircha hech kim bu testni yakunlamagan. Birinchi bo'ling! 💪`;
  top.forEach((r, i) => {
    const name = esc(clip(userLabel(r), 28));
    const mark = MEDALS[i] || `<b>${i + 1}.</b>`;
    const you = r.user_id === userId ? ' 👈' : '';
    s += `${mark} ${name} — ${r.correct_count}/${r.total} (${fmtPercent(r.score_percent)}%) · ${fmtDuration(r.dur)}${you}\n`;
  });
  if (me && me.rank > 10) s += `\n…\n<b>${me.rank}.</b> Siz — ${me.row.correct_count}/${me.row.total} (${fmtPercent(me.row.score_percent)}%) 👈`;
  if (rows.length) s += `\n\nIshtirokchilar: ${rows.length}`;
  return { text: s, markup: kb([[btn('⬅️ Test kartasi', `t:${test.id}`)], backHome()]) };
}

// ---------- Tarix ----------

export function historyView(items, page, total) {
  const pages = Math.max(1, Math.ceil(total / 8));
  let s = `📊 <b>Natijalarim</b>\n\n`;
  if (!items.length) s += `Hali birorta testni yakunlamagansiz.`;
  items.forEach((a, i) => {
    const tag = a.kind === 'retry' ? ' 🔁' : '';
    s += `<b>${page * 8 + i + 1}.</b> ${esc(clip(a.test_title || 'O\'chirilgan test', 40))}${tag}\n    ${a.correct_count}/${a.total} (${fmtPercent(a.score_percent)}%) · ${fmtDate(a.finished_at)}\n`;
  });
  const rows = [];
  if (items.length) rows.push(items.map((a, i) => btn(String(page * 8 + i + 1), `rv:${a.id}`)));
  if (pages > 1) rows.push([btn('◀️', `h:${Math.max(0, page - 1)}`), btn(`${page + 1}/${pages}`, 'noop'), btn('▶️', `h:${Math.min(pages - 1, page + 1)}`)]);
  rows.push(backHome());
  return { text: s + (items.length ? `\nBatafsil ko'rish uchun raqamni bosing.` : ''), markup: kb(rows) };
}

// ---------- Profil ----------

export function profileView(user, st) {
  let s = `👤 <b>Profil</b>\n\n`;
  s += `Reytingdagi ism: <b>${esc(userLabel(user))}</b>\n`;
  if (user.username) s += `Telegram: @${esc(user.username)}\n`;
  s += `ID: <code>${user.id}</code>\n`;
  s += `Ro'yxatdan o'tgan: ${fmtDate(user.created_at)}\n\n`;
  s += `📊 <b>Statistika</b>\n`;
  s += `Yakunlangan urinishlar: <b>${st.attempts}</b> (${st.tests} xil test)\n`;
  if (st.attempts) {
    s += `O'rtacha natija: <b>${fmtPercent(st.avg_percent)}%</b>\n`;
    s += `Eng yuqori natija: <b>${fmtPercent(st.best_percent)}%</b>\n`;
    s += `To'g'ri javoblar: <b>${st.correct}</b> / ${st.total_q}\n`;
  }
  return { text: s, markup: kb([[btn('✏️ Ismni o\'zgartirish', 'pn')], backHome()]) };
}

export const askName = () => ({
  text: `✏️ <b>Ismni o'zgartirish</b>\n\nReytingda ko'rinadigan yangi ismingizni yuboring (masalan: <i>Ali Valiyev</i>).\nBekor qilish uchun /cancel.`,
  markup: kb([[btn('↩️ Bekor qilish', 'pr')]]),
});

// ---------- Admin ----------

export function panelView(link, appUrl) {
  return {
    text: `🖥 <b>Admin panel</b>\n\nTugmalardan birini bosing.\n<i>Brauzer havolasi 10 daqiqa amal qiladi va faqat bir marta ishlaydi.</i>`,
    markup: kb([
      appUrl && appUrl.startsWith('https://') ? [webAppBtn('📱 Telegram ichida ochish', appUrl)] : [],
      link.startsWith('https://') ? [urlBtn('🌐 Brauzerda ochish', link)] : [],
      backHome(),
    ]),
  };
}

export const NOT_FOUND = `Kechirasiz, bu test topilmadi yoki hozircha yopiq.`;
export const BANNED = `⛔️ Kechirasiz, sizga botdan foydalanish cheklangan.`;
