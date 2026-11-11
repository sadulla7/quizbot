// Har 5 daqiqada: vaqti tugagan testlarni yakunlash va eski ma'lumotlarni tozalash.
import { ensureSchema } from '../../src/lib/schema.mjs';
import { expireAttempt } from '../../src/bot/handlers.mjs';
import * as A from '../../src/services/attempts.mjs';

export default async () => {
  await ensureSchema();
  let expired = 0;
  for (const a of await A.expiredActive(40)) {
    try {
      if (await expireAttempt(a)) expired++;
    } catch (e) {
      console.error('[cron] urinish', a.id, e?.stack || e);
    }
  }
  const c = await A.cleanup();
  console.log(`[cron] yakunlangan: ${expired}, tashlab ketilgan: ${c.abandoned}`);
};

export const config = { schedule: '*/5 * * * *' };
