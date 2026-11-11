# Test boti (Telegram) + admin panel

Telegramda test topshirish boti va uni boshqarish uchun veb-panel. Bepul xizmatlarda ishlaydi:
**Netlify** (bot va panel), **Turso** (ma'lumotlar bazasi).

**Nimalar bor**
- Bot: fanlar va testlar ro'yxati, savollar (A/B/C/D tugmalar, rasmli savollar), mashq rejimi (har javobdan keyin izoh) va imtihon rejimi, vaqt chegarasi, xatolar ustida ishlash, reyting, natijalarim.
- Admin panel: Word (.docx) yoki .txt fayldan test yaratish (panel yoki bot orqali), javoblar kalitini tekshirish va muammoli savolni tuzatish, testni e'lon qilish yoki qoralamaga qaytarish, savollarni ko'rish va o'chirish.
- Natijalar, CSV, foydalanuvchilarni bloklash, e'lon yuborish va bot matnlari uchun API tayyor, lekin panelda hali ekranlari yo'q.

---

## Kerak bo'ladigan narsalar

| Nima | Nima uchun | Narxi |
|---|---|---|
| Telegram akkaunt | bot yaratish va admin bo'lish | bepul |
| GitHub akkaunt | kodni saqlash, Netlify shu yerdan oladi | bepul |
| Netlify akkaunt | bot va panel internetda ishlashi uchun | bepul |
| Turso akkaunt | testlar va natijalar saqlanadigan baza | bepul |
| Node.js 22 yoki yangiroq | faqat kompyuterda sinab ko'rish uchun (ixtiyoriy) | bepul |

Hech qanday `npm install` kerak emas — loyihada tashqi paketlar yo'q.

---

## O'rnatish: qadamma-qadam

### 1-qadam. Botni yaratish va o'zingizning ID raqamingizni bilish

1. Telegramda **@BotFather** ni oching.
2. `/newbot` yuboring. Bot nomini va `...bot` bilan tugaydigan username'ni yozing.
3. BotFather sizga **token** beradi (`123456789:AAH...` ko'rinishida). Uni yozib qo'ying. **Hech kimga ko'rsatmang.**
4. Telegramda **@userinfobot** ni oching va `/start` yuboring. U sizning **ID** raqamingizni aytadi (masalan `123456789`). Bu sizning admin ID'ingiz.

### 2-qadam. Bazani yaratish (Turso)

Turso saytida (turso.tech) ro'yxatdan o'ting, yangi baza yarating (nomi: `quizbot`). Keyin ikkita narsa kerak bo'ladi:

- **URL** — `libsql://quizbot-akkauntingiz.turso.io` ko'rinishida
- **Token** — uzun matn, `eyJ...` bilan boshlanadi

Saytdagi baza sahifasidan ikkalasini ham olish mumkin. Agar terminalda ishlashni xohlasangiz, Turso CLI bilan:

```bash
turso db create quizbot
turso db show quizbot --url
turso db tokens create quizbot
```

(Jadvallarni o'zingiz yaratmaysiz — bot birinchi ishga tushganda o'zi yaratadi.)

### 3-qadam. Kodni GitHub'ga yuklash

GitHub'da yangi **bo'sh** repozitoriy yarating (masalan `quizbot`, Private tanlang). Keyin kompyuteringizda loyiha papkasida terminalni oching va ketma-ket yozing (`SIZNING-LOGIN` o'rniga GitHub loginingizni yozing):

```bash
cd quizbot
git init
git add .
git commit -m "Test boti"
git branch -M main
git remote add origin https://github.com/SIZNING-LOGIN/quizbot.git
git push -u origin main
```

> `.env` fayli va `node_modules` papkasi `.gitignore` da turibdi — ular GitHub'ga ketmaydi.

### 4-qadam. Netlify'ga ulash

1. Netlify'da **Add new site → Import an existing project** ni bosing.
2. **GitHub** ni tanlang va `quizbot` repozitoriyingizni toping.
3. Sozlamalarga tegmang — hammasi `netlify.toml` faylidan o'zi o'qiladi.
4. **Deploy** ni bosishdan oldin (yoki keyin: *Site configuration → Environment variables*) quyidagi o'zgaruvchilarni kiriting:

| Nomi | Qiymati |
|---|---|
| `BOT_TOKEN` | BotFather bergan token |
| `ADMIN_IDS` | sizning ID'ingiz (bir nechta admin bo'lsa vergul bilan: `111,222`) |
| `TURSO_DATABASE_URL` | Turso URL |
| `TURSO_AUTH_TOKEN` | Turso token |
| `SETUP_KEY` | o'zingiz o'ylab topgan uzun parol (kamida 20 belgi) |

Ixtiyoriy: `STORAGE_CHAT_ID` (rasmlar saqlanadigan yopiq kanal ID'si; yozmasangiz birinchi adminning chati ishlatiladi), `SITE_URL` (o'z domeningiz bo'lsa), `TZ_OFFSET_HOURS` (standart: `5`, ya'ni O'zbekiston vaqti).

5. O'zgaruvchilarni qo'shgan bo'lsangiz, **Deploys → Trigger deploy → Deploy site** ni bosing va deploy tugashini kuting.
6. Netlify sizga sayt manzili beradi, masalan `https://nimadir-123.netlify.app`.

### 5-qadam. Botni "ulash" (bir marta)

Brauzerda quyidagi manzilni oching (o'z manzilingiz va `SETUP_KEY` ingiz bilan):

```
https://nimadir-123.netlify.app/api/setup?key=SIZNING_SETUP_KEY
```

Sahifada qatorlar chiqadi. Hammasi ✅ bo'lsa — tayyor. Agar ❌ bo'lsa, qator ichidagi xabar nima yetishmayotganini aytadi (masalan, qaysi o'zgaruvchi yo'q). Tuzatib, sahifani yangilang.

### 6-qadam. Tekshirish

1. Telegramda botingizga `/start` yuboring — menyu chiqishi kerak.
2. Admin sifatida `/panel` yuboring. Bot ikkita tugma beradi: **Telegram ichida ochish** va **Brauzerda ochish**. Brauzer havolasi 10 daqiqa amal qiladi va faqat bir marta ishlaydi — eskirsa, `/panel` ni qaytadan yuboring.
3. Panelda **Fayldan test yaratish** tugmasini bosing va birorta Word fayl yuklang.

---

## Fayldan test yaratish

Word (.docx) yoki .txt fayl **5 MB** gacha bo'lishi mumkin. Tuzilishi:

```
Test nomi
1-qism (1–100-savollar)

1. Savol matni?
A) birinchi variant
B) ikkinchi variant
C) uchinchi variant
D) to'rtinchi variant
Javob: C
Izoh: ixtiyoriy tushuntirish
```

To'g'ri javobni **uchta usuldan biri** bilan belgilang:
1. `Javob: C` qatori,
2. to'g'ri variant oxiriga `(To'g'ri javob)` deb yozish,
3. faqat to'g'ri variantni **qalin (bold)** qilib yozish.

Muhim:
- Fayl yuklangach, **hech narsa saqlanmaydi** — avval tekshirish ekrani chiqadi: javoblar kaliti (hamma savolning javobi bir qarashda), topilgan savollar soni va muammoli savollar. Muammoli savol (masalan, javob belgilanmagan yoki ikkita javob belgilangan) qizil bilan ko'rsatiladi. Uni doirachani bosib tuzatasiz yoki chiqarib tashlaysiz — shundan keyingina "Testni yaratish" tugmasi ochiladi.
- Sarlavhada "1–100-savollar" yoki "100 ta savol" deb yozilgan bo'lsa, bot topilgan savollar sonini shu raqam bilan solishtiradi va farq bo'lsa ogohlantiradi.
- Word ichidagi **rasmlar** o'qilmaydi — rasmli savollarni keyin panelda qo'shasiz. Jadval ichiga yozilgan savollar ham o'qilmaydi.
- Yaratilgan test **qoralama** bo'ladi (foydalanuvchilarga ko'rinmaydi). Tekshirib bo'lgach, panelda **E'lon qilish** ni bosing.
- Botga to'g'ridan-to'g'ri ham yuborish mumkin: admin sifatida faylni chatga tashlang (`/import` faqat yordam ko'rsatadi). Bot tayyor savollardan qoralama test yaratadi; muammoli savollar saqlanmaydi, ularni panel orqali import qilib tuzatasiz.

---

## Kompyuterda sinab ko'rish (ixtiyoriy)

Node.js versiyasini tekshiring (22 yoki yuqori bo'lishi kerak):

```bash
node -v
```

Avtomatik testlarni ishga tushirish:

```bash
npm test
```

Hammasi `pass` bo'lishi kerak, `fail 0`.

Panelni lokal ishga tushirish (soxta Telegram va vaqtinchalik baza bilan, internet va token kerak emas):

```bash
npm run dev
```

Keyin brauzerda `http://localhost:8787/dev/login` ni oching — panelga o'zi kiritadi. Server to'xtatilganda ma'lumotlar o'chadi.

---

## Muammolar va yechimlar

**`/api/setup` da "Kalit noto'g'ri"** — manzildagi `key=` qiymati Netlify'dagi `SETUP_KEY` bilan bir xil emas. O'zgaruvchini o'zgartirgan bo'lsangiz, saytni qayta deploy qiling.

**`/api/setup` da "Yetishmayapti: ..."** — ko'rsatilgan o'zgaruvchi Netlify'da kiritilmagan. Kiriting va qayta deploy qiling.

**Bot javob bermayapti** — `/api/setup` ni qayta oching, "Webhook holati" qatoridagi "oxirgi xato" matniga qarang.

**`/panel` da "Sayt manzili aniqlanmadi"** — `/api/setup` sahifasini bir marta oching (u manzilni saqlaydi) yoki `SITE_URL` o'zgaruvchisini kiriting.

**Panelga kirganda "Sessiya tugagan"** — havola eskirgan yoki ishlatib bo'lingan. Botda `/panel` ni qaytadan yuboring.

**Rasm yuklanmayapti** — rasmlar Telegram orqali saqlanadi. Admin botga kamida bir marta `/start` yuborgan bo'lishi kerak.

**Admin tugmasi ko'rinmayapti** — `ADMIN_IDS` da ID'ingiz borligini va u raqam ekanini (username emas) tekshiring.

---

## Loyiha tuzilishi

```
public/            admin panel (oddiy HTML/CSS/JS, qurish kerak emas)
netlify/functions/ bot webhook'i, panel API'si, o'rnatish sahifasi, har 5 daqiqada ishlaydigan tozalash
src/bot/           bot mantig'i va ekranlar
src/api/           admin API
src/lib/           Telegram, baza, docx o'qish, savollarni tahlil qilish
src/services/      testlar, urinishlar, foydalanuvchilar, import
tests/             avtomatik testlar
dev/               lokal ishga tushirish serveri
```

Vaqt chegarali testlarni yakunlash uchun Netlify har 5 daqiqada `cron` funksiyasini o'zi ishga tushiradi.
