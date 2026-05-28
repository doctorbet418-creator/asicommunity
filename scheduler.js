const cron = require('node-cron');
const axios = require('axios');
const { randomDelay, isWeekend, isMoatzash } = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://oxraakhcpvthlvjvapay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cmFha2hjcHZ0aGx2anZhcGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzY4MTUsImV4cCI6MjA5MzY1MjgxNX0.dftK8Qb9zjzwEVGRLv4Q54Pqn2SLrzOxUqydIYf3Xd8';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── האם עכשיו שבת? ──
function isShabbat() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

// ── קבע איזה בונוס להיום ──
function getTodayBonus() {
  const day = new Date().getDay();
  // 0=ראשון, 1=שני, 2=שלישי, 3=רביעי, 4=חמישי, 5=שישי, 6=שבת
  if (day === 1 || day === 3) return '30deposit'; // שני + רביעי = 30% הפקדה
  if (day === 2 || day === 4) return '100casino';  // שלישי + חמישי = 100% קזינו + 50% ספורט
  if (day === 4 || day === 5) return 'weekend';    // חמישי + שישי = סופ"ש מלא
  return 'none';
}

// ── יצירת הודעה עם Claude AI ──
async function generateMessage(type) {
  const now = new Date();
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[now.getDay()];
  const bonus = getTodayBonus();
  const isWeekendNow = isWeekend();

  // בונוס לפי יום
  let bonusText = '';
  if (bonus === '30deposit') bonusText = 'היום יש בונוס הפקדה 30% לא מקוזז. אפשר להזכיר את זה פעם אחת בערב בלבד.';
  if (bonus === '100casino') bonusText = 'היום יש בונוס 100% קזינו ו-50% ספורט. אפשר להזכיר את זה פעם אחת בערב בלבד.';
  if (bonus === 'weekend') bonusText = 'זה סופ"ש! שווק בחזקה: 100% קזינו ו-50% ספורט. זה הזמן להשתגע עם הבונוסים.';

  const baseRules = `
כללים חשובים לכל הודעה:
- כתוב בסגנון חברותי וישיר כמו חבר שכותב לחברים
- אסור להשתמש במקפים ארוכים (—) בכלל
- אסור לכתוב סכומים מדויקים של בונוסים אלא אם צוין במפורש
- תזכור תמיד שאתה סוכן הימורים של קזינו אונליין והימורי ספורט
- אל תגזים, תהיה טבעי
- סיים תמיד עם: wa.me/972504513838 והסוכן רובי 
- ${bonusText || 'אין בונוס מיוחד היום, שמור על טבעי'}`;

  const prompts = {
    morning: `אתה רובי, סוכן הימורים ספורט וקזינו ישראלי עם קהילת VIP בוואטסאפ.
כתוב הודעת בוקר לקהילה. יום: ${dayName}.
${baseRules}
אורך: 3-4 שורות. אל תתחיל עם "בוקר טוב" כל פעם, היה יצירתי.
אל תזכיר בונוסים בבוקר גם אם יש היום.`,

    noon: `אתה רובי, סוכן הימורים  קזינו וספורט ישראלי.
כתוב הודעת צהריים לקהילה. יום: ${dayName}.
${baseRules}
חשוב: הזכר שהמחלקה הפיננסית פתוחה עד 18:00 למשיכות (רק אם זה מתאים טבעי, לא כל יום).
אורך: 2-4 שורות. אל תזכיר בונוסים בצהריים.`,

    afternoon: `אתה רובי, סוכן הימורים  קזינו וספורט.
כתוב הודעת אחר צהריים לקהילה. יום: ${dayName}.
${baseRules}
דבר על המשחקים של הערב. אורך: 3-4 שורות.
אל תזכיר בונוסים עדיין, זה יבוא בערב.`,

    evening: `אתה רובי, סוכן הימורים קזינו וספורט.
כתוב הודעת ערב לקהילה. יום: ${dayName}.
${baseRules}
${bonusText ? `חשוב: ${bonusText}` : 'אין בונוס היום, שמור על טבעי ומעניין.'}
אורך: 3-5 שורות.`,

    lateEvening: `אתה רובי, סוכן הימורים קזינו וספורט.
כתוב הודעת לילה (22:00) לקהילה. יום: ${dayName}.
${baseRules}
דבר על קזינו, NBA, משחקי לילה. אורך: 3-4 שורות.`,

    midnight: `אתה רובי, סוכן הימורים קזינו וספורט.
כתוב הודעת חצות לקהילה.
${baseRules}
רובי ער 24/6. קצר מאוד, 2-3 שורות.`,

    lateNight: `אתה רובי, סוכן הימורים קזינו וספורט.
כתוב הודעת 01:00 לקהילה.
${baseRules}
שעות קטנות, אסי עדיין כאן. 2-3 שורות.`,

    veryLateNight: `אתה רובי, סוכן הימורים קזינו וספורט.
כתוב הודעת 02:00 לקהילה.
${baseRules}
שעתיים לפנות בוקר. קצר מאוד, 2 שורות.`,

    weekend: `אתה רובי, סוכן הימורים קזינו ספורט.
כתוב הודעת סופ"ש לקהילה. יום: ${dayName}.
${baseRules}
סופ"ש! שווק חזק: 100% בונוס קזינו ו-50% ספורט. 3-5 שורות.`,

    motzash: `אתה רובי, סוכן הימורים  קזינו וספורט.
כתוב הודעת מוצאי שבת לקהילה.
${baseRules}
שבת יצאה, חוזרים לאקשן! שבוע טוב. 3-4 שורות.`,

    afterRaffle: `אתה רובי, סוכן הימורים קזינו וספורט.
הרגע שלחת הגרלה לקהילה. כתוב הודעת עידוד.
${baseRules}
עודד להגיב עם ניחוש. 2-3 שורות.`,
  };

  const prompt = prompts[type] || prompts.morning;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    return res.data.content[0].text;
  } catch (err) {
    console.error('❌ שגיאה ב-AI:', err.message);
    return null;
  }
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
    console.log('🕌 שבת — לא שולחים');
    return;
  }
  if (!text) return;
  try {
    await axios.post(`${SERVER_URL}/api/sendText`, { chatId: GROUP_ID, content: text });
    console.log('✅ הודעה נשלחה:', text.substring(0, 40) + '...');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

// ── שלח הגרלה ──
async function sendRaffle(raffle) {
  if (isShabbat() && !isMoatzash()) {
    console.log('🕌 שבת — לא שולחים הגרלות');
    return false;
  }
  try {
    let response;
    if (raffle.image_url) {
      response = await axios.post(`${SERVER_URL}/api/sendImage`, {
        chatId: GROUP_ID,
        url: raffle.image_url,
        caption: raffle.raffle_text || '',
        raffleId: raffle.id
      });
    } else {
      response = await axios.post(`${SERVER_URL}/api/sendTextWithId`, {
        chatId: GROUP_ID,
        content: raffle.raffle_text || '',
        raffleId: raffle.id
      });
    }
    console.log('✅ הגרלה נשלחה:', raffle.match_title);
    watchRaffleForFinish(raffle.id);
    return true;
  } catch (err) {
    console.error('❌ שגיאה בשליחת הגרלה:', err.message);
    return false;
  }
}

// ── שלח תוצאות ──
async function sendResults(raffle) {
  try {
    if (raffle.results_image_url) {
      await axios.post(`${SERVER_URL}/api/sendImage`, {
        chatId: GROUP_ID,
        url: raffle.results_image_url,
        caption: raffle.results || ''
      });
    } else {
      await axios.post(`${SERVER_URL}/api/sendText`, {
        chatId: GROUP_ID,
        content: raffle.results || ''
      });
    }
    console.log('✅ תוצאות נשלחו:', raffle.match_title);
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

// ── עקוב אחרי הגרלה ──
function watchRaffleForFinish(raffleId) {
  console.log(`👀 מעקב אחרי הגרלה ${raffleId}...`);
  const checkInterval = setInterval(async () => {
    try {
      const res = await axios.get(
        `${SUPABASE_URL}/rest/v1/raffles?id=eq.${raffleId}&select=is_finished,results`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const raffle = res.data[0];
      if (raffle && raffle.is_finished && raffle.results) {
        clearInterval(checkInterval);
        console.log(`🏁 הגרלה ${raffleId} הסתיימה!`);
        setTimeout(async () => {
          try {
            const { findWinners } = require('./winner-finder');
            const msgRes = await axios.get(`${SERVER_URL}/api/getRaffleMessageId?raffleId=${raffleId}`);
            const messageId = msgRes.data.messageId;
            if (messageId) await findWinners(raffleId, messageId);
          } catch (err) { console.error('שגיאה בחיפוש זוכים:', err.message); }
        }, 2 * 60 * 1000);
      }
    } catch (err) { console.error('שגיאה בבדיקה:', err.message); }
  }, 5 * 60 * 1000);
  setTimeout(() => clearInterval(checkInterval), 12 * 60 * 60 * 1000);
}

// ── שלוף הגרלות היום ──
async function getTodayRaffles() {
  const today = new Date().toISOString().split('T')[0];
  const res = await axios.get(
    `${SUPABASE_URL}/rest/v1/raffles?raffle_date=eq.${today}&locked=eq.true&order=created_at.asc`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return res.data;
}

// ── שלוף תוצאות אתמול ──
async function getYesterdayResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  const res = await axios.get(
    `${SUPABASE_URL}/rest/v1/raffles?raffle_date=eq.${dateStr}&results=not.is.null&is_finished=eq.true`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return res.data;
}

// ══════════════════════════════════════
// ── לוח הזמנים ──
// ══════════════════════════════════════

// 09:00 — תוצאות אתמול
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ 09:00 — תוצאות אתמול');
  const results = await getYesterdayResults();
  if (!results.length) { console.log('אין תוצאות'); return; }
  for (const r of results) {
    await sendResults(r);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}, { timezone: 'Asia/Jerusalem' });

// 10:00 — הודעת בוקר
cron.schedule('0 10 * * *', async () => {
  console.log('⏰ 10:00 — הודעת בוקר');
  await sendWithDelay(async () => {
    const msg = await generateMessage(isWeekend() ? 'weekend' : 'morning');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 11:00 — הגרלה ראשונה
cron.schedule('0 11 * * *', async () => {
  console.log('⏰ 11:00 — הגרלה ראשונה');
  const raffles = await getTodayRaffles();
  if (raffles.length > 0) {
    const sent = await sendRaffle(raffles[0]);
    if (sent) {
      setTimeout(async () => {
        const msg = await generateMessage('afterRaffle');
        await sendText(msg);
      }, 60 * 60 * 1000);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// 12:00 — הודעת צהריים
cron.schedule('0 12 * * *', async () => {
  console.log('⏰ 12:00 — הודעת צהריים');
  await sendWithDelay(async () => {
    const type = isMoatzash() ? 'motzash' : isWeekend() ? 'weekend' : 'noon';
    const msg = await generateMessage(type);
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 15:00 — הודעת אחר הצהריים
cron.schedule('0 15 * * *', async () => {
  console.log('⏰ 15:00 — הודעת אחר הצהריים');
  await sendWithDelay(async () => {
    const msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 18:00 — הודעת ערב
cron.schedule('0 18 * * *', async () => {
  console.log('⏰ 18:00 — הודעת ערב');
  await sendWithDelay(async () => {
    const msg = await generateMessage(isWeekend() ? 'weekend' : 'evening');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 20:00 — הגרלה שנייה / מוצאי שבת
cron.schedule('0 20 * * *', async () => {
  console.log('⏰ 20:00 — הגרלה שנייה / מוצאי שבת');
  if (isMoatzash()) {
    await sendWithDelay(async () => {
      const msg = await generateMessage('motzash');
      await sendText(msg);
    });
    return;
  }
  const raffles = await getTodayRaffles();
  if (raffles.length > 1) {
    const sent = await sendRaffle(raffles[1]);
    if (sent) {
      setTimeout(async () => {
        const msg = await generateMessage('afterRaffle');
        await sendText(msg);
      }, 60 * 60 * 1000);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// 22:00 — הודעת לילה
cron.schedule('0 22 * * *', async () => {
  console.log('⏰ 22:00 — הודעת לילה');
  await sendWithDelay(async () => {
    const msg = await generateMessage(isWeekend() ? 'weekend' : 'lateEvening');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 00:00 — הודעת חצות
cron.schedule('0 0 * * *', async () => {
  console.log('⏰ 00:00 — הודעת חצות');
  await sendWithDelay(async () => {
    const msg = await generateMessage('midnight');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 01:00 — הודעת לילה מאוחר
cron.schedule('0 1 * * *', async () => {
  console.log('⏰ 01:00 — הודעת לילה מאוחר');
  await sendWithDelay(async () => {
    const msg = await generateMessage('lateNight');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 02:00 — הודעת שעתיים לפנות בוקר
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ 02:00 — הודעת שעתיים');
  await sendWithDelay(async () => {
    const msg = await generateMessage('veryLateNight');
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

console.log('📅 תזמון אוטומטי פעיל — שעון ישראל');
