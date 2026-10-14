const validate = require(__hooks + '/lib/validation.cjs');
const protocols = require(__hooks + '/lib/protocols.cjs');
// Server-wide game rules and server controls, kept in the single odyle_settings record.
// Superusers edit them on the dashboard's Odyle pages (pb_hooks/admin) or under
// Collections → odyle_settings. Launch defaults: 40 Odyle per cube, resets at 07:00 UTC
// and weekly on Wednesday (the Global service), inactive accounts are kept for good and
// the dungeon catalog is empty, so wishlists and runs take any name. No announcement,
// nothing paused, and the packet adapters of protocols.cjs are the accepted ones.
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const levels = ['info', 'warning'], switches = ['portraitsPaused', 'remindersPaused', 'pairingPaused'];
const defaults = { odylePerCube: 40, dailyResetHour: 7, weeklyResetDay: 'wednesday', inactiveAccountDays: 0, dungeons: [], announcement: '', announcementLevel: 'info', portraitsPaused: false, remindersPaused: false, pairingPaused: false, adapters: { extra: [], disabled: [] } };
const fresh = () => ({ ...defaults, dungeons: [], adapters: { extra: [], disabled: [] } });
function find(app) { try { return app.findFirstRecordByFilter('odyle_settings', 'id != ""'); } catch { return null; } }
const json = (record, name, empty) => { try { return JSON.parse(record.getString(name) || empty); } catch { return JSON.parse(empty); } };
const names = value => Array.isArray(value) ? value.filter(name => typeof name === 'string') : [];
function catalog(record) { return names(json(record, 'dungeons', '[]')); }
function adapterLists(record) { const value = json(record, 'adapters', '{}') || {}; return { extra: names(value.extra), disabled: names(value.disabled) }; }
function read(app) {
  const s = find(app); if (!s) return fresh();
  return { odylePerCube: s.getInt('odylePerCube') || defaults.odylePerCube, dailyResetHour: s.getInt('dailyResetHour'), weeklyResetDay: s.getString('weeklyResetDay') || defaults.weeklyResetDay, inactiveAccountDays: s.getInt('inactiveAccountDays'), dungeons: catalog(s),
    announcement: s.getString('announcement'), announcementLevel: levels.includes(s.getString('announcementLevel')) ? s.getString('announcementLevel') : 'info',
    portraitsPaused: s.getBool('portraitsPaused'), remindersPaused: s.getBool('remindersPaused'), pairingPaused: s.getBool('pairingPaused'), adapters: adapterLists(s) };
}
// The catalog keeps the first spelling of each dungeon; names match regardless of case and spacing.
function dungeons(value) {
  if (!Array.isArray(value)) throw new Error('Dungeons must be a list of names.');
  const seen = {}, list = [];
  for (const name of value) { const d = validate.dungeon(name); if (!seen[d.key]) { seen[d.key] = true; list.push(d.dungeon); } }
  if (list.length > 200) throw new Error('The dungeon list can hold up to 200 names.');
  return list;
}
// Built-in adapters (protocols.cjs) stay accepted unless disabled here, so an adapter a
// deploy adds is accepted at once; extra names accept a decoder before the next deploy.
const adapterName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const accepted = lists => protocols.verifiedAdapters.filter(name => !lists.disabled.includes(name)).concat(lists.extra);
function adapterSettings(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.extra) || !Array.isArray(value.disabled)) throw new Error('Packet adapters must list extra and disabled names.');
  const unique = list => {
    const out = [];
    for (const raw of list) { const name = typeof raw === 'string' ? raw.trim() : ''; if (!adapterName.test(name)) throw new Error('Adapter names use letters, digits, dots, dashes and underscores, up to 80 characters.'); if (!out.includes(name)) out.push(name); }
    return out;
  };
  const builtIn = protocols.verifiedAdapters, lists = { extra: unique(value.extra).filter(name => !builtIn.includes(name)), disabled: unique(value.disabled).filter(name => builtIn.includes(name)) };
  if (lists.extra.length > 20) throw new Error('Up to 20 extra packet adapters.');
  if (!accepted(lists).length) throw new Error('Keep at least one packet adapter accepted, or no reading can be saved.');
  return lists;
}
// Saves the given settings (all optional) and creates the record if a superuser deleted it.
function write(app, body) {
  const s = find(app) || new Record(app.findCollectionByNameOrId('odyle_settings')), next = { ...read(app) };
  if (body.odylePerCube !== undefined) next.odylePerCube = validate.integer(body.odylePerCube, 'Odyle per cube', 1, 1000);
  if (body.dailyResetHour !== undefined) next.dailyResetHour = validate.integer(body.dailyResetHour, 'Daily reset hour', 0, 23);
  if (body.weeklyResetDay !== undefined) {
    if (!days.includes(body.weeklyResetDay)) throw new Error('Choose the weekly reset day (sunday to saturday).');
    next.weeklyResetDay = body.weeklyResetDay;
  }
  if (body.inactiveAccountDays !== undefined) {
    next.inactiveAccountDays = validate.integer(body.inactiveAccountDays, 'Inactive account days', 0, 3650);
    if (next.inactiveAccountDays > 0 && next.inactiveAccountDays < 30) throw new Error('Delete inactive accounts after 30 days or more, or 0 to keep them.');
  }
  if (body.dungeons !== undefined) next.dungeons = dungeons(body.dungeons);
  // One line of plain text; clients render it as text, never as HTML.
  if (body.announcement !== undefined) {
    if (typeof body.announcement !== 'string') throw new Error('The announcement must be text.');
    next.announcement = body.announcement.trim().replace(/\s+/g, ' ');
    if (next.announcement.length > 300) throw new Error('The announcement can be up to 300 characters.');
  }
  if (body.announcementLevel !== undefined) {
    if (!levels.includes(body.announcementLevel)) throw new Error('Choose info or warning for the announcement.');
    next.announcementLevel = body.announcementLevel;
  }
  for (const key of switches) if (body[key] !== undefined) {
    if (typeof body[key] !== 'boolean') throw new Error('Switches must be true or false.');
    next[key] = body[key];
  }
  if (body.adapters !== undefined) next.adapters = adapterSettings(body.adapters);
  for (const key in next) s.set(key, next[key]);
  app.save(s); return read(app);
}
// The catalog spelling of a dungeon, the typed one while the catalog is empty, or null
// when a catalog exists and does not list it.
function dungeonName(app, typed) {
  const d = validate.dungeon(typed), list = read(app).dungeons;
  if (!list.length) return d;
  const listed = list.find(name => validate.dungeon(name).key === d.key);
  return listed ? { dungeon: listed, key: d.key } : null;
}
// The packet adapters whose readings are stored now.
const adapters = app => accepted(read(app).adapters);
// The message clients show above their pages, or null, from read() settings.
const announcement = s => s.announcement ? { text: s.announcement, level: s.announcementLevel } : null;
module.exports = { days, defaults, read, write, dungeonName, adapters, announcement };
