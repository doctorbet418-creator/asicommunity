const cron = require('node-cron');
const axios = require('axios');
const {
  morningMessages, afterRaffleMessages,
  weekdayNoon, weekdayAfternoon, weekdayEvening,
  weekdayLateEvening, weekdayMidnight, lateNightMessages,
  veryLateNightMessages, weekendMessages, motzashMessages,
  getRandom, randomDelay, isWeekend, isMoatzash
} = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://hnkiqwgkmtpirykydkrb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhua2lxd2drbXRwaXJ5a3lka3JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ5MDI0NTEsImV4cCI6MjA2MDQ3ODQ1MX0.JTxtYlyVwHrJqAmO5nwPPuPCTvLfx4LTQaTUu8F6RWo';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// ── Set כדי לא לשלוח תוצאות פעמיים ──
const sentResults = new Set();

// ── האם עכשיו שבת? ──
function isShabbat() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

// ── שלח עם עיכוב אקראי ──
async function sendWithDelay(fn, maxMinutes = 10) {
  const delay = randomDelay(maxMinutes);
  await new Promise(resolve => setTimeout(resolve, delay));
  await fn();
}

// ── שלח הודעת טקסט ──
async function sendText(text) {
  if (isShabbat() && !isMoatzash()) {
    console.log('שבת — לא שולחים');
    return;
  }
  try {
    await axios.post(SERVER_URL + '/api/sendText', { chatId: GROUP_ID, content: text });
    console.log('הודעה נשלחה:', text.substring(0, 40) + '...');
  } catch (err) { console.error('שגיאה בשליחה:', err.message); }
}

// ── שלח הגרלה ושמור messageId ──
async function sendRaffle(raffle) {
  if (isShabbat() && !isMoatzash()) {
    console.log('שבת — לא שולחים הגרלות');
    return false;
  }
  try {
    if (raffle.image_url) {
      await axios.post(SERVER_URL + '/api/sendImage', {
        chatId: GROUP_ID,
        url: raffle.image_url,
        caption: raffle.raffle_text || '',
        raffleId: raffle.id
      });
    } else {
      await axios.post(SERVER_URL + '/api/sendTextWithId', {
        chatId: GROUP_ID,
        content: raffle.raffle_text || '',
        raffleId: raffle.id
      });
    }
    console.log('הגרלה נשלחה:', raffle.match_title);
    return true;
  } catch (err) {
    console.error('שגיאה בשליחת הגרלה:', err.message);
    return false;
  }
}

// ── שלח תוצאות לקבוצה ──
async function sendResults(raffle) {
  try {
    if (raffle.results_image_url) {
      await axios.post(SERVER_URL + '/api/sendImage', {
        chatId: GROUP_ID,
        url: raffle.results_image_url,
        caption: raffle.results || ''
      });
    } else if (raffle.results) {
      await axios.post(SERVER_URL + '/api/sendText', {
        chatId: GROUP_ID,
        content: raffle.results
      });
    }
    console.log('תוצאות נשלחו לקבוצה:', raffle.match_title);
  } catch (err) { console.error('שגיאה בשליחת תוצאות:', err.message); }
}

// ── שלוף הגרלות היום (רק נעולות) ──
async function getTodayRaffles() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const res = await axios.get(
      SUPABASE_URL + '/rest/v1/raffles?raffle_date=eq.' + today + '&locked=eq.true&order=created_at.asc',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error('שגיאה בשליפת הגרלות:', err.message);
    return [];
  }
}

// ── שלוף תוצאות אתמול ──
async function getYesterdayResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  try {
    const res = await axios.get(
      SUPABASE_URL + '/rest/v1/raffles?raffle_date=eq.' + dateStr + '&is_finished=eq.true&results=not.is.null',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error('שגיאה בשליפת תוצאות אתמול:', err.message);
    return [];
  }
}

// ══════════════════════════════════════
// ── כל 5 דקות — בדוק הגרלות שהסתיימו ──
// שולח תוצאות לקבוצה + זוכים לאסי
// ══════════════════════════════════════
cron.schedule('*/5 * * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await axios.get(
      SUPABASE_URL + '/rest/v1/raffles?raffle_date=eq.' + today + '&is_finished=eq.true&results=not.is.null',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const finished = Array.isArray(res.data) ? res.data : [];

    for (const raffle of finished) {
      if (sentResults.has(raffle.id)) continue;
      sentResults.add(raffle.id);
      console.log('הגרלה הסתיימה:', raffle.match_title);

      // 1. שלח תוצאות לקבוצה
      await sendResults(raffle);

      // 2. אחרי 2 דקות — חפש זוכים ושלח לאסי
      setTimeout(async () => {
        try {
          const { findWinners } = require('./winner-finder');
          const msgRes = await axios.get(SERVER_URL + '/api/getRaffleMessageId?raffleId=' + raffle.id);
          const messageId = msgRes.data.messageId;
          if (messageId) {
            await findWinners(raffle.id, messageId);
          } else {
            console.log('לא נמצא messageId להגרלה ' + raffle.id);
          }
        } catch (err) { console.error('שגיאה בחיפוש זוכים:', err.message); }
      }, 2 * 60 * 1000);
    }
  } catch (err) { console.error('שגיאה בבדיקת הגרלות שהסתיימו:', err.message); }
});

