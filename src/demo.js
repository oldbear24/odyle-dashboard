// The demo workspace (#/demo): a sample room to try the dashboard without signing in, and the
// made-up history of its characters for the history dialog. It loads with the demo (main.js).
import { t } from './i18n.js';

// The sample room at now: its members and their characters, the wishlist, the classes' roles,
// a planned run and the information board.
export function demoRoom(now) {
  const members = [{ id: 'd1', user: 'dave', displayName: 'DaveCZ', role: 'owner', sharing: true, characters: [
    { id: 'c1', characterName: 'DaveCZ', className: 'Templar', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 265, confirmed: true, valid: true, gameGroup: { party: 'demo-party', force: 'demo-force' }, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 3000).toISOString() },
    { id: 'c2', characterName: 'DaveAlt', className: 'Chanter', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 80, confirmed: true, valid: false, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 120000).toISOString() },
  ] }, { id: 'd2', user: 'lumina', displayName: 'Lumina', role: 'reporter', sharing: true, characters: [{ id: 'c3', characterName: 'Lumina', className: 'Cleric', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 180, confirmed: true, valid: true, gameGroup: { party: 'demo-party', force: 'demo-force' }, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 9000).toISOString() }] },
  { id: 'd3', user: 'kaelen', displayName: 'Kaelen', role: 'reporter', sharing: true, characters: [{ id: 'c4', characterName: 'Kaelen', className: 'Ranger', server: 'Atreia', region: 'GLOBAL_EU', source: 'packet', value: 35, confirmed: true, valid: true, gameGroup: { party: 'demo-party-2', force: 'demo-force' }, lastSeenAt: new Date(now).toISOString(), lastReadingAt: new Date(now - 12000).toISOString() }] },
  { id: 'd4', user: 'nyx', displayName: 'Nyx', role: 'reporter', sharing: false, characters: [] }];
  return {
    room: { id: 'demo', owner: 'demo', name: t('The evening expedition'), cost: 40 }, members,
    wishlist: [{ key: 'fire temple', dungeon: 'Fire Temple', users: ['dave', 'lumina', 'kaelen'] }, { key: 'draupnir cave', dungeon: 'Draupnir Cave', users: ['lumina', 'nyx'] }, { key: 'udas temple (hard)', dungeon: 'Udas Temple (Hard)', users: ['kaelen'] }],
    classRoles: [{ class: 'Templar', role: 'tank' }, { class: 'Cleric', role: 'healer' }, { class: 'Chanter', role: 'support' }, { class: 'Ranger', role: 'damage' }],
    runs: [{ id: 'r1', dungeon: 'Fire Temple', startsAt: new Date(Math.ceil((now + 3600000) / 1800000) * 1800000).toISOString(), note: t('Bring potions'), planner: 'dave', attendees: ['dave', 'lumina'] }],
    board: { text: [t('Fire Temple every Wednesday at 20:00: bring potions and food.'), t('New here? Share your main character and add the dungeons you still need to the wishlist.')].join('\n\n'), by: 'dave', at: new Date(now - 2 * 3600000).toISOString() },
  };
}

// Demo characters get a made-up history so the chart can be tried without signing in. It
// spans less than a week, so every period shows all of it.
export function demoHistory(members, id, days = 30) {
  const c = members.flatMap(m => m.characters || []).find(x => x.id === id), now = Date.now(), readings = [];
  let value = Math.max(0, (c?.value || 100) - 90);
  for (let i = 12; i >= 0; i--) { readings.push({ value, at: new Date(now - i * 5 * 3600000 - 600000).toISOString() }); value = i ? Math.max(0, value + [15, 20, -40, 10, 25, 5][i % 6]) : c?.value || value; }
  readings[readings.length - 1].value = c?.value || value;
  return { readings, days, keepDays: 30 };
}
