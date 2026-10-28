// A player card's front as a picture (card.js, Save image): drawn on a canvas in the card's
// look, its design, holo finish, layout and options (the effect around the card, which is not
// on the card, aside), and saved as a PNG at twice the size of a card on a phone (1500 pixels
// wide), so it stays sharp when zoomed in or printed. The canvas draws the card itself rather than copying the page, since the content security policy lets the page
// load images only from the Odyle server (img-src 'self'); the portrait and icons come from
// there too, so the canvas may be saved.
import { t } from './i18n.js';
import { imageUrl } from './armory.js';
import { cardSkills, cardStats, cardLine, raceName, gradeName, cardAccents } from './card.js';

export const width = 1500, height = Math.round(1500 * 88 / 63);
const u = width / 100;
const heading = '"Manrope Variable", Manrope, sans-serif', text = '"DM Sans Variable", "DM Sans", sans-serif';

// Each design's colours, as card.css gives them (--c-*).
const palettes = {
  elysea: { ink: '#2b2416', muted: '#6c5a37', accent: '#b0832c', panel: 'rgba(255,251,240,.86)', line: 'rgba(150,110,40,.38)', frame: ['rgba(150,108,34,.55)', 0.8, true], art: [180, ['#86bde9', 0], ['#cbe5f8', 0.58], ['#f6efdc', 1]], face: [155, ['#f4ecd6', 0], ['#e7d4a3', 0.36], ['#cfa050', 0.6], ['#f2e4ba', 0.8], ['#d2ad62', 1]], glow: ['rgba(255,252,243,.85)', 0.5, 0] },
  asmodae: { ink: '#f2edff', muted: '#b9abd8', accent: '#ff7d55', panel: 'rgba(22,13,40,.8)', line: 'rgba(255,125,85,.4)', frame: ['rgba(201,206,214,.5)', 0.5], artBorder: '#c9ced6', art: ['radial', ['#8a55c8', 0], ['#3a2068', 0.42], ['#140b26', 0.86]], face: [160, ['#2d1f4f', 0], ['#170f2c', 0.46], ['#2a1636', 0.72], ['#1c1335', 1]], glow: ['rgba(226,96,63,.32)', 0.5, 1] },
  abyss: { ink: '#e6f5ee', muted: '#8fb3a5', accent: '#b5f2cd', panel: 'rgba(7,14,13,.8)', line: 'rgba(181,242,205,.32)', frame: ['rgba(181,242,205,.35)', 0.4], artBorder: 'rgba(181,242,205,.65)', art: ['radial', ['#2a7a6b', 0], ['#0f2a26', 0.5], ['#060b0a', 0.9]], face: [165, ['#151f1e', 0], ['#0a1110', 0.55], ['#121a19', 1]], glow: ['rgba(95,227,208,.2)', 0.28, 0.82], cracks: true },
  balaur: { ink: '#f9ece0', muted: '#d0a58e', accent: '#e8b04a', panel: 'rgba(24,7,7,.82)', line: 'rgba(232,176,74,.38)', frame: ['rgba(232,176,74,.55)', 0.6], art: ['radial', ['#c4381f', 0], ['#4d0d0d', 0.55], ['#120404', 0.9]], face: [160, ['#3d0e0e', 0], ['#170606', 0.5], ['#4a1111', 1]], glow: ['rgba(232,176,74,.18)', 0.5, 0], scales: true },
  beluslan: { ink: '#10283a', muted: '#4c6b80', accent: '#2f7fb0', panel: 'rgba(246,251,255,.85)', line: 'rgba(47,127,176,.35)', frame: ['rgba(47,127,176,.4)', 0.5], artBorder: '#7fb1d3', art: [180, ['#4d7fa8', 0], ['#a7c9e3', 0.55], ['#f2f8fc', 1]], face: [160, ['#eef6fc', 0], ['#cfe3f2', 0.4], ['#a9cbe6', 0.7], ['#e6f2fa', 1]], glow: ['rgba(255,255,255,.95)', 0.18, 0.12] },
  heiron: { ink: '#f0f3e4', muted: '#b7c39a', accent: '#d6aa5c', panel: 'rgba(14,28,17,.8)', line: 'rgba(214,170,92,.38)', frame: ['rgba(214,170,92,.55)', 0.7, true], art: ['radial', ['#93c36d', 0], ['#2f5a2f', 0.55], ['#0e1d12', 0.9]], face: [160, ['#22422b', 0], ['#11251a', 0.5], ['#2d4b25', 1]], glow: ['rgba(214,170,92,.25)', 0.5, 0] },
  sanctum: { ink: '#1c2738', muted: '#56657a', accent: '#c6922f', panel: 'rgba(255,255,255,.86)', line: 'rgba(70,110,160,.3)', frame: ['rgba(198,146,47,.75)', 0.6, true], art: [180, ['#6fa8e0', 0], ['#bcd8f2', 0.6], ['#fdfaf2', 1]], face: [160, ['#ffffff', 0], ['#eef2f7', 0.45], ['#dce4ee', 0.75], ['#f7f9fc', 1]], glow: ['rgba(255,255,255,.9)', 0.3, 0.1], columns: true },
  pandaemonium: { ink: '#e9eef2', muted: '#93a3ad', accent: '#46d3c6', panel: 'rgba(12,16,20,.82)', line: 'rgba(70,211,198,.3)', frame: ['rgba(150,165,175,.55)', 0.5], artBorder: '#8d9aa3', art: ['radial', ['#3a6f73', 0], ['#172629', 0.55], ['#080b0d', 0.9]], face: [165, ['#232a31', 0], ['#12171c', 0.5], ['#1b2127', 1]], glow: ['rgba(70,211,198,.16)', 0.5, 0] },
  eltnen: { ink: '#3a2210', muted: '#7c5432', accent: '#c4561f', panel: 'rgba(255,246,228,.86)', line: 'rgba(196,86,31,.32)', frame: ['rgba(196,86,31,.5)', 0.6], art: [180, ['#f2a65a', 0], ['#f7d08a', 0.5], ['#fbefd6', 1]], face: [170, ['#f6e2b5', 0], ['#e9c58a', 0.45], ['#d99a5a', 0.75], ['#f0d29c', 1]], glow: ['rgba(255,235,180,.7)', 0.5, 0] },
  inggison: { ink: '#eefaf4', muted: '#9cc7b8', accent: '#ff7ccf', panel: 'rgba(10,26,26,.8)', line: 'rgba(255,124,207,.32)', frame: ['rgba(120,230,200,.45)', 0.5], artBorder: '#78e6c8', art: ['radial', ['#4fb59a', 0], ['#173f39', 0.55], ['#08130f', 0.9]], face: [160, ['#143a37', 0], ['#0b201f', 0.5], ['#1d1838', 1]], glow: ['rgba(255,124,207,.22)', 0.8, 1] },
  dredgion: { ink: '#eef1f4', muted: '#9aa4ad', accent: '#ff4a3d', panel: 'rgba(16,18,21,.84)', line: 'rgba(255,74,61,.35)', frame: ['rgba(170,180,190,.5)', 0.5], artBorder: '#aab4be', art: ['radial', ['#7a2622', 0], ['#2a1414', 0.55], ['#0b0c0e', 0.9]], face: [165, ['#30363d', 0], ['#1a1e23', 0.5], ['#262b31', 1]], glow: ['rgba(255,74,61,.3)', 0.5, 1.04] },
  tiamaranta: { ink: '#f6f0dc', muted: '#c2b48a', accent: '#f2c14e', panel: 'rgba(6,20,17,.82)', line: 'rgba(242,193,78,.36)', frame: ['rgba(242,193,78,.7)', 0.75, true], art: ['radial', ['#2f8a72', 0], ['#0e2a24', 0.55], ['#040b09', 0.9]], face: [160, ['#123a32', 0], ['#071815', 0.5], ['#0f2c26', 1]], glow: ['rgba(242,193,78,.12)', 0.5, 0.5] },
};
const gradeColours = { common: '#e6e9e7', rare: '#52b35c', legend: '#3d94d8', unique: '#fb9800', epic: '#ee6c2a', mythic: '#d33939' };

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
// A CSS linear-gradient(deg, stops) over a box.
function linear(ctx, deg, stops, x, y, w, h) {
  const a = deg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2, cx = x + w / 2, cy = y + h / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  for (const [colour, at] of stops) g.addColorStop(at, colour);
  return g;
}
function fill(ctx, spec, x, y, w, h) {
  const [kind, ...stops] = spec;
  if (kind === 'radial') { const g = ctx.createRadialGradient(x + w / 2, y + h * 0.3, 0, x + w / 2, y + h * 0.3, Math.max(w, h) * 0.75); for (const [c, at] of stops) g.addColorStop(at, c); return g; }
  return linear(ctx, kind, stops, x, y, w, h);
}
const load = src => new Promise(resolve => { if (!src) return resolve(null); const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
// An image covering a box, placed like object-fit: cover with object-position 50% y.
function cover(ctx, img, x, y, w, h, py = 0.18) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) * py, sw, sh, x, y, w, h);
}
// Text cut to a width, with an ellipsis.
function fit(ctx, value, max) {
  let s = String(value);
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
function write(ctx, value, x, y, { font, colour, align = 'left', max = Infinity, shadow = false, glow = '' }) {
  ctx.font = font; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 1.2 * u; ctx.shadowOffsetY = 0.3 * u; }
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 2.4 * u; ctx.shadowOffsetY = 0; }
  ctx.fillText(fit(ctx, value, max), x, y);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}
