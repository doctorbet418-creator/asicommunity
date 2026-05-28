const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const { randomDelay, isWeekend, isMoatzash } = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://oxraakhcpvthlvjvapay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cmFha2hjcHZ0aGx2anZhcGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzY4MTUsImV4cCI6MjA5MzY1MjgxNX0.dftK8Qb9zjzwEVGRLv4Q54Pqn2SLrzOxUqydIYf3Xd8';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PROMPTS_FILE = './prompts.json';

function isShabbat() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

function getTodayBonus() {
  const day = new Date().getDay();
  if (day === 1 || day === 3) return '30deposit';
  if (day === 2 || day === 4) return '100casino';
  if (day === 4 || day === 5) return 'weekend';
  return 'none';
}

// ── טעינת פרומפטים מהפאנל ──
function loadPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
  } catch(e) {}
  return getDefaultPrompts();
}

function getDefaultPrompts() {
  return {
    agentName: 'רובי',
    agentPhone: '972547554270',
    baseRules: `כתוב בסגנון חברותי וישיר כמו חבר שכותב לחברים
אסור להשתמש במקפים ארוכים (—) בכלל
אסור לכתוב סכומים מדויקים של בונוסים אלא אם צוין במפורש
תזכור שאתה סוכן הימורים של קזינו אונליין והימורי ספורט
אל תגזים, תהיה טבעי`,
    bonusRules: {
      monday_wednesday: 'בונוס הפקדה 30% לא מקוזז',
      tuesday_thursday: 'בונוס 100% קזינו ו-50% ספורט',
      weekend: '100% קזינו ו-50% ספורט'
    },
    prompts: {
      morning: `אתה {agentName}, סוכן הימורים ספורט וקזינו ישראלי עם קהילת VIP בוואטסאפ.
כתוב הודעת בוקר לקהילה. יום: {day}.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
אורך: 3-4 שורות. אל תתחיל עם "בוקר טוב" כל פעם.
אל תזכיר בונוסים בבוקר.`,

      noon: `אתה {agentName}, סוכן הימורים קזינו וספורט ישראלי.
כתוב הודעת צהריים לקהילה. יום: {day}.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
הזכר לפעמים שהמחלקה הפיננסית פתוחה עד 18:00.
אורך: 2-4 שורות. אל תזכיר בונוסים.`,

      afternoon: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת אחר צהריים לקהילה. יום: {day}.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
דבר על המשחקים של הערב. אורך: 3-4 שורות.`,

      evening: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת ערב לקהילה. יום: {day}.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
{bonusInstruction}
אורך: 3-5 שורות.`,

      lateEvening: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת לילה (22:00) לקהילה. יום: {day}.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
דבר על קזינו, NBA, משחקי לילה. אורך: 3-4 שורות.`,

      midnight: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת חצות לקהילה.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
{agentName} ער 24/6. קצר, 2-3 שורות.`,

      lateNight: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת 01:00 לקהילה.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
שעות קטנות, {agentName} עדיין כאן. 2-3 שורות.`,

      veryLateNight: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת 02:00 לקהילה.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
שעתיים לפנות בוקר. קצר, 2 שורות.`,

      weekend: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת סופ"ש לקהילה. יום: {day}.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
סופ"ש! שווק: 100% קזינו ו-50% ספורט. 3-5 שורות.`,

      motzash: `אתה {agentName}, סוכן הימורים קזינו וספורט.
כתוב הודעת מוצאי שבת לקהילה.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
שבת יצאה, חוזרים לאקשן! 3-4 שורות.`,

      afterRaffle: `אתה {agentName}, סוכן הימורים קזינו וספורט.
הרגע שלחת הגרלה. כתוב הודעת עידוד להשתתפות.
{baseRules}
סיים עם: wa.me/972{agentPhone} וה{agentName}
עודד להגיב עם ניחוש. 2-3 שורות.`,
    }
  };
}

async function generateMessage(type) {
  const config = loadPrompts();
  const now = new Date();
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[now.getDay()];
  const bonus = getTodayBonus();

  let bonusInstruction = 'אין בונוס מיוחד היום, שמור על טבעי ומעניין.';
  if (bonus === '30deposit') bonusInstruction = `היום יש ${config.bonusRules?.monday_wednesday || 'בונוס הפקדה 30%'}. הזכר פעם אחת בלבד.`;
  if (bonus === '100casino') bonusInstruction = `היום יש ${config.bonusRules?.tuesday_thursday || 'בונוס 100% קזינו ו-50% ספורט'}. הזכר פעם אחת בלבד.`;
  if (bonus === 'weekend') bonusInstruction = `${config.bonusRules?.weekend || '100% קזינו ו-50% ספורט'} — שווק בחזקה!`;

  const promptTemplate = config.prompts?.[type] || config.prompts?.morning || '';
  const prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'רובי')
    .replace(/{agentPhone}/g, config.agentPhone || '547554270')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    });
    return res.data.content[0].text;
  } catch (err) {
    console.error('❌ שגיאה ב-AI:', err.message);
    return null;
  }
}

