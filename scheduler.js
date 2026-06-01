const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const { randomDelay, isWeekend, isMoatzash } = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://hnkiqwgkmtpirykydkrb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const PROMPTS_FILE = './prompts.json';
const LOVABLE_URL = process.env.LOVABLE_URL || 'https://betongameraffle.lovable.app';
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
  var promptTemplate = (config.prompts && config.prompts[type]) || ('אתה ' + (config.agentName || 'אסי') + ', כותב הודעות שיווקיות לקהילת שחקנים. כתוב הודעה קצרה. סיים עם wa.me/972' + (config.agentPhone || '547554270'));
  var prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'אסי')
    .replace(/{agentPhone}/g, config.agentPhone || '525151129')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);
  try {
    var res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=' + GEMINI_API_KEY,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024, temperature: 0.8 } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    return res.data.candidates[0].content.parts[0].text;
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

// ── שלוף הגרלות נעולות מ-Supabase ──
async function getTodayLockedRaffles() {
  try {
    var res = await axios.get(LOVABLE_URL + '/api/public/bot/raffles?locked=true', {
      headers: { 'X-Bot-Secret': BOT_SECRET }
    });
    return res.data || [];
  } catch(err) {
    console.error('❌ שגיאה בשליפת הגרלות נעולות:', err.message);
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
  try {
    var res = await axios.get(LOVABLE_URL + '/api/public/bot/results', {
      headers: { 'X-Bot-Secret': BOT_SECRET }
    });
    return res.data || [];
  } catch(err) {
    console.error('❌ שגיאה בשליפת תוצאות:', err.message);
    return [];
  }
}

// ── שלח הגרלה לקהילה ──
async function sendRaffle(raffle) {
  try {
    if (raffle.image_url) {
      var sent = await axios.post(SERVER_URL + '/api/sendImage', {
        chatId: GROUP_ID,
        url: raffle.image_url,
        caption: raffle.raffle_text || '',
        raffleId: raffle.id
      });
    } else {
      var sent = await axios.post(SERVER_URL + '/api/sendTextWithId', {
        chatId: GROUP_ID,
        content: raffle.raffle_text || '',
        raffleId: raffle.id
      });
    }
    console.log('✅ הגרלה נשלחה: ' + raffle.match_title);
    return true;
  } catch(err) {
    console.error('❌ שגיאה בשליחת הגרלה:', err.message);
    return false;
  }
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



// ── 15:00 — הודעת אחה"צ ──
cron.schedule('0 15 * * *', async function() {
  console.log('⏰ 15:00');
  var msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 18:00 — שלח הגרלות מ-Supabase + הודעת ערב ──
cron.schedule('0 18 * * *', async function() {
  console.log('⏰ 18:00');
  if (!isShabbat()) {
    try {
      var raffles = await getTodayLockedRaffles();
      if (raffles.length) {
        console.log('📤 שולח ' + raffles.length + ' הגרלות נעולות מ-Supabase');
        for (var i = 0; i < raffles.length; i++) {
          await sendRaffle(raffles[i]);
          if (i < raffles.length - 1) {
            await new Promise(function(r) { setTimeout(r, 3 * 60 * 1000); });
          }
        }
        setTimeout(async function() {
          var afterMsg = await generateMessage('afterRaffle');
          await sendText(afterMsg);
        }, 2 * 60 * 1000);
      } else {
        console.log('אין הגרלות נעולות להיום');
      }
    } catch(e) { console.error('שגיאה בשליחת הגרלות:', e.message); }
  }
  var msg = await generateMessage(isWeekend() ? 'weekend' : 'evening');
  await sendText(msg);
}, { timezone: 'Asia/Jerusalem' });

// ── 22:00 — הודעת לילה ──
cron.schedule('08 22 * * *', async function() {
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
