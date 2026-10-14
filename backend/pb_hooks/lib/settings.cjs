const validate = require(__hooks + '/lib/validation.cjs');
// Server-wide game rules, kept in the single odyle_settings record. Superusers edit
// them on the dashboard's Odyle page (pb_hooks/admin) or under Collections →
// odyle_settings. Launch defaults: 40 Odyle per cube, resets at 07:00 UTC and
// weekly on Wednesday (the Global service), inactive accounts are kept for good and
// the dungeon catalog is empty, so wishlists and runs take any name.
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const defaults = { odylePerCube: 40, dailyResetHour: 7, weeklyResetDay: 'wednesday', inactiveAccountDays: 0, dungeons: [] };
function find(app) { try { return app.findFirstRecordByFilter('odyle_settings', 'id != ""'); } catch { return null; } }
function catalog(record) {
  let list; try { list = JSON.parse(record.getString('dungeons') || '[]'); } catch { list = []; }
  return Array.isArray(list) ? list.filter(name => typeof name === 'string') : [];
}
function read(app) {
  const s = find(app); if (!s) return { ...defaults, dungeons: [] };
  return { odylePerCube: s.getInt('odylePerCube') || defaults.odylePerCube, dailyResetHour: s.getInt('dailyResetHour'), weeklyResetDay: s.getString('weeklyResetDay') || defaults.weeklyResetDay, inactiveAccountDays: s.getInt('inactiveAccountDays'), dungeons: catalog(s) };
}
// The catalog keeps the first spelling of each dungeon; names match regardless of case and spacing.
function dungeons(value) {
  if (!Array.isArray(value)) throw new Error('Dungeons must be a list of names.');
  const seen = {}, list = [];
  for (const name of value) { const d = validate.dungeon(name); if (!seen[d.key]) { seen[d.key] = true; list.push(d.dungeon); } }
  if (list.length > 200) throw new Error('The dungeon list can hold up to 200 names.');
  return list;
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
module.exports = { days, defaults, read, write, dungeonName };
