const axios = require('axios');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SUPABASE_URL = 'https://hnkiqwgkmtpirykydkrb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhua2lxd2drbXRwaXJ5a3lka3JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ5MDI0NTEsImV4cCI6MjA2MDQ3ODQ1MX0.JTxtYlyVwHrJqAmO5nwPPuPCTvLfx4LTQaTUu8F6RWo';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '972525151129@s.whatsapp.net';

// ── שלוף תגובות על הודעה מהקבוצה ──
async function getMessageReplies(messageId) {
  try {
    const res = await axios.get(`${SERVER_URL}/api/getMessageReplies?messageId=${messageId}`);
    return res.data.replies || [];
  } catch (err) {
    console.error('שגיאה בשליפת תגובות:', err.message);
    return [];
  }
}

// ── שלוף הגרלה מ-Supabase לפי ID ──
async function getRaffleById(raffleId) {
  try {
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?id=eq.${raffleId}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return res.data[0] || null;
  } catch (err) {
    console.error('שגיאה בשליפת הגרלה:', err.message);
    return null;
  }
}

// ── שלח ל-Claude AI לזיהוי זוכים ──
async function findWinnersWithAI(raffleText, resultsText, replies, questionCount) {
  const sortedReplies = [...replies].sort((a, b) => a.timestamp - b.timestamp);
  
  const repliesText = sortedReplies.map((r, i) => 
    `${i + 1}. שם: ${r.senderName} | טלפון: ${r.senderId} | זמן: ${new Date(r.timestamp * 1000).toLocaleTimeString('he-IL')} | ניחוש: "${r.body}"`
  ).join('\n');

  const prompt = `אתה עוזר לזהות זוכים בהגרלת ספורט של אסי.

טקסט ההגרלה:
${raffleText}

תוצאות אמיתיות:
${resultsText}

מספר שאלות בהגרלה: ${questionCount}
מספר זוכים מקסימלי: ${questionCount} (זוכה אחד לכל שאלה)

תגובות המשתתפים (ממוינות לפי זמן — הראשון בראש):
${repliesText}

כללים חשובים:
1. לכל שאלה יש זוכה אחד בלבד — מי שניחש נכון ראשון
2. אם 5 אנשים ניחשו נכון — רק הראשון מבחינת זמן זוכה
3. היה גמיש עם שמות שחקנים: מבאפה/מבאפי/kylian/mbappe = אותו שחקן
4. היה גמיש עם תוצאות: 3-2 / 3:2 = אותה תוצאה
5. אם מישהו מחק או ערך הודעה — פסול אותו

החזר JSON בלבד:
{
  "winners": [
    {
      "question": "תיאור השאלה",
      "name": "שם הזוכה",
      "phone": "מספר טלפון",
      "guess": "מה הוא ניחש",
      "correct_answer": "התשובה הנכונה"
    }
  ],
  "no_winner_questions": ["שאלה שאין לה זוכה"],
  "summary": "סיכום קצר"
}`;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });

    const text = res.data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('שגיאה ב-AI:', err.message);
    return { winners: [], summary: 'שגיאה בזיהוי זוכים' };
  }
}

// ── בנה הודעת זוכים לאסי ──
function buildWinnersMessage(raffle, result) {
  const { winners, no_winner_questions, summary } = result;
  
  let msg = `🏆 זוכים בהגרלה!\n`;
  msg += `⚽ ${raffle.match_title}\n\n`;
  
  if (winners.length === 0) {
    msg += `😔 לא נמצאו זוכים בהגרלה הזו\n\n`;
  } else {
    winners.forEach((w, i) => {
      msg += `🥇 זוכה ${i + 1}\n`;
      msg += `❓ שאלה: ${w.question}\n`;
      msg += `👤 שם: ${w.name}\n`;
      msg += `📱 טלפון: ${w.phone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@g.us', '')}\n`;
      msg += `✅ ניחש: ${w.guess}\n`;
      msg += `🎯 תשובה נכונה: ${w.correct_answer}\n\n`;
    });
  }

  if (no_winner_questions && no_winner_questions.length > 0) {
    msg += `❌ שאלות ללא זוכה:\n`;
    no_winner_questions.forEach(q => {
      msg += `  ${q}\n`;
    });
    msg += '\n';
  }

  msg += `📊 ${summary}`;
  
  return msg;
}

// ── פונקציה ראשית ──
async function findWinners(raffleId, messageId) {
  console.log(`🔍 מחפש זוכים להגרלה ${raffleId}...`);

  const raffle = await getRaffleById(raffleId);
  if (!raffle) { console.error('הגרלה לא נמצאה'); return; }
  if (!raffle.results) { console.log('אין תוצאות עדיין'); return; }

  const replies = await getMessageReplies(messageId);
  console.log(`📝 נמצאו ${replies.length} תגובות`);

  if (replies.length === 0) {
    await axios.post(`${SERVER_URL}/api/sendText`, {
      chatId: ADMIN_PHONE,
      content: `🏆 הגרלה: ${raffle.match_title}\n😔 לא נמצאו תגובות בהגרלה זו`
    });
    return;
  }

  console.log('🤖 שולח ל-AI לניתוח...');
  const result = await findWinnersWithAI(
    raffle.raffle_text,
    raffle.results,
    replies,
    raffle.question_count || 1
  );

  const message = buildWinnersMessage(raffle, result);
  
  await axios.post(`${SERVER_URL}/api/sendText`, {
    chatId: ADMIN_PHONE,
    content: message
  });

  console.log('✅ הודעת זוכים נשלחה לאסי!');
  return result;
}

module.exports = { findWinners };
