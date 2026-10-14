const validate = require(__hooks + '/lib/validation.cjs');
// Server-wide game rules, kept in the single odyle_settings record. Superusers edit
// them on the dashboard's Odyle page (pb_hooks/admin) or under Collections →
// odyle_settings. Launch defaults: 40 Odyle per cube, resets at 07:00 UTC and
// weekly on Wednesday (the Global service).
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const defaults = { odylePerCube: 40, dailyResetHour: 7, weeklyResetDay: 'wednesday' };
function find(app) { try { return app.findFirstRecordByFilter('odyle_settings', 'id != ""'); } catch { return null; } }
function read(app) {
  const s = find(app); if (!s) return { ...defaults };
  return { odylePerCube: s.getInt('odylePerCube') || defaults.odylePerCube, dailyResetHour: s.getInt('dailyResetHour'), weeklyResetDay: s.getString('weeklyResetDay') || defaults.weeklyResetDay };
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
  for (const key in next) s.set(key, next[key]);
  app.save(s); return read(app);
}
module.exports = { days, defaults, read, write };
