// Admin panel: kirish, testlar, fayldan import, test sahifasi.
const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = k === 'value' ? v : !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) return c.forEach(add); el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
};
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; };
const store = { get: () => { try { return localStorage.getItem('qb_session') || ''; } catch { return ''; } }, set: (v) => { try { localStorage.setItem('qb_session', v); } catch {} }, clear: () => { try { localStorage.removeItem('qb_session'); } catch {} } };
const L = (i) => String.fromCharCode(65 + i);
const app = document.getElementById('app');

function toast(msg, bad) {
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

async function api(method, path, body, raw) {
  const init = { method, headers: {} };
  const s = store.get();
  if (s) init.headers.authorization = 'Bearer ' + s;
  if (raw) { init.body = raw.file; init.headers['x-file-name'] = encodeURIComponent(raw.name); }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); } catch { throw new Error('Server bilan aloqa yo\'q. Internetni tekshiring.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && s && !path.startsWith('/api/auth/')) { store.clear(); boot(); }
  if (!res.ok) throw new Error(data.error || `Xatolik (${res.status})`);
  return data;
}
const fail = (e) => toast(e.message || 'Xatolik', true);

// ---------- Kirish ----------
function loginScreen(msg) {
  fill(app, h('div', { class: 'center' }, h('h1', {}, 'Test paneli'),
    h('p', {}, msg || ['Kirish uchun Telegramdagi botga o\'ting va ', h('b', {}, '/panel'), ' buyrug\'ini yuboring. Bot bir martalik havola beradi.']),
    h('p', { class: 'muted' }, 'Havola 10 daqiqa amal qiladi va faqat bir marta ishlaydi.')));
}

async function boot() {
  const m = /^#\/login\/(.+)$/.exec(location.hash);
  if (m) {
    fill(app, h('div', { class: 'boot' }, 'Kirilmoqda…'));
    try { store.set((await api('POST', '/api/auth/token', { token: m[1] })).session); history.replaceState(null, '', location.pathname + '#/'); }
    catch (e) { return loginScreen(e.message); }
  }
  if (!store.get()) {
    const initData = await telegramInitData();
    if (!initData) return loginScreen();
    try { store.set((await api('POST', '/api/auth/webapp', { initData })).session); } catch (e) { return loginScreen(e.message); }
  }
  route();
}

function telegramInitData() {
  if (!/tgWebApp|Telegram/i.test(location.hash + navigator.userAgent)) return Promise.resolve('');
  return new Promise((ok) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => ok(window.Telegram?.WebApp?.initData || '');
    s.onerror = () => ok('');
    document.head.append(s);
  });
}

// ---------- Umumiy ko'rinish ----------
function shell(...content) {
  fill(app, h('div', { class: 'wrap' },
    h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/' }, 'Test paneli'),
      h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: '#/import' }, 'Fayldan test yaratish'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { store.clear(); loginScreen('Chiqdingiz. Qayta kirish uchun botda /panel yuboring.'); } }, 'Chiqish'))),
    h('main', { id: 'main' }, content)));
}

// ---------- Testlar ro'yxati ----------
async function testsView() {
  shell(h('div', { class: 'boot' }, 'Yuklanmoqda…'));
  try {
    const [{ tests }, st] = await Promise.all([api('GET', '/api/admin/tests'), api('GET', '/api/admin/stats')]);
    shell(h('h1', {}, 'Testlar'),
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, st.users.total), 'foydalanuvchi'),
        h('div', {}, h('b', {}, `${st.tests.published}/${st.tests.total}`), 'e\'lon qilingan'),
        h('div', {}, h('b', {}, st.questions), 'savol'),
        h('div', {}, h('b', {}, st.attempts.today), 'bugungi urinish')),
      tests.length ? h('div', { class: 'list' }, tests.map((t) => h('a', { class: 'trow', href: `#/test/${t.id}` },
        h('div', {}, h('strong', {}, t.title), h('div', { class: 'muted' }, `${t.question_count} savol · ${t.attempt_count || 0} urinish`)),
        h('span', { class: 'chip' + (t.is_published ? ' ok' : '') }, t.is_published ? 'E\'lon qilingan' : 'Qoralama'))))
        : h('div', { class: 'card center' }, 'Hali test yo\'q. ', h('a', { href: '#/import' }, 'Fayldan test yarating.')));
  } catch (e) { fail(e); }
}