// A repeatable pseudo-random sequence, so the same card glitters the same way each time.
function seeded(seed) { let s = [...seed].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7); return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function background(ctx, c) {
  ctx.fillStyle = linear(ctx, c.face[0], c.face.slice(1), 0, 0, width, height); ctx.fillRect(0, 0, width, height);
  const [glow, gx, gy] = c.glow, g = ctx.createRadialGradient(width * gx, height * gy, 0, width * gx, height * gy, width * 0.9);
  g.addColorStop(0, glow); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  if (c.cracks) {
    ctx.save(); ctx.strokeStyle = 'rgba(181,242,205,.55)'; ctx.lineWidth = 0.5 * u; ctx.shadowColor = 'rgba(95,227,208,.6)'; ctx.shadowBlur = 2 * u;
    for (const [x1, y1, x2, y2] of [[0, 0.92, 1, 0.08], [0.05, 0.1, 0.95, 0.75], [0.3, 1, 0.75, 0.3]]) { ctx.beginPath(); ctx.moveTo(width * x1, height * y1); ctx.lineTo(width * x2, height * y2); ctx.stroke(); }
    ctx.restore();
  }
  if (c.scales) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,110,70,.14)'; ctx.lineWidth = 0.35 * u;
    for (let row = 0, y = 0; y < height + 5 * u; row++, y += 5 * u) for (let x = row % 2 ? 3.5 * u : 0; x < width + 7 * u; x += 7 * u) { ctx.beginPath(); ctx.arc(x, y, 3.5 * u, 0, Math.PI); ctx.stroke(); }
    ctx.restore();
  }
  if (c.columns) {
    for (let x = 8 * u; x < width; x += 20 * u) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(x + 0.6 * u, 0, 2.8 * u, height); ctx.fillStyle = 'rgba(130,140,170,.28)'; ctx.fillRect(x, 0, 0.6 * u, height); ctx.fillRect(x + 3.4 * u, 0, 0.6 * u, height); }
  }
}
// The frames a card may choose over its design's: [colour, size, double, glow], none at all.
const frames = accent => ({ gilded: ['#e3b54a', 0.75, true], silver: ['rgba(220,226,232,.85)', 0.45], radiant: [accent, 0.4, false, true], none: null });
function frame(ctx, c) {
  if (!c.frame) return;
  const [colour, size, double, glow] = c.frame, inset = 2.4 * u;
  ctx.save(); if (glow) { ctx.shadowColor = colour; ctx.shadowBlur = 2.4 * u; }
  ctx.strokeStyle = colour; ctx.lineWidth = (double ? size / 3 : size) * u;
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 3 * u); ctx.stroke();
  if (double) { const i2 = inset + size * u * 0.66; roundRect(ctx, i2, i2, width - i2 * 2, height - i2 * 2, 2.6 * u); ctx.stroke(); }
  ctx.restore();
}
function holo(ctx, finish, seed) {
  ctx.save();
  if (finish === 'prism') {
    const g = ctx.createLinearGradient(0, 0, width, height), colours = ['#ff5f6d', '#ffc371', '#c7f464', '#4ecdc4', '#556cfe', '#c06cff'];
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, colours[i % colours.length]);
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.18; ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  } else if (finish === 'starfall') {
    const g = ctx.createLinearGradient(0, 0, width, height);
    ['#6fb7ff', '#c38cff', '#ff8fb1', '#ffd27a', '#6fb7ff'].forEach((c, i) => g.addColorStop(i / 4, c));
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.22; ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    const random = seeded(seed); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.85; ctx.fillStyle = '#fff';
    for (let i = 0; i < 420; i++) { ctx.beginPath(); ctx.arc(random() * width, random() * height, (0.12 + random() * 0.3) * u, 0, Math.PI * 2); ctx.fill(); }
  } else if (finish === 'etched') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.5;
    ctx.fillStyle = linear(ctx, 115, [['#7a5b17', 0], ['#f5e3a1', 0.38], ['#fff6d5', 0.5], ['#b88a2e', 0.64], ['#4a3510', 1]], 0, 0, width, height); ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.3; ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.25 * u;
    for (let d = -height; d < width + height; d += 1.45 * u) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + height, height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(d, height); ctx.lineTo(d + height, 0); ctx.stroke(); }
  } else if (finish === 'sunburst') {
    const x = width / 2, y = height * 0.38, colours = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#7b61ff', '#ff6b6b'];
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.2;
    if (ctx.createConicGradient) { const g = ctx.createConicGradient(0, x, y); colours.forEach((c, i) => g.addColorStop(i / (colours.length - 1), c)); ctx.fillStyle = g; }
    else ctx.fillStyle = linear(ctx, 115, colours.map((c, i) => [c, i / (colours.length - 1)]), 0, 0, width, height);
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.2; ctx.fillStyle = '#fff';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, height * 1.5, a, a + 0.028); ctx.closePath(); ctx.fill(); }
  } else if (finish === 'ice') {
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.2;
    ctx.fillStyle = linear(ctx, 115, [['#9be7ff', 0], ['#e0c3fc', 0.34], ['#ffffff', 0.5], ['#8ec5fc', 0.66], ['#c2f0e6', 1]], 0, 0, width, height); ctx.fillRect(0, 0, width, height);
    const random = seeded(seed), shard = s => (random() - 0.5) * s; ctx.fillStyle = '#fff';
    for (let i = 0; i < 160; i++) {
      const x = random() * width, y = random() * height, s = (4 + random() * 10) * u;
      ctx.globalAlpha = 0.08 + random() * 0.22; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + shard(s), y + shard(s)); ctx.lineTo(x + shard(s), y + shard(s)); ctx.closePath(); ctx.fill();
    }
  } else if (finish === 'scales') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.5;
    ctx.fillStyle = linear(ctx, 115, [['#5b1d0e', 0], ['#e8b04a', 0.36], ['#fff1c4', 0.5], ['#c2541f', 0.66], ['#3a0d0d', 1]], 0, 0, width, height); ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.45; ctx.strokeStyle = '#fff0c8'; ctx.lineWidth = 0.5 * u;
    for (let row = 0, y = 0; y < height + 4 * u; row++, y += 2 * u) for (let x = row % 2 ? 4 * u : 0; x < width + 8 * u; x += 8 * u) { ctx.beginPath(); ctx.arc(x, y, 3.85 * u, 0, Math.PI); ctx.stroke(); }
  } else if (finish === 'aether') {
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.75;
    for (const [y, colour] of [[0.28, 'rgba(120,255,214,.8)'], [0.58, 'rgba(178,120,255,.75)'], [0.85, 'rgba(255,140,200,.6)']]) {
      ctx.save(); ctx.translate(width / 2, height * y); ctx.scale(1, 0.4);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.75); g.addColorStop(0, colour); g.addColorStop(0.7, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(-width, -height * 2.5, width * 2, height * 5); ctx.restore();
    }
    ctx.globalAlpha = 0.14; ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.2 * u;
    for (let y = 0; y < height + width * 0.14; y += 2.6 * u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y - width * 0.14); ctx.stroke(); }
  } else if (finish === 'opal') {
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.32;
    for (const [x, y, r, colour] of [[0.22, 0.24, 0.3, 'rgba(110,255,215,.9)'], [0.78, 0.38, 0.32, 'rgba(255,130,215,.85)'], [0.4, 0.72, 0.34, 'rgba(130,165,255,.9)'], [0.82, 0.86, 0.26, 'rgba(255,225,130,.8)'], [0.12, 0.92, 0.24, 'rgba(255,160,120,.75)']]) glowAt(ctx, x, y, r, 1, colour);
  } else if (finish === 'galaxy') {
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.5;
    for (const [x, y, r, squash, colour] of [[0.32, 0.28, 0.62, 0.4, 'rgba(120,90,255,.9)'], [0.72, 0.7, 0.55, 0.4, 'rgba(255,70,170,.75)'], [0.4, 0.88, 0.45, 0.35, 'rgba(70,200,255,.7)']]) glowAt(ctx, x, y, r, squash, colour);
    const random = seeded(seed); ctx.globalAlpha = 0.9; ctx.fillStyle = '#fff';
    for (let i = 0; i < 360; i++) { ctx.beginPath(); ctx.arc(random() * width, random() * height, (0.1 + random() * 0.25) * u, 0, Math.PI * 2); ctx.fill(); }
  } else if (finish === 'lenticular') {
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.16;
    for (let x = 0, i = 0; x < width; x += 0.8 * u, i++) { ctx.fillStyle = i % 2 ? '#e040fb' : '#29b6f6'; ctx.fillRect(x, 0, 0.8 * u, height); }
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
    for (let x = 0; x < width; x += 1.6 * u) ctx.fillRect(x, 0, 0.14 * u, height);
  } else if (finish === 'brushed') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.5;
    ctx.fillStyle = linear(ctx, 115, [['#7d858e', 0], ['#dfe5ea', 0.48], ['#69717a', 1]], 0, 0, width, height); ctx.fillRect(0, 0, width, height);
    const streak = ctx.createLinearGradient(0, height * 0.24, 0, height * 0.52);
    [['rgba(255,255,255,0)', 0], ['rgba(255,255,255,.9)', 0.5], ['rgba(255,255,255,0)', 1]].forEach(([colour, at]) => streak.addColorStop(at, colour));
    ctx.fillStyle = streak; ctx.fillRect(0, 0, width, height);
    const random = seeded(seed); ctx.globalAlpha = 0.16;
    for (let y = 0; y < height; y += 0.35 * u) { ctx.fillStyle = random() < 0.5 ? '#fff' : '#000'; ctx.fillRect(0, y, width, 0.12 * u); }
  } else if (finish === 'stained') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.5;
    ctx.fillStyle = linear(ctx, 160, [['#ff8a3d', 0], ['#c23dff', 1]], 0, 0, width, height); ctx.fillRect(0, 0, width, height);
    for (const [x, y, r, colour] of [[0.18, 0.22, 0.34, '#ff3d5a'], [0.8, 0.18, 0.34, '#2fd6c0'], [0.52, 0.52, 0.32, '#ffc84a'], [0.2, 0.82, 0.36, '#7a4dff'], [0.84, 0.8, 0.36, '#3d8bff']]) glowAt(ctx, x, y, r, 1, colour);
    ctx.globalAlpha = 0.3; ctx.strokeStyle = '#19120a'; ctx.lineWidth = 0.4 * u;
    hatch(ctx, 30, 11 * u); hatch(ctx, -30, 11 * u);
  } else if (finish === 'shield') {
    ctx.globalCompositeOperation = 'color-dodge'; ctx.globalAlpha = 0.3; ctx.strokeStyle = 'rgba(130,255,235,.9)'; ctx.lineWidth = 0.25 * u;
    for (const angle of [0, 60, 120]) hatch(ctx, angle, 3.35 * u);
  }
  ctx.restore();
}
// A soft round light at x, y (parts of the card), r of its width across, squashed to an ellipse.
function glowAt(ctx, x, y, r, squash, colour) {
  ctx.save(); ctx.translate(width * x, height * y); ctx.scale(1, squash);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, width * r); g.addColorStop(0, colour); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(-width * 2, -height * 4, width * 4, height * 8); ctx.restore();
}
// Parallel lines across the whole card at angle degrees (0 is across), spacing apart.
function hatch(ctx, angle, spacing) {
  const a = angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), reach = Math.hypot(width, height);
  for (let k = -reach; k <= reach; k += spacing) { const x = width / 2 - dy * k, y = height / 2 + dx * k; ctx.beginPath(); ctx.moveTo(x - dx * reach, y - dy * reach); ctx.lineTo(x + dx * reach, y + dy * reach); ctx.stroke(); }
}

