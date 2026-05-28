const axios = require('axios');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SUPABASE_URL = 'https://oxraakhcpvthlvjvapay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cmFha2hjcHZ0aGx2anZhcGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzY4MTUsImV4cCI6MjA5MzY1MjgxNX0.dftK8Qb9zjzwEVGRLv4Q54Pqn2SLrzOxUqydIYf3Xd8';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '972547554270@s.whatsapp.net';

async function getMessageReplies(messageId) {
  try {
    const res = await axios.get(`${SERVER_URL}/api/getMessageReplies?messageId=${messageId}`);
    return res.data.replies || [];
  } catch (err) {
    console.error('שגיאה בשליפת תגובות:', err.message);
    return [];
  }
}

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

async function findWinnersWithAI(raffleText, resultsText, replies, questionCount) {
  const sortedReplies = [...replies].sort((a, b) => a.timestamp - b.timestamp);
  const repliesText = sortedReplies.map((r, i) =>
    `${i + 1}. שם: ${r.senderName} | טלפון: ${r.senderId} | זמן: ${new Date(r.timestamp * 1000).toLocaleTimeString('he-IL')} | ניחוש: "${r.body}"`
  ).join('\n');

  const prompt = `אתה עוזר לזהות זוכים בהגרלת ספורט של רובי.

טקסט ההגרלה:
${raffleText}

תוצאות אמיתיות:
${resultsText}

מספר שאלות: ${questionCount}

תגובות (ממוינות לפי זמן):
${repliesText}

כללים:
1. זוכה אחד לכל שאלה — מי שניחש נכון ראשון
2. גמיש עם שמות שחקנים ותוצאות
3. מי שמחק/ערך הודעה — פסול

החזר JSON בלבד:
{
  "winners": [{"question":"","name":"","phone":"","guess":"","correct_answer":""}],
  "no_winner_questions": [],
  "summary": ""
}`;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    });
    const clean = res.data.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('שגיאה ב-AI:', err.message);
    return { winners: [], summary: 'שגיאה בזיהוי זוכים' };
  }
}

function buildWinnersMessage(raffle, result) {
  const { winners, no_winner_questions, summary } = result;
  let msg = `🏆 זוכים בהגרלה!\n⚽ ${raffle.match_title}\n\n`;
  if (winners.length === 0) {
    msg += `😔 לא נמצאו זוכים\n\n`;
  } else {
    winners.forEach((w, i) => {
      msg += `🥇 זוכה ${i + 1}\n`;
      msg += `❓ שאלה: ${w.question}\n`;
      msg += `👤 שם: ${w.name}\n`;
      msg += `📱 טלפון: ${w.phone.replace('@s.whatsapp.net', '').replace('@c.us', '')}\n`;
      msg += `✅ ניחש: ${w.guess}\n`;
      msg += `🎯 תשובה: ${w.correct_answer}\n\n`;
    });
  }
  if (no_winner_questions?.length > 0) {
    msg += `❌ ללא זוכה:\n`;
    no_winner_questions.forEach(q => msg += `  ${q}\n`);
    msg += '\n';
  }
  msg += `📊 ${summary}`;
  return msg;
}

async function findWinners(raffleId, messageId) {
  console.log(`🔍 מחפש זוכים להגרלה ${raffleId}...`);
  const raffle = await getRaffleById(raffleId);
  if (!raffle || !raffle.results) { console.log('אין נתונים'); return; }
  const replies = await getMessageReplies(messageId);
  console.log(`📝 ${replies.length} תגובות`);
  if (replies.length === 0) {
    await axios.post(`${SERVER_URL}/api/sendText`, { chatId: ADMIN_PHONE, content: `🏆 ${raffle.match_title}\n😔 לא נמצאו תגובות` });
    return;
  }
  const result = await findWinnersWithAI(raffle.raffle_text, raffle.results, replies, raffle.question_count || 1);
  const message = buildWinnersMessage(raffle, result);
  await axios.post(`${SERVER_URL}/api/sendText`, { chatId: ADMIN_PHONE, content: message });
  console.log('✅ הודעת זוכים נשלחה לרובי!');
  return result;
}

module.exports = { findWinners };
