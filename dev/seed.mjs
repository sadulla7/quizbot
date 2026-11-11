// Dev uchun namunaviy ma'lumotlar.
import { exec, batch } from '../src/lib/db.mjs';

export function seed() {
  const now = Math.floor(Date.now() / 1000);
  const run = (sql, args = []) => exec(sql, args);
  (async () => {
    const mk = (title, category, extra = {}) => run(
      `INSERT INTO tests(title, description, category, is_published, instant_feedback, time_limit_min, questions_per_attempt, pass_percent, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [title, extra.desc || '', category, extra.pub ?? 1, extra.instant ?? 1, extra.time ?? 0, extra.per ?? 0, extra.pass ?? 60, now - 86400 * 5, now - 86400 * 5],
    );
    const t1 = (await mk('Ekonometrikaga kirish — 1-mavzu', 'Ekonometrika', { desc: 'Regressiya tahlilining asosiy tushunchalari.', time: 20 })).lastInsertId;
    const t2 = (await mk('Matematika — namunaviy', 'Matematika', { instant: 0, per: 3 })).lastInsertId;
    await mk('Qoralama test', '', { pub: 0 });
    const Q = [
      ['Eng kichik kvadratlar usuli (EKKU) nimani minimallashtiradi?', ['Qoldiqlar yig\'indisini', 'Qoldiqlar kvadratlari yig\'indisini', 'Qoldiqlar ko\'paytmasini', 'Xatolar o\'rtachasini'], 1, 'EKKU qoldiqlar kvadratlari yig\'indisini minimallashtiradi.'],
      ['Determinatsiya koeffitsienti (R²) qanday qiymatlarni qabul qiladi?', ['−1 dan 1 gacha', '0 dan 1 gacha', '0 dan ∞ gacha', '−∞ dan ∞ gacha'], 1, ''],
      ['Gauss–Markov teoremasiga ko\'ra EKKU baholari qanday xossaga ega?', ['Siljigan va samarasiz', 'Siljimagan va eng samarali (chiziqli baholar ichida)', 'Faqat izchil', 'Hech qanday'], 1, 'BLUE: Best Linear Unbiased Estimator.'],
      ['Multikollinearlik nima?', ['Qoldiqlar korrelyatsiyasi', 'Tushuntiruvchi o\'zgaruvchilar orasidagi kuchli chiziqli bog\'liqlik', 'Dispersiyaning o\'zgarishi', 'Modelning nochiziqliligi'], 1, ''],
    ];
    for (const [i, q] of Q.entries()) await run(`INSERT INTO questions(test_id, position, text, options, correct_index, explanation, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`, [t1, i + 1, q[0], JSON.stringify(q[1]), q[2], q[3], now, now]);
    for (let i = 1; i <= 6; i++) await run(`INSERT INTO questions(test_id, position, text, options, correct_index, explanation, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`, [t2, i, `${i} + ${i} = ?`, JSON.stringify([String(i), String(i * 2), String(i * 3)]), 1, '', now, now]);
    const names = [['Ali', 'Valiyev'], ['Dilnoza', 'Karimova'], ['Jasur', 'Toshmatov'], ['Madina', 'Yusupova'], ['Sardor', 'Rahimov']];
    for (const [i, [f, l]] of names.entries()) {
      const uid = 2000 + i;
      await run(`INSERT INTO users(id, first_name, last_name, username, created_at, last_seen_at) VALUES(?,?,?,?,?,?)`, [uid, f, l, f.toLowerCase(), now - 86400 * (6 - i), now - 3600 * i]);
      for (let k = 0; k < 3; k++) {
        const total = 4; const correct = (i + k) % 5 > 4 ? 4 : Math.min(4, (i * 2 + k) % 5);
        const started = now - 86400 * (k * 2 + i % 3) - 600;
        const a = await run(`INSERT INTO attempts(user_id, test_id, kind, status, total, correct_count, score_percent, instant_feedback, started_at, finished_at, chat_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [uid, t1, 'normal', 'finished', total, correct, Math.round((1000 * correct) / total) / 10, 1, started, started + 300 + i * 40, uid]);
        for (let idx = 0; idx < total; idx++) {
          const snap = { t: Q[idx][0], img: null, o: Q[idx][1], c: Q[idx][2], e: Q[idx][3], m: Q[idx][1].map((_, j) => j) };
          const ok = idx < correct;
          const chosen = ok ? snap.c : (snap.c + 1) % snap.o.length;
          await run(`INSERT INTO attempt_questions(attempt_id, idx, question_id, snapshot, chosen, chosen_orig, is_correct, answered_at) VALUES(?,?,?,?,?,?,?,?)`,
            [a.lastInsertId, idx, idx + 1, JSON.stringify(snap), chosen, chosen, ok ? 1 : 0, started + 30 * (idx + 1)]);
        }
      }
    }
  })().catch((e) => console.error('seed xatosi', e));
}