// The card in look as a PNG (a Blob). images is where the backend serves the armory's images.
export async function cardImage(answer, look, images) {
  const p = answer.profile, design = palettes[look.design] || palettes.elysea, full = look.options.layout === 'full';
  // The accent colour and frame the card chose over its design's.
  const accent = cardAccents().find(([key]) => key && key === look.options.accent)?.[2];
  const c = { ...design, ...(accent ? { accent, artBorder: accent } : {}) };
  if (look.options.frame in frames(c.accent)) c.frame = frames(c.accent)[look.options.frame];
  const ink = full ? '#fff' : c.ink, muted = full ? 'rgba(255,255,255,.8)' : c.muted, panelFill = full ? 'rgba(8,10,12,.62)' : c.panel, lineColour = full ? 'rgba(255,255,255,.22)' : c.line;
  const skills = cardSkills(p.skills, look.options.skills), stats = cardStats(p.stats, look.options.stats), line = cardLine(p, look.options.line);
  await Promise.all(['800', '750', '650'].map(w => document.fonts?.load(`${w} 40px "Manrope Variable"`)).concat(['600', '700', '500'].map(w => document.fonts?.load(`${w} 20px "DM Sans Variable"`)))).catch(() => { /* the fallback fonts draw it */ });
  const [portrait, classIcon, ...skillIcons] = await Promise.all([load(imageUrl(images, p.portrait)), load(imageUrl(images, answer.classIcon)), ...skills.map(s => load(imageUrl(images, s.icon)))]);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  // The portrait (512 pixels from PLAYNC) and the icons are drawn larger than they are: smoothly.
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  roundRect(ctx, 0, 0, width, height, 4.6 * u); ctx.clip();
  background(ctx, c);
  const pad = 5.4 * u, inner = width - pad * 2;
  // The art: a window under the name, or the whole card.
  const art = full ? [0, 0, width, height] : [pad, 15 * u, inner, 50 * u];
  ctx.save(); if (!full) { roundRect(ctx, ...art, 2.4 * u); ctx.clip(); }
  ctx.fillStyle = fill(ctx, c.art, ...art); ctx.fillRect(...art);
  if (portrait) cover(ctx, portrait, ...art, full ? 0.12 : 0.18);
  else write(ctx, [...String(p.name || '?')].slice(0, 2).join('').toUpperCase(), art[0] + art[2] / 2, art[1] + art[3] / 2 + 7 * u, { font: `800 ${20 * u}px ${heading}`, colour: full ? 'rgba(255,255,255,.3)' : c.ink + '48', align: 'center' });
  if (full) { const g = ctx.createLinearGradient(0, 0, 0, height); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(0.2, 'rgba(0,0,0,0)'); g.addColorStop(0.42, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.75)'); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); }
  ctx.restore();
  if (!full) { ctx.strokeStyle = c.artBorder || c.accent; ctx.lineWidth = 0.7 * u; roundRect(ctx, ...art, 2.4 * u); ctx.stroke(); }
  holo(ctx, look.finish, p.name || '');
  frame(ctx, c);
  // Name and level.
  // The name, in gold leaf or glowing in the accent colour if the card says so.
  const gold = ctx.createLinearGradient(0, pad, 0, pad + 7.4 * u); [['#fff8dc', 0], ['#f0c95a', 0.48], ['#b07a22', 1]].forEach(([colour, at]) => gold.addColorStop(at, colour));
  write(ctx, p.name, pad + u, pad + 6.2 * u, { font: `800 ${7.4 * u}px ${heading}`, colour: look.options.nameStyle === 'gold' ? gold : ink, max: inner - 24 * u, shadow: full || look.options.nameStyle === 'gold', glow: look.options.nameStyle === 'glow' ? c.accent : '' });
  let right = width - pad - u;
  if (classIcon) { ctx.drawImage(classIcon, right - 6.4 * u, pad + 0.6 * u, 6.4 * u, 6.4 * u); right -= 7.8 * u; }
  write(ctx, t('Lv {level}', { level: p.level }), right, pad + 6 * u, { font: `750 ${4.2 * u}px ${heading}`, colour: ink, align: 'right', shadow: full });
  // From the bottom: the footer, the panel, then the line and type over it.
  const footTop = height - 4.4 * u - 7.6 * u;
  const rows = [[7.6, 'power'], [4.8, 'level'], ...(skills.length ? [[2.4 + skills.length * 6.2, 'moves']] : []), ...(stats.length ? [[Math.ceil(stats.length / 3) * 4, 'stats']] : [])];
  const content = rows.reduce((n, [h]) => n + h, 0) * u + (rows.length - 1) * 1.3 * u, panelHeight = full ? content + 4.8 * u : footTop - 1.8 * u - 78.9 * u;
  const panelTop = footTop - 1.8 * u - panelHeight;
  const lineTop = full ? panelTop - 1.8 * u - (line ? 4.7 * u : 0) : 72.4 * u, typeTop = full ? lineTop - (line ? 1 * u : 1.8 * u) - 4.8 * u : 66.8 * u;
  write(ctx, p.class || '', pad + u, typeTop + 3.5 * u, { font: `600 ${3.6 * u}px ${text}`, colour: muted, shadow: full });
  write(ctx, raceName(p.race), width - pad - u, typeTop + 3.5 * u, { font: `600 ${3.6 * u}px ${text}`, colour: muted, align: 'right', shadow: full });
  if (line) write(ctx, line.kind === 'legion' ? t('Legion {name}', { name: line.text }) : line.text, pad + u, lineTop + 3.6 * u, { font: `${line.kind === 'title' ? 'italic ' : ''}600 ${3.5 * u}px ${text}`, colour: line.kind === 'legion' ? c.accent : gradeColours[String(line.grade).toLowerCase()] || ink, max: inner - 2 * u, shadow: full });
  ctx.fillStyle = panelFill; roundRect(ctx, pad, panelTop, inner, panelHeight, 2.4 * u); ctx.fill();
  ctx.strokeStyle = lineColour; ctx.lineWidth = 0.3 * u; ctx.stroke();
  const left = pad + 3.2 * u, end = width - pad - 3.2 * u, number = v => Number(v || 0).toLocaleString('en-US');
  let y = panelTop + (panelHeight - content) / 2;
  for (const [h, kind] of rows) {
    if (kind === 'power' || kind === 'level') {
      write(ctx, kind === 'power' ? t('Combat power') : t('Item level'), left, y + h * u * 0.85, { font: `500 ${3.4 * u}px ${text}`, colour: muted });
      write(ctx, number(kind === 'power' ? p.combatPower : p.itemLevel), end, y + h * u * 0.88, { font: `800 ${(kind === 'power' ? 7.6 : 4.8) * u}px ${heading}`, colour: ink, align: 'right' });
    } else if (kind === 'moves') {
      ctx.strokeStyle = lineColour; ctx.lineWidth = 0.3 * u;
      for (const at of [y, y + h * u]) { ctx.beginPath(); ctx.moveTo(left, at); ctx.lineTo(end, at); ctx.stroke(); }
      skills.forEach((s, i) => {
        const top = y + 1.2 * u + i * 6.2 * u;
        ctx.fillStyle = 'rgba(0,0,0,.25)'; roundRect(ctx, left, top, 5.6 * u, 5.6 * u, u); ctx.fill();
        if (skillIcons[i]) ctx.drawImage(skillIcons[i], left, top, 5.6 * u, 5.6 * u);
        write(ctx, s.name, left + 7.6 * u, top + 4.1 * u, { font: `600 ${3.6 * u}px ${text}`, colour: ink, max: end - left - 22 * u });
        write(ctx, t('Lv {level}', { level: s.level }), end, top + 4.1 * u, { font: `700 ${3.6 * u}px ${text}`, colour: c.accent, align: 'right' });
      });
    } else {
      const column = (end - left - 4 * u) / 3;
      stats.forEach((s, i) => {
        const x = left + (i % 3) * (column + 2 * u), top = y + Math.floor(i / 3) * 4 * u;
        write(ctx, s.name, x, top + 3.1 * u, { font: `500 ${2.9 * u}px ${text}`, colour: muted, max: column - 7 * u });
        write(ctx, number(s.value), x + column, top + 3.1 * u, { font: `700 ${3.2 * u}px ${text}`, colour: ink, align: 'right' });
      });
    }
    y += h * u + 1.3 * u;
  }
  // The footer: Daevanion and titles, the set mark and where the card is from.
  const boards = (p.boards || []).reduce((n, b) => ({ open: n.open + b.open, total: n.total + b.total }), { open: 0, total: 0 });
  const footFont = { font: `500 ${2.8 * u}px ${text}`, colour: muted, shadow: full };
  if (boards.total) write(ctx, t('Daevanion {open}/{total}', { open: boards.open, total: boards.total }), pad + u, footTop + 3.1 * u, footFont);
  if (p.titles?.total) write(ctx, t('Titles {owned}/{total}', { owned: p.titles.owned, total: p.titles.total }), pad + u, footTop + 6.9 * u, footFont);
  const mark = `odyle. ${String(answer.region).toUpperCase()} ${answer.serverId}`;
  write(ctx, mark, width - pad - u, footTop + 6.9 * u, { ...footFont, font: `700 ${2.8 * u}px ${text}`, align: 'right' });
  ctx.font = `700 ${2.8 * u}px ${text}`;
  const gem = width - pad - u - ctx.measureText(mark).width - 3 * u, colour = gradeColours[gradeName(p.gear)];
  ctx.save(); ctx.translate(gem, footTop + 5.9 * u); ctx.rotate(Math.PI / 4); ctx.fillStyle = colour; ctx.shadowColor = colour; ctx.shadowBlur = 1.4 * u; ctx.fillRect(-1.3 * u, -1.3 * u, 2.6 * u, 2.6 * u); ctx.restore();
  // A soft light from the top left, as on the card on screen.
  const glare = ctx.createRadialGradient(width * 0.3, height * 0.2, 0, width * 0.3, height * 0.2, width * 1.1);
  glare.addColorStop(0, 'rgba(255,255,255,.22)'); glare.addColorStop(0.4, 'rgba(255,255,255,0)'); glare.addColorStop(1, 'rgba(0,0,0,.12)');
  ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = glare; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over';
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// The file name a card's picture is saved under.
export const imageName = p => `${String(p.name || 'character').replace(/[^\p{L}\p{N}_-]+/gu, '') || 'character'}-odyle-card.png`;

// Saves the card in look as a picture in the browser's downloads.
export async function saveCardImage(answer, look, images) {
  const blob = await cardImage(answer, look, images);
  if (!blob) throw new Error('This browser could not draw the card.');
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = imageName(answer.profile); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
