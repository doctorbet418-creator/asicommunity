const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || '';
const WHAPI_URL = 'https://gate.whapi.cloud';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET || '';
const raffleMessages = {};
const PROMPTS_FILE = './prompts.json';

// ── שמירת הגרלות שננעלו וממתינות לשליחה ──
const pendingRaffles = []; // [{raffle, text, imageUrl, lockedAt}]

function loadPrompts() {
  try { if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch(e) {}
  return {};
}
function savePrompts(data) { fs.writeFileSync(PROMPTS_FILE, JSON.stringify(data, null, 2)); }

async function generateMessage(type, config) {
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[new Date().getDay()];
  const bonusMap = {
    morning: 'אין בונוס בבוקר',
    noon: 'אין בונוס בצהריים',
    afternoon: 'אין בונוס אחה"צ',
    evening: 'יש בונוס ערב: ' + (config.bonusRules && config.bonusRules.monday_wednesday || '30% הפקדה'),
    lateEvening: '70% קזינו 40% ספורט לשעות הלילה',
    midnight: 'קזינו פתוח 24/6',
    lateNight: 'ציפורי לילה מרוויחות יותר',
    veryLateNight: 'שעתיים לפנות בוקר הקזינו בוער',
    weekend: 'סופ"ש: ' + (config.bonusRules && config.bonusRules.weekend || '100% קזינו 50% ספורט'),
    motzash: 'מוצאי שבת חוזרים לאקשן',
    afterRaffle: 'הגרלה זה עתה נשלחה',
  };
  const promptTemplate = (config.prompts && config.prompts[type]) || ('אתה ' + (config.agentName || 'אסי') + ', סוכן הימורים. כתוב הודעה קצרה לקהילה. סיים עם wa.me/972' + (config.agentPhone || '547554270'));
  const bonusInstruction = bonusMap[type] || '';
  const prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'אסי')
    .replace(/{agentPhone}/g, config.agentPhone || '547554270')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  }, { headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
  return res.data.content[0].text;
}