// ---------- Test sahifasi ----------
async function testView(id) {
  shell(h('div', { class: 'boot' }, 'Yuklanmoqda…'));
  let d;
  try { d = await api('GET', `/api/admin/tests/${id}`); } catch (e) { fail(e); return testsView(); }
  const t = d.test;
  const toggle = async () => {
    try { await api('PUT', `/api/admin/tests/${id}`, { is_published: !t.is_published }); toast(t.is_published ? 'Qoralamaga qaytarildi' : 'E\'lon qilindi'); testView(id); } catch (e) { fail(e); }
  };
  const del = async () => {
    if (!confirm(`"${t.title}" testini o'chirasizmi? Natijalar ham o'chadi.`)) return;
    try { await api('DELETE', `/api/admin/tests/${id}`); location.hash = '#/'; } catch (e) { fail(e); }
  };
  const delQ = async (q) => {
    if (!confirm('Savolni o\'chirasizmi?')) return;
    try { await api('DELETE', `/api/admin/questions/${q.id}`); testView(id); } catch (e) { fail(e); }
  };
  shell(h('a', { href: '#/' }, '← Testlar'), h('h1', {}, t.title),
    h('div', { class: 'row', style: 'margin-bottom:1rem' },
      h('span', { class: 'chip' + (t.is_published ? ' ok' : '') }, t.is_published ? 'E\'lon qilingan' : 'Qoralama'),
      h('span', { class: 'muted grow' }, `${d.questions.length} savol`),
      d.link && t.is_published && h('button', { class: 'btn ghost', type: 'button', onclick: () => navigator.clipboard?.writeText(d.link).then(() => toast('Havola nusxalandi')) }, 'Havolani nusxalash'),
      h('button', { class: 'btn', type: 'button', onclick: toggle }, t.is_published ? 'Qoralamaga qaytarish' : 'E\'lon qilish'),
      h('button', { class: 'btn ghost', type: 'button', onclick: del }, 'O\'chirish')),
    d.questions.map((q, i) => h('div', { class: 'card q' },
      h('strong', {}, `${i + 1}. ${q.text}`),
      q.options.map((o, k) => h('div', { class: 'opt' + (k === q.correct_index ? ' on' : '') }, h('span', {}, L(k) + ')'), h('span', {}, o))),
      q.explanation && h('p', { class: 'muted' }, 'Izoh: ' + q.explanation),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => delQ(q) }, 'O\'chirish')))));
}

