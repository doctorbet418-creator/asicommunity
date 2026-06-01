const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const { randomDelay, isWeekend, isMoatzash } = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://oxraakhcpvthlvjvapay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cmFha2hjcHZ0aGx2anZhcGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzY4MTUsImV4cCI6MjA5MzY1MjgxNX0.dftK8Qb9zjzwEVGRLv4Q54Pqn2SLrzOxUqydIYf3Xd8';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const PROMPTS_FILE = './prompts.json';
const LOVABLE_URL = process.env.LOVABLE_URL || 'https://id-preview--82197b76-973a-461d-86d9-6790e471f6b6.lovable.app';
const BOT_SECRET = process.env.BOT_WEBHOOK_SECRET || '';
const TEMPLATE_HISTORY_FILE = './template_history.json';

function loadPrompts() {
  try { if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch(e) {}
  return {};
}

function loadTemplateHistory() {
  try { if (fs.existsSync(TEMPLATE_HISTORY_FILE)) return JSON.parse(fs.readFileSync(TEMPLATE_HISTORY_FILE, 'utf8')); } catch(e) {}
  return { lastVariant: -1, lastQuestionCount: 0, lastTwoRaffles: false };
}

function saveTemplateHistory(data) {
  fs.writeFileSync(TEMPLATE_HISTORY_FILE, JSON.stringify(data, null, 2));
}

function chooseTemplate(history) {
  var rotations = [
    { variant: 0, questionCount: 1 },
    { variant: 1, questionCount: 2 },
    { variant: 0, questionCount: 1 },
    { variant: 2, questionCount: 3 },
    { variant: 1, questionCount: 2 },
    { variant: 0, questionCount: 1 },
  ];
  for (var i = 0; i < rotations.length; i++) {
    var r = rotations[i];
    if (r.variant !== history.lastVariant || r.questionCount !== history.lastQuestionCount) return r;
  }
  return { variant: 0, questionCount: 1 };
}

function shouldSendTwoRaffles(history) {
  if (history.lastTwoRaffles) return false;
  return Math.random() < 0.3;
}

function isShabbat() {
  var now = new Date();
  var day = now.getDay();
  var hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

function getTodayBonus() {
  var day = new Date().getDay();
  if (day === 1 || day === 3) return '30deposit';
  if (day === 2 || day === 4) return '100casino';
  if (day === 4 || day === 5) return 'weekend';
  return 'none';
}

// ── יצירת הודעה עם Gemini ──
async function generateMessage(type) {
  var config = loadPrompts();
  var dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var dayName = dayNames[new Date().getDay()];
  var bonus = getTodayBonus();
  var br = config.bonusRules || {};

  var bonusInstruction = 'אין בונוס מיוחד היום.';
  if (bonus === '30deposit') bonusInstruction = 'היום יש ' + (br.monday_wednesday || '30% הפקדה לא מקוזז') + '. הזכר פעם אחת בלבד בערב.';
  if (bonus === '100casino') bonusInstruction = 'היום יש ' + (br.tuesday_thursday || '100% קזינו ו-50% ספורט') + '. הזכר פעם אחת בלבד בערב.';
  if (bonus === 'weekend') bonusInstruction = 'סופ"ש! שווק: ' + (br.weekend || '100% קזינו ו-50% ספורט') + ' לא מקוזז!';

  var promptTemplate = (config.prompts && config.prompts[type]) || ('אתה ' + (config.agentName || 'אסי') + ', כותב הודעות שיווקיות לקהילת בידור. כתוב הודעה קצרה לקהילה. סיים עם wa.me/972' + (config.agentPhone || '547554270'));
  var prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'אסי')
    .replace(/{agentPhone}/g, config.agentPhone || '547554270')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);

  try {
    var res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 10000, temperature: 0.8 }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    var text = res.data.candidates[0].content.parts[0].text;
    return text;
  } catch(err) {
    console.error('❌ שגיאה ב-Gemini:', err.message);
    return null;
  }
}

async function sendText(text) {
  if (isShabbat() && !isMoatzash()) { console.log('🕌 שבת'); return; }
  if (!text) return;
  try {
    await axios.post(SERVER_URL + '/api/sendText', { chatId: GROUP_ID, content: text });
    console.log('✅ נשלח:', text.substring(0, 40) + '...');
  } catch(err) { console.error('❌ שגיאה:', err.message); }
}

async function getOpenRaffles() {
  try {
    var res = await axios.get(LOVABLE_URL + '/api/public/bot/raffles?locked=false', {
      headers: { 'X-Bot-Secret': BOT_SECRET }
    });
    return res.data || [];
  } catch(err) {
    console.error('❌ שגיאה בשליפת הגרלות:', err.message);
    return [];
  }
}

async function setTemplate(raffleId, variant, questionCount) {
  try {
    await axios.post(LOVABLE_URL + '/api/public/bot/template', {
      raffleId: raffleId, variant: variant, questionCount: questionCount
    }, { headers: { 'X-Bot-Secret': BOT_SECRET, 'Content-Type': 'application/json' } });
    console.log('✅ תבנית: variant=' + variant + ', questions=' + questionCount);
    return true;
  } catch(err) { console.error('❌ שגיאה בתבנית:', err.message); return false; }
}