async function sendWithDelay(fn, maxMinutes = 10) {
  const delay = randomDelay(maxMinutes);
  await new Promise(resolve => setTimeout(resolve, delay));
  await fn();
}

async function sendText(text) {
  if (isShabbat() && !isMoatzash()) { console.log('🕌 שבת'); return; }
  if (!text) return;
  try {
    await axios.post(`${SERVER_URL}/api/sendText`, { chatId: GROUP_ID, content: text });
    console.log('✅ נשלח:', text.substring(0, 40) + '...');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

async function sendRaffle(raffle) {
  if (isShabbat() && !isMoatzash()) return false;
  try {
    if (raffle.image_url) {
      await axios.post(`${SERVER_URL}/api/sendImage`, { chatId: GROUP_ID, url: raffle.image_url, caption: raffle.raffle_text || '', raffleId: raffle.id });
    } else {
      await axios.post(`${SERVER_URL}/api/sendTextWithId`, { chatId: GROUP_ID, content: raffle.raffle_text || '', raffleId: raffle.id });
    }
    console.log('✅ הגרלה נשלחה:', raffle.match_title);
    watchRaffleForFinish(raffle.id);
    return true;
  } catch (err) { console.error('❌ שגיאה:', err.message); return false; }
}

async function sendResults(raffle) {
  try {
    if (raffle.results_image_url) {
      await axios.post(`${SERVER_URL}/api/sendImage`, { chatId: GROUP_ID, url: raffle.results_image_url, caption: raffle.results || '' });
    } else {
      await axios.post(`${SERVER_URL}/api/sendText`, { chatId: GROUP_ID, content: raffle.results || '' });
    }
    console.log('✅ תוצאות נשלחו');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

function watchRaffleForFinish(raffleId) {
  const checkInterval = setInterval(async () => {
    try {
      const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?id=eq.${raffleId}&select=is_finished,results`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
      const raffle = res.data[0];
      if (raffle?.is_finished && raffle?.results) {
        clearInterval(checkInterval);
        setTimeout(async () => {
          try {
            const { findWinners } = require('./winner-finder');
            const msgRes = await axios.get(`${SERVER_URL}/api/getRaffleMessageId?raffleId=${raffleId}`);
            if (msgRes.data.messageId) await findWinners(raffleId, msgRes.data.messageId);
          } catch (err) { console.error('שגיאה בזוכים:', err.message); }
        }, 2 * 60 * 1000);
      }
    } catch (err) { console.error('שגיאה:', err.message); }
  }, 5 * 60 * 1000);
  setTimeout(() => clearInterval(checkInterval), 12 * 60 * 60 * 1000);
}

async function getTodayRaffles() {
  const today = new Date().toISOString().split('T')[0];
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?raffle_date=eq.${today}&locked=eq.true&order=created_at.asc`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  return res.data;
}

async function getYesterdayResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?raffle_date=eq.${yesterday.toISOString().split('T')[0]}&results=not.is.null&is_finished=eq.true`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  return res.data;
}

cron.schedule('0 9 * * *', async () => {
  const results = await getYesterdayResults();
  for (const r of results) { await sendResults(r); await new Promise(res => setTimeout(res, 3000)); }
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 10 * * *', async () => {
  console.log('⏰ 10:00'); await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'morning'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 11 * * *', async () => {
  console.log('⏰ 11:00');
  const raffles = await getTodayRaffles();
  if (raffles.length > 0) {
    const sent = await sendRaffle(raffles[0]);
    if (sent) setTimeout(async () => { const msg = await generateMessage('afterRaffle'); await sendText(msg); }, 60 * 60 * 1000);
  }
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 12 * * *', async () => {
  console.log('⏰ 12:00'); await sendWithDelay(async () => { const type = isMoatzash() ? 'motzash' : isWeekend() ? 'weekend' : 'noon'; const msg = await generateMessage(type); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('33 14 * * *', async () => {
  console.log('⏰ 15:00'); await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 18 * * *', async () => {
  console.log('⏰ 18:00'); await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'evening'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 20 * * *', async () => {
  console.log('⏰ 20:00');
  if (isMoatzash()) { await sendWithDelay(async () => { const msg = await generateMessage('motzash'); await sendText(msg); }); return; }
  const raffles = await getTodayRaffles();
  if (raffles.length > 1) {
    const sent = await sendRaffle(raffles[1]);
    if (sent) setTimeout(async () => { const msg = await generateMessage('afterRaffle'); await sendText(msg); }, 60 * 60 * 1000);
  }
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 22 * * *', async () => {
  console.log('⏰ 22:00'); await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'lateEvening'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 0 * * *', async () => {
  console.log('⏰ 00:00'); await sendWithDelay(async () => { const msg = await generateMessage('midnight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 1 * * *', async () => {
  console.log('⏰ 01:00'); await sendWithDelay(async () => { const msg = await generateMessage('lateNight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 2 * * *', async () => {
  console.log('⏰ 02:00'); await sendWithDelay(async () => { const msg = await generateMessage('veryLateNight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

console.log('📅 תזמון אוטומטי פעיל — שעון ישראל');
