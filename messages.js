// ── פונקציית עזר: הודעה אקראית ──
function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── שעה אקראית בתוך טווח ──
function randomDelay(maxMinutes = 10) {
  return Math.floor(Math.random() * maxMinutes * 60 * 1000);
}

// ── האם עכשיו סופ"ש? ──
function isWeekend() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 4 && hour >= 18) return true;
  if (day === 5 && hour < 17) return true;
  return false;
}

// ── האם עכשיו מוצאי שבת? ──
function isMoatzash() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 6 && hour >= 20) return true;
  return false;
}

module.exports = {
  getRandom,
  randomDelay,
  isWeekend,
  isMoatzash,
};