async function lockRaffle(raffleId) {
  try {
    await axios.post(LOVABLE_URL + '/api/public/bot/lock', {
      raffleId: raffleId
    }, { headers: { 'X-Bot-Secret': BOT_SECRET, 'Content-Type': 'application/json' } });
    console.log('✅ ננעלה: ' + raffleId);
    return true;
  } catch(err) { console.error('❌ שגיאה בנעילה:', err.message); return false; }
}

async function getYesterdayResults() {
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var dateStr = yesterday.toISOString().split('T')[0];
  var res = await axios.get(SUPABASE_URL + '/rest/v1/raffles?raffle_date=eq.' + dateStr + '&results=not.is.null&is_finished=eq.true', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  return res.data;
}

// ── 09:00 — תוצאות אתמול ──
cron.schedule('0 9 * * *', async function() {
  console.log('⏰ 09:00');
  try {
    var results = await getYesterdayResults();
    for (var i = 0; i < results.length; i++) {
      if (results[i].results) {
        await axios.post(SERVER_URL + '/api/sendText', { chatId: GROUP_ID, content: results[i].results });
      }
      await new Promise(function(r) { setTimeout(r, 3000); });
    }
  } catch(e) { console.error('שגיאה:', e.message); }
}, { timezone: 'Asia/Jerusalem' });

// ── 10:00 — הודעת בוקר ──
cron.schedule('0 10 * * *', async function() {
  console.log('⏰ 10:00');
  var msg = await generateMessage(isWeekend() ? 'weekend' : 'morning');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 12:00 — הודעת צהריים ──
cron.schedule('0 12 * * *', async function() {
  console.log('⏰ 12:00');
  var type = isMoatzash() ? 'motzash' : isWeekend() ? 'weekend' : 'noon';
  var msg = await generateMessage(type);
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 14:30 — נעל הגרלות ──
cron.schedule('30 14 * * *', async function() {
  console.log('⏰ 14:30 — נועל הגרלות...');
  if (isShabbat() || isMoatzash()) { console.log('שבת/מוצ"ש — לא נועל'); return; }
  try {
    var history = loadTemplateHistory();
    var raffles = await getOpenRaffles();
    if (!raffles.length) { console.log('אין הגרלות פתוחות'); return; }
    var twoRaffles = shouldSendTwoRaffles(history);
    console.log('📋 היום ' + (twoRaffles ? '2 הגרלות' : 'הגרלה אחת'));
    if (twoRaffles && raffles.length >= 2) {
      var football = null, basketball = null;
      for (var i = 0; i < raffles.length; i++) {
        if (raffles[i].sport === 'football' && !football) football = raffles[i];
        else if (raffles[i].sport === 'basketball' && !basketball) basketball = raffles[i];
      }
      if (!football) football = raffles[0];
      if (!basketball) basketball = raffles[1];
      var t1 = chooseTemplate(history);
      await setTemplate(football.id, t1.variant, t1.questionCount);
      await lockRaffle(football.id);
      var t2 = chooseTemplate({ lastVariant: t1.variant, lastQuestionCount: t1.questionCount, lastTwoRaffles: false });
      await setTemplate(basketball.id, t2.variant, t2.questionCount);
      await lockRaffle(basketball.id);
      saveTemplateHistory({ lastVariant: t2.variant, lastQuestionCount: t2.questionCount, lastTwoRaffles: true });
    } else {
      var raffle = raffles[Math.floor(Math.random() * raffles.length)];
      var t = chooseTemplate(history);
      await setTemplate(raffle.id, t.variant, t.questionCount);
      await lockRaffle(raffle.id);
      saveTemplateHistory({ lastVariant: t.variant, lastQuestionCount: t.questionCount, lastTwoRaffles: false });
    }
  } catch(e) { console.error('❌ שגיאה בנעילה:', e.message); }
}, { timezone: 'Asia/Jerusalem' });

// ── 15:00 — הודעת אחה"צ ──
cron.schedule('0 15 * * *', async function() {
  console.log('⏰ 15:00');
  var msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 18:00 — שלח הגרלות ממתינות + הודעת ערב ──
cron.schedule('0 18 * * *', async function() {
  console.log('⏰ 18:00');
  if (!isShabbat()) {
    try {
      var serverModule = require('./server');
      if (serverModule.sendAllPendingRaffles) await serverModule.sendAllPendingRaffles();
    } catch(e) { console.error('שגיאה בשליחת הגרלות:', e.message); }
  }
  var msg = await generateMessage(isWeekend() ? 'weekend' : 'evening');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 22:00 — הודעת לילה ──
cron.schedule('47 23 * * *', async function() {
  console.log('⏰ 22:00');
  var msg = await generateMessage(isWeekend() ? 'weekend' : 'lateEvening');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 00:00 — הודעת חצות ──
cron.schedule('0 0 * * *', async function() {
  console.log('⏰ 00:00');
  var msg = await generateMessage('midnight');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 01:00 — לילה מאוחר ──
cron.schedule('0 1 * * *', async function() {
  console.log('⏰ 01:00');
  var msg = await generateMessage('lateNight');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 02:00 — שעתיים לפנות בוקר ──
cron.schedule('0 2 * * *', async function() {
  console.log('⏰ 02:00');
  var msg = await generateMessage('veryLateNight');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

console.log('📅 תזמון אוטומטי פעיל — שעון ישראל');
