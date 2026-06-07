const cron = require('node-cron');
const axios = require('axios');
const { isWeekend, isMoatzash, getRandom } = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://hnkiqwgkmtpirykydkrb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhua2lxd2drbXRwaXJ5a3lka3JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ5MDI0NTEsImV4cCI6MjA2MDQ3ODQ1MX0.JTxtYlyVwHrJqAmO5nwPPuPCTvLfx4LTQaTUu8F6RWo';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PROMPTS_FILE = './prompts.json';
const fs = require('fs');

// ── הגדרות Gemini — שנה כאן לפי הצורך ──
const GEMINI_MAX_TOKENS = 8192;  // אפשר להגדיל עד 8192
const GEMINI_TEMPERATURE = 0.8;
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];

// ── Set כדי לא לשלוח תוצאות פעמיים ──
const sentResults = new Set();

// ── טעינת פרומפטים מהפאנל ──
function loadPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
  } catch(e) {}
  return {};
}

// ── האם עכשיו שבת? ──
function isShabbat() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

// ── יצירת הודעה עם Gemini (מחובר לפרומפטים ולפאנל) ──
async function generateMessage(type) {
  const config = loadPrompts();
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[new Date().getDay()];
  const day = new Date().getDay();

  const br = config.bonusRules || {};
  let bonusInstruction = 'אין בונוס מיוחד היום.';
  if (day === 1 || day === 3) bonusInstruction = 'היום יש ' + (br.monday_wednesday || '30% הפקדה לא מקוזז') + '. הזכר פעם אחת בלבד בערב.';
  if (day === 2 || day === 4) bonusInstruction = 'היום יש ' + (br.tuesday_thursday || '100% קזינו ו-50% ספורט') + '. הזכר פעם אחת בלבד בערב.';
  if (day === 4 || day === 5) bonusInstruction = 'סופ"ש! שווק: ' + (br.weekend || '100% קזינו ו-50% ספורט') + ' לא מקוזז!';

  const promptTemplate = (config.prompts && config.prompts[type]) ||
    ('אתה ' + (config.agentName || 'אסי') + ', כותב הודעות שיווקיות קצרות לקהילת שחקנים. כתוב הודעה של 3-4 שורות בלבד. סיים עם wa.me/972' + (config.agentPhone || '525151129'));

  const prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'אסי')
    .replace(/{agentPhone}/g, config.agentPhone || '525151129')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);

  // ── נסה Gemini ──
  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.post(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY,
          { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS, temperature: GEMINI_TEMPERATURE } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 90000 }
        );
        console.log('הודעה נוצרה עם ' + model);
        return res.data.candidates[0].content.parts[0].text;
      } catch(err) {
        console.error(model + ' ניסיון ' + attempt + ' נכשל:', err.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000));
      }
    }
  }

  // ── Fallback: OpenAI ──
  if (OPENAI_API_KEY) {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: GEMINI_MAX_TOKENS, temperature: GEMINI_TEMPERATURE },
        { headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      console.log('הודעה נוצרה עם OpenAI (fallback)');
      return res.data.choices[0].message.content;
    } catch(err) { console.error('OpenAI נכשל:', err.message); }
  }

  console.error('כל ה-AI נכשלו');
  return null;
}

// ── שלח הודעת טקסט ──
async function sendText(text) {
  if (isShabbat() && !isMoatzash()) {
    console.log('שבת — לא שולחים');
    return;
  }
  if (!text) return;
  try {
    await axios.post(SERVER_URL + '/api/sendText', { chatId: GROUP_ID, content: text });
    console.log('הודעה נשלחה:', text.substring(0, 40) + '...');
  } catch (err) { console.error('שגיאה בשליחה:', err.message); }
}

// ── שלח הגרלה ──
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
      await sendResults(raffle);
      setTimeout(async () => {
        try {
          const { findWinners } = require('./winner-finder');
          const msgRes = await axios.get(SERVER_URL + '/api/getRaffleMessageId?raffleId=' + raffle.id);
          const messageId = msgRes.data.messageId;
          if (messageId) await findWinners(raffle.id, messageId);
          else console.log('לא נמצא messageId להגרלה ' + raffle.id);
        } catch (err) { console.error('שגיאה בחיפוש זוכים:', err.message); }
      }, 2 * 60 * 1000);
    }
  } catch (err) { console.error('שגיאה בבדיקת הגרלות שהסתיימו:', err.message); }
});

// ══════════════════════════════════════
// ── לוח הזמנים — כל ההודעות דרך הפאנל ──
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
  const msg = await generateMessage(isWeekend() ? 'weekend' : 'morning');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// 12:00 — הודעת צהריים
cron.schedule('22 12 * * *', async () => {
  console.log('12:00 — הודעת צהריים');
  const type = isMoatzash() ? 'motzash' : isWeekend() ? 'weekend' : 'noon';
  const msg = await generateMessage(type);
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// 15:00 — הודעת אחה"צ
cron.schedule('46 15 * * *', async () => {
  console.log('15:00 — הודעת אחה"צ');
  const msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon');
  await sendText(msg);
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
          const afterMsg = await generateMessage('afterRaffle');
          await sendText(afterMsg);
        }, 60 * 60 * 1000);
      }
    } else {
      console.log('אין הגרלות נעולות ל-18:00');
    }
  }
  const msg = await generateMessage(isWeekend() ? 'weekend' : 'evening');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// 20:00 — הגרלה שנייה / מוצאי שבת
cron.schedule('0 20 * * *', async () => {
  console.log('20:00 — הגרלה שנייה / מוצאי שבת');
  if (isMoatzash()) {
    const msg = await generateMessage('motzash');
    await sendText(msg);
    return;
  }
  if (!isShabbat()) {
    const raffles = await getTodayRaffles();
    if (raffles.length > 1) {
      const sent = await sendRaffle(raffles[1]);
      if (sent) {
        setTimeout(async () => {
          const afterMsg = await generateMessage('afterRaffle');
          await sendText(afterMsg);
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
  const msg = await generateMessage(isWeekend() ? 'weekend' : 'lateEvening');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// 00:00 — הודעת חצות
cron.schedule('0 0 * * *', async () => {
  console.log('00:00 — הודעת חצות');
  const msg = await generateMessage('midnight');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// 01:00 — לילה מאוחר
cron.schedule('0 1 * * *', async () => {
  console.log('01:00 — לילה מאוחר');
  const msg = await generateMessage('lateNight');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// 02:00 — שעתיים לפנות בוקר
cron.schedule('0 2 * * *', async () => {
  console.log('02:00 — שעתיים לפנות בוקר');
  const msg = await generateMessage('veryLateNight');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

console.log('תזמון אוטומטי פעיל — שעון ישראל');