// ---------- Fayldan import ----------
function importView() {
  const st = { questions: [], title: '', description: '', warnings: [] };
  const main = () => document.getElementById('main');

  const pick = () => {
    const input = h('input', { type: 'file', accept: '.docx,.txt', hidden: true, onchange: () => input.files[0] && upload(input.files[0]) });
    const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', 'aria-label': 'Fayl tanlash', onclick: () => input.click(),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()),
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); } },
      h('strong', {}, 'Word (.docx) yoki .txt faylni shu yerga tashlang'), h('span', { class: 'muted' }, 'yoki bosib tanlang · 5 MB gacha'));
    const ta = h('textarea', { rows: 7, placeholder: '1. Savol matni?\nA) variant\nB) variant\nC) variant\nD) variant\nJavob: C' });
    shell(h('a', { href: '#/' }, '← Testlar'), h('h1', {}, 'Fayldan test yaratish'), input, drop,
      h('div', { class: 'card', style: 'margin-top:1rem' }, h('h2', {}, 'Fayl ko\'rinishi'),
        h('pre', {}, 'Test nomi\n1-qism (1–100-savollar)\n\n1. Savol matni?\nA) variant\nB) variant\nC) variant\nD) variant\nJavob: C\nIzoh: ixtiyoriy'),
        h('p', { class: 'muted' }, 'To\'g\'ri javob: "Javob: C" qatori, variant oxiriga (To\'g\'ri javob) yozuvi yoki faqat to\'g\'ri variantni qalin (bold) qilib belgilang.')),
      h('div', { class: 'card' }, h('h2', {}, 'Yoki matnni joylang'), ta,
        h('div', { class: 'row end', style: 'margin-top:.6rem' }, h('button', { class: 'btn', type: 'button', onclick: () => ta.value.trim() ? run(api('POST', '/api/admin/import/parse', { text: ta.value, name: '' })) : toast('Matn bo\'sh', true) }, 'Tekshirish'))));
  };

  const upload = (file) => {
    if (!/\.(docx|txt)$/i.test(file.name)) return toast('Faqat .docx yoki .txt fayl yuklang.', true);
    if (file.size > 5 * 1024 * 1024) return toast('Fayl 5 MB dan oshmasin.', true);
    run(api('POST', '/api/admin/import/parse', undefined, { file, name: file.name }));
  };

  const run = async (p) => {
    shell(h('div', { class: 'boot' }, 'Fayl o\'qilmoqda…'));
    try {
      const r = await p;
      Object.assign(st, { title: r.title || '', description: r.description || '', warnings: r.warnings || [] });
      st.questions = r.questions.map((q) => ({ ...q, include: true }));
      preview();
    } catch (e) { fail(e); pick(); }
  };

  const isBad = (q) => q.include && (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length || q.options.length < 2);

  function preview() {
    const title = h('input', { type: 'text', value: st.title, maxlength: 120, 'aria-label': 'Test nomi' });
    const summary = h('p', { 'aria-live': 'polite' });
    const key = h('div', { class: 'key' });
    const save = h('button', { class: 'btn', type: 'button' });
    const cards = st.questions.map((q) => {
      const box = h('div', { class: 'card q' });
      const draw = () => {
        box.className = 'card q' + (isBad(q) ? ' bad' : '') + (q.include ? '' : ' off');
        fill(box,
          h('strong', {}, `#${q.n}. ${q.text}`),
          q.options.map((o, k) => h('div', { class: 'opt' + (q.correct_index === k ? ' on' : '') },
            h('label', {}, h('input', { type: 'radio', name: 'q' + q.n, checked: q.correct_index === k, onchange: () => { q.correct_index = k; q.issues = []; box.querySelectorAll('.opt').forEach((el, i) => el.classList.toggle('on', i === k)); box.classList.toggle('bad', isBad(q)); box.querySelector('.issue')?.remove(); refresh(); } }), h('span', {}, `${L(k)}) ${o}`)))),
          isBad(q) && h('p', { class: 'issue', role: 'alert' }, (q.issues && q.issues[0]) || 'To\'g\'ri javobni tanlang.'),
          q.explanation && h('p', { class: 'muted' }, 'Izoh: ' + q.explanation),
          h('label', { class: 'muted' }, h('input', { type: 'checkbox', checked: !q.include, onchange: (e) => { q.include = !e.target.checked; box.classList.toggle('off', !q.include); box.classList.toggle('bad', isBad(q)); const iss = box.querySelector('.issue'); if (iss) iss.hidden = !isBad(q); refresh(); } }), ' Chiqarib tashlash'));
      };
      q.draw = draw; draw();
      return box;
    });
    function refresh() {
      const inc = st.questions.filter((q) => q.include), bad = inc.filter(isBad);
      fill(summary, `${st.questions.length} ta savol topildi · `, h('b', {}, `${inc.length - bad.length} tayyor`), bad.length ? [' · ', h('span', { class: 'chip bad' }, `${bad.length} ta tuzatish kerak`)] : '');
      fill(key, st.questions.map((q) => h('span', { class: isBad(q) ? 'bad' : '', title: q.options[q.correct_index] || '' }, q.include ? `${q.n}${Number.isInteger(q.correct_index) ? L(q.correct_index) : '?'}` : `${q.n}✕`)));
      save.disabled = bad.length > 0 || !inc.length;
      save.textContent = bad.length ? `Avval ${bad.length} ta savolni tuzating` : `Testni yaratish (${inc.length} ta savol)`;
    }
    save.onclick = async () => {
      save.disabled = true;
      try {
        const r = await api('POST', '/api/admin/import/commit', { test: { title: title.value.trim() || 'Yangi test', description: st.description },
          questions: st.questions.filter((q) => q.include).map(({ n, text, options, correct_index, explanation }) => ({ n, text, options, correct_index, explanation })) });
        toast(`${r.added} ta savol qoralama test sifatida saqlandi`);
        location.hash = `#/test/${r.test_id}`;
      } catch (e) { fail(e); refresh(); }
    };
    shell(h('a', { href: '#/import' }, '← Boshqa fayl'), h('h1', {}, 'Tekshirish'),
      st.warnings.map((w) => h('p', { class: 'issue' }, '⚠ ' + w)),
      h('div', { class: 'card' }, h('label', {}, h('span', { class: 'muted' }, 'Test nomi'), title), summary, h('h2', {}, 'Javoblar kaliti'), key),
      cards, h('div', { class: 'savebar row end' }, save));
    refresh();
    const firstBad = cards.find((c) => c.classList.contains('bad'));
    if (firstBad) firstBad.scrollIntoView({ block: 'center' });
  }

  pick();
}

// ---------- Marshrut ----------
function route() {
  if (!store.get()) return;
  const hash = location.hash || '#/';
  let m;
  if ((m = /^#\/test\/(\d+)/.exec(hash))) return testView(m[1]);
  if (hash.startsWith('#/import')) return importView();
  return testsView();
}
addEventListener('hashchange', () => (/^#\/login\//.test(location.hash) ? boot() : route()));
boot();