// ── שלח הגרלה ממתינה לקהילה ──
async function sendPendingRaffle(pending) {
  const GROUP_ID = process.env.GROUP_ID;
  const { raffle, text, imageUrl } = pending;
  try {
    let messageId = null;
    if (imageUrl) {
      const sent = await axios.post(WHAPI_URL + '/messages/image', {
        to: GROUP_ID, media: imageUrl, caption: text || ''
      }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
      messageId = sent.data && sent.data.id;
    } else {
      const sent = await axios.post(WHAPI_URL + '/messages/text', {
        to: GROUP_ID, body: text || ''
      }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
      messageId = sent.data && sent.data.id;
    }
    if (raffle && raffle.id && messageId) {
      raffleMessages[raffle.id] = messageId;
      console.log('💾 messageId נשמר: ' + raffle.id);
    }
    console.log('✅ הגרלה נשלחה לקהילה: ' + (raffle && raffle.match_title));
    return true;
  } catch(err) {
    console.error('❌ שגיאה בשליחת הגרלה:', err.message);
    return false;
  }
}

// ── שלח כל ההגרלות הממתינות ──
async function sendAllPendingRaffles() {
  if (!pendingRaffles.length) {
    console.log('אין הגרלות ממתינות לשליחה');
    return;
  }
  console.log('📤 שולח ' + pendingRaffles.length + ' הגרלות ממתינות...');
  while (pendingRaffles.length > 0) {
    const pending = pendingRaffles.shift();
    await sendPendingRaffle(pending);
    // המתן 3 דקות בין הגרלות אם יש יותר מאחת
    if (pendingRaffles.length > 0) {
      await new Promise(function(r) { setTimeout(r, 3 * 60 * 1000); });
    }
  }
  // שלח הודעת עידוד אחרי ההגרלות
  setTimeout(async function() {
    try {
      const config = loadPrompts();
      const msg = await generateMessage('afterRaffle', config);
      if (msg) {
        await axios.post(WHAPI_URL + '/messages/text', {
          to: process.env.GROUP_ID, body: msg
        }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
      }
    } catch(e) {}
  }, 2 * 60 * 1000);
}

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => { try { res.sendFile(__dirname + '/panel.html'); } catch(e) { res.send('Panel not found'); } });
app.get('/qr', (req, res) => res.send('<html dir="rtl"><head><meta charset="utf-8"><title>BetON</title><style>body{background:#07070F;color:#f0f0f5;font-family:sans-serif;text-align:center;padding:3rem}h1{color:#F5C842}.ok{background:#0f2a1a;border:2px solid #22c55e;border-radius:12px;padding:2rem;display:inline-block;color:#22c55e;font-size:1.3rem;margin-top:1rem}</style></head><body><h1>BetON Bot</h1><div class="ok">Whapi מחובר!</div></body></html>'));

app.get('/api/status', async (req, res) => {
  try {
    const r = await axios.get(WHAPI_URL + '/health', { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN } });
    res.json({ ready: true, status: r.data, pendingRaffles: pendingRaffles.length });
  } catch(err) { res.json({ ready: false }); }
});

app.get('/api/prompts', (req, res) => res.json(loadPrompts()));
app.post('/api/prompts', (req, res) => { try { savePrompts(req.body); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/sendText', async (req, res) => {
  const { chatId, content } = req.body;
  try {
    const sent = await axios.post(WHAPI_URL + '/messages/text', { to: chatId, body: content }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
    console.log('✅ נשלח:', content.substring(0, 40) + '...');
    res.json({ success: true, messageId: sent.data && sent.data.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendImage', async (req, res) => {
  const { chatId, url, caption, raffleId } = req.body;
  try {
    const sent = await axios.post(WHAPI_URL + '/messages/image', { to: chatId, media: url, caption: caption || '' }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
    if (raffleId) raffleMessages[raffleId] = sent.data && sent.data.id;
    res.json({ success: true, messageId: sent.data && sent.data.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendTextWithId', async (req, res) => {
  const { chatId, content, raffleId } = req.body;
  try {
    const sent = await axios.post(WHAPI_URL + '/messages/text', { to: chatId, body: content }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
    if (raffleId) raffleMessages[raffleId] = sent.data && sent.data.id;
    res.json({ success: true, messageId: sent.data && sent.data.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getMessageReplies', async (req, res) => {
  const { messageId } = req.query;
  if (!messageId) return res.status(400).json({ error: 'חסר messageId' });
  try {
    const GROUP_ID = process.env.GROUP_ID;
    const response = await axios.get(WHAPI_URL + '/messages/list/' + GROUP_ID, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN }, params: { count: 1000 } });
    const messages = response.data && response.data.messages || [];
    const replies = messages.filter(function(m) { return m.context && m.context.quoted_id === messageId; }).map(function(m) { return { senderName: m.from_name || m.from, senderId: m.from, body: (m.text && m.text.body) || '', timestamp: m.timestamp }; });
    res.json({ replies: replies });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getRaffleMessageId', (req, res) => res.json({ messageId: raffleMessages[req.query.raffleId] || null }));

app.post('/api/findWinners', async (req, res) => {
  const { raffleId } = req.body;
  if (!raffleId) return res.status(400).json({ error: 'חסר raffleId' });
  try {
    const messageId = raffleMessages[raffleId];
    if (!messageId) return res.status(404).json({ error: 'לא נמצא messageId' });
    const { findWinners } = require('./winner-finder');
    const result = await findWinners(raffleId, messageId);
    res.json({ success: true, result: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getGroups', async (req, res) => {
  try {
    const response = await axios.get(WHAPI_URL + '/groups', { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN } });
    res.json({ groups: (response.data && response.data.groups || []).map(function(g) { return { id: g.id, name: g.name }; }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API לשליחה ידנית של הגרלות ממתינות ──
app.post('/api/sendPendingNow', async (req, res) => {
  res.json({ success: true, count: pendingRaffles.length });
  await sendAllPendingRaffles();
});

app.get('/api/pendingRaffles', (req, res) => {
  res.json({ count: pendingRaffles.length, raffles: pendingRaffles.map(function(p) { return { id: p.raffle && p.raffle.id, title: p.raffle && p.raffle.match_title, sport: p.raffle && p.raffle.sport, lockedAt: p.lockedAt }; }) });
});

app.post('/api/generateTest', async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'חסר type' });
  try {
    const config = loadPrompts();
    const msg = await generateMessage(type, config);
    res.json({ success: true, message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/runFullTest', async (req, res) => {
  const { chatId, delaySeconds } = req.body;
  if (!chatId) return res.status(400).json({ error: 'חסר chatId' });
  res.json({ success: true, message: 'טסט התחיל!' });
  const types = ['morning', 'noon', 'afternoon', 'evening', 'lateEvening', 'midnight', 'weekend', 'afterRaffle'];
  const labels = ['☀️ בוקר', '🌤 צהריים', '⛅ אחה"צ', '🌆 ערב', '🌙 לילה', '🕛 חצות', '🎉 סופ"ש', '🎯 אחרי הגרלה'];
  const delay = (delaySeconds || 30) * 1000;
  const config = loadPrompts();
  for (var i = 0; i < types.length; i++) {
    try {
      await new Promise(function(r) { setTimeout(r, i === 0 ? 1000 : delay); });
      const msg = await generateMessage(types[i], config);
      if (!msg) continue;
      await axios.post(WHAPI_URL + '/messages/text', { to: chatId, body: '🧪 טסט: ' + labels[i] + '\n\n' + msg }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
      console.log('✅ טסט נשלח: ' + types[i]);
    } catch(err) { console.error('❌ שגיאה בטסט:', err.message); }
  }
});

// ── Webhook מ-Lovable ──
app.post('/webhook/lovable', async (req, res) => {
  const secret = req.headers['x-bot-secret'] || req.headers['x-webhook-secret'];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    console.log('❌ Webhook: סיסמה שגויה');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body.event;
  const raffle = req.body.raffle;
  const text = req.body.text;
  const imageUrl = req.body.imageUrl;
  const GROUP_ID = process.env.GROUP_ID;

  console.log('📨 Webhook: ' + event + ' | ' + (raffle && raffle.match_title) + ' | sport: ' + (raffle && raffle.sport));

  try {
    if (event === 'raffle_locked') {
      // שמור בתור ממתינות — לא שולח עדיין!
      pendingRaffles.push({
        raffle: raffle,
        text: text,
        imageUrl: imageUrl,
        lockedAt: new Date().toISOString()
      });
      console.log('📥 הגרלה נשמרה לשליחה ב-18:00. סה"כ ממתינות: ' + pendingRaffles.length);
    }

    if (event === 'raffle_results') {
      // שלח תוצאות מיד לקהילה
      if (imageUrl) {
        await axios.post(WHAPI_URL + '/messages/image', { to: GROUP_ID, media: imageUrl, caption: text || '' }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
      } else {
        await axios.post(WHAPI_URL + '/messages/text', { to: GROUP_ID, body: text || '' }, { headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' } });
      }
      console.log('✅ תוצאות נשלחו לקהילה');

      // חפש זוכים אחרי 2 דקות
      if (raffle && raffle.id) {
        setTimeout(async function() {
          try {
            const messageId = raffleMessages[raffle.id];
            if (messageId) {
              const { findWinners } = require('./winner-finder');
              await findWinners(raffle.id, messageId);
            }
          } catch(err) { console.error('שגיאה בזוכים:', err.message); }
        }, 2 * 60 * 1000);
      }
    }

    res.json({ success: true });
  } catch(err) {
    console.error('❌ שגיאה ב-Webhook:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Export לשימוש ב-scheduler ──
module.exports = { sendAllPendingRaffles };

app.listen(PORT, '0.0.0.0', function() {
  console.log('🚀 BetON Bot פועל על פורט ' + PORT);
  setTimeout(function() { require('./scheduler'); console.log('📅 תזמון אוטומטי פעיל!'); }, 5000);
});
