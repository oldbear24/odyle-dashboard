// Planned-run reminders in a room's Discord channel, through a webhook its owner
// connects under Room settings. The backend posts a test message when the webhook is
// saved and each run 15 minutes before it starts. Discord renders <t:…> timestamps in
// every reader's own time zone; mentions are switched off, so names and notes can
// never ping anyone.
// ODYLE_DISCORD_WEBHOOK_BASE replaces https://discord.com for tests.
const base = () => $os.getenv('ODYLE_DISCORD_WEBHOOK_BASE');
const path = /^\/api\/webhooks\/\d{5,30}\/[\w-]{20,120}$/;
function webhook(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return '';
  const test = base();
  if (test && url.startsWith(test + '/') && path.test(url.slice(test.length))) return url;
  const match = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com(\/.*)$/.exec(url);
  if (!match || !path.test(match[1])) throw new BadRequestError('Paste a Discord webhook URL (https://discord.com/api/webhooks/…).');
  return url;
}
// Discord markdown would let a dungeon or display name format the whole message.
const plain = text => String(text || '').replace(/([\\*_~`|>#[\]()])/g, '\\$1');
const words = {
  en: { connected: room => `Odyle will remind this channel of planned runs in **${room}**, 15 minutes before each one starts.`, starts: 'Starts', going: n => `Going (${n})`, nobody: 'Nobody yet', footer: room => `Odyle · ${room}` },
  cs: { connected: room => `Odyle bude tomuto kanálu připomínat plánované běhy místnosti **${room}**, 15 minut před začátkem každého.`, starts: 'Začíná', going: n => `Jdou (${n})`, nobody: 'Zatím nikdo', footer: room => `Odyle · ${room}` },
};
const say = language => words[language] || words.en;
function post(url, payload) {
  const res = $http.send({ url: url + '?wait=true', method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Odyle (AION 2 party dashboard)' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }), timeout: 10 });
  return res.statusCode;
}
// The test post of a newly connected webhook; throws when Discord refuses it.
function connect(url, roomName, language) {
  let status; try { status = post(url, { content: say(language).connected(plain(roomName)) }); } catch { throw new BadRequestError('Discord could not be reached. Try again in a minute.'); }
  if (status < 200 || status >= 300) throw new BadRequestError('Discord did not accept this webhook. Copy it again from the channel settings.');
}
function reminder({ roomName, dungeon, startsAt, note, going, language }) {
  const w = say(language), unix = Math.floor(Date.parse(String(startsAt).replace(' ', 'T')) / 1000);
  return { embeds: [{ title: plain(dungeon), color: 0x5ee0b0, description: `${w.starts} <t:${unix}:R> · <t:${unix}:f>${note ? '\n' + plain(note) : ''}`,
    fields: [{ name: w.going(going.length), value: going.length ? going.map(plain).join(', ').slice(0, 1000) : w.nobody }], footer: { text: w.footer(roomName).slice(0, 200) } }] };
}
module.exports = { webhook, post, connect, reminder };