// ══════════════════════════════════════
// ── לוח הזמנים ──
// ══════════════════════════════════════

// 09:00 — תוצאות אתמול
cron.schedule('0 9 * * *', async () => {
  console.log('09:00 — תוצאות אתמול');
  const results = await getYesterdayResults();
  if (!results.length) { console.log('אין תוצאות אתמול'); return; }
  for (const r of results) {
    await sendResults(r);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}, { timezone: 'Asia/Jerusalem' });

// 10:00 — הודעת בוקר
cron.schedule('0 10 * * *', async () => {
  console.log('10:00 — הודעת בוקר');
  sendWithDelay(() => sendText(getRandom(morningMessages)));
}, { timezone: 'Asia/Jerusalem' });

// 12:00 — הודעת צהריים
cron.schedule('22 12 * * *', async () => {
  console.log('12:00 — הודעת צהריים');
  if (isMoatzash()) { sendWithDelay(() => sendText(getRandom(motzashMessages))); return; }
  const msg = isWeekend() ? getRandom(weekendMessages) : getRandom(weekdayNoon);
  sendWithDelay(() => sendText(msg));
}, { timezone: 'Asia/Jerusalem' });

// 15:00 — הודעת אחה"צ
cron.schedule('46 15 * * *', async () => {
  console.log('15:00 — הודעת אחה"צ');
  const msg = isWeekend() ? getRandom(weekendMessages) : getRandom(weekdayAfternoon);
  sendWithDelay(() => sendText(msg));
}, { timezone: 'Asia/Jerusalem' });

// 18:00 — הגרלה ראשונה + הודעת ערב
cron.schedule('0 18 * * *', async () => {
  console.log('18:00 — הגרלה ראשונה + הודעת ערב');

  if (!isShabbat()) {
    const raffles = await getTodayRaffles();
    if (raffles.length > 0) {
      const sent = await sendRaffle(raffles[0]);
      if (sent) {
        setTimeout(async () => {
          await sendText(getRandom(afterRaffleMessages));
        }, 60 * 60 * 1000);
      }
    } else {
      console.log('אין הגרלות נעולות ל-18:00');
    }
  }

  const msg = isWeekend() ? getRandom(weekendMessages) : getRandom(weekdayEvening);
  sendWithDelay(() => sendText(msg));
}, { timezone: 'Asia/Jerusalem' });

// 20:00 — הגרלה שנייה / מוצאי שבת
cron.schedule('0 20 * * *', async () => {
  console.log('20:00 — הגרלה שנייה / מוצאי שבת');

  if (isMoatzash()) {
    sendWithDelay(() => sendText(getRandom(motzashMessages)));
    return;
  }

  if (!isShabbat()) {
    const raffles = await getTodayRaffles();
    if (raffles.length > 1) {
      const sent = await sendRaffle(raffles[1]);
      if (sent) {
        setTimeout(async () => {
          await sendText(getRandom(afterRaffleMessages));
        }, 60 * 60 * 1000);
      }
    } else {
      console.log('אין הגרלה שנייה ל-20:00');
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// 22:00 — הודעת לילה
cron.schedule('0 22 * * *', async () => {
  console.log('22:00 — הודעת לילה');
  const msg = isWeekend() ? getRandom(weekendMessages) : getRandom(weekdayLateEvening);
  sendWithDelay(() => sendText(msg));
}, { timezone: 'Asia/Jerusalem' });

// 00:00 — הודעת חצות
cron.schedule('0 0 * * *', async () => {
  console.log('00:00 — הודעת חצות');
  const msg = isWeekend() ? getRandom(weekendMessages) : getRandom(weekdayMidnight);
  sendWithDelay(() => sendText(msg));
}, { timezone: 'Asia/Jerusalem' });

// 01:00 — לילה מאוחר
cron.schedule('0 1 * * *', async () => {
  console.log('01:00 — לילה מאוחר');
  sendWithDelay(() => sendText(getRandom(lateNightMessages)));
}, { timezone: 'Asia/Jerusalem' });

// 02:00 — שעתיים לפנות בוקר
cron.schedule('0 2 * * *', async () => {
  console.log('02:00 — שעתיים לפנות בוקר');
  sendWithDelay(() => sendText(getRandom(veryLateNightMessages)));
}, { timezone: 'Asia/Jerusalem' });

console.log('תזמון אוטומטי פעיל — שעון ישראל');
