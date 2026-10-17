// Sounds of the slot machine (#107), made with the Web Audio API (no audio files): the reels'
// clicks while they spin, a jingle for a win (longer and higher for rarer items) and a short
// falling tone for a spin that wins nothing. They play only after a click, as browsers require,
// and the machine's 🔊 button turns them off for this browser.
let context = null;
const audio = () => {
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') context.resume();
    return context;
  } catch { return null; }
};
function tone(ctx, frequency, start, duration, { type = 'square', volume = 0.05 } = {}) {
  const osc = ctx.createOscillator(), gain = ctx.createGain(), at = ctx.currentTime + start;
  osc.type = type; osc.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(ctx.destination); osc.start(at); osc.stop(at + duration + 0.02);
}
// The reels clicking for ms milliseconds, slowing down at the end.
export function playSpin(ms) {
  const ctx = audio(); if (!ctx) return;
  for (let at = 0, step = 0.06; at < ms / 1000; at += step, step *= 1.035) tone(ctx, 900 + Math.random() * 500, at, 0.03, { type: 'triangle', volume: 0.035 });
}
const jingles = { common: [523, 659, 784], rare: [523, 659, 784, 1047], epic: [587, 740, 880, 1175, 1480], legendary: [523, 659, 784, 1047, 1319, 1568, 2093] };
export function playWin(rarity) {
  const ctx = audio(); if (!ctx) return;
  (jingles[rarity] || jingles.common).forEach((f, i) => tone(ctx, f, i * 0.09, 0.22, { volume: 0.06 }));
  if (rarity === 'legendary' || rarity === 'epic') for (let i = 0; i < 8; i++) tone(ctx, 2500 + Math.random() * 1500, 0.5 + i * 0.05, 0.08, { type: 'sine', volume: 0.025 });
}
export function playLose() {
  const ctx = audio(); if (!ctx) return;
  tone(ctx, 330, 0, 0.16, { type: 'sawtooth', volume: 0.035 }); tone(ctx, 247, 0.15, 0.28, { type: 'sawtooth', volume: 0.035 });
}
