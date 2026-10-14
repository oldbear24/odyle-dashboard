migrate((app) => {
  // Personal daily and weekly checklists. One record per task; doneAt is the last
  // time the account checked it. Clients show a task as done while that time is on
  // or after the start of the current reset period, so nothing has to uncheck
  // tasks at reset and nothing is deleted. The reset times are server settings
  // next to odylePerCube: the Global service resets at 07:00 UTC, weekly on
  // Wednesday. No API rules: GET /api/odyle/tasks reads, POST /api/odyle/task writes.
  const users = app.findCollectionByNameOrId('users');
  app.save(new Collection({ name: 'user_tasks', type: 'base', fields: [
    { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'title', type: 'text', required: true, max: 60 },
    { name: 'cadence', type: 'select', values: ['daily', 'weekly'], maxSelect: 1, required: true },
    { name: 'doneAt', type: 'date' },
    { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ], indexes: ['CREATE INDEX idx_user_tasks_user ON user_tasks (user)'] }));
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.add(new NumberField({ name: 'dailyResetHour', min: 0, max: 23, onlyInt: true }));
  settings.fields.add(new SelectField({ name: 'weeklyResetDay', values: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], maxSelect: 1 }));
  app.save(settings);
  for (const record of app.findAllRecords('odyle_settings')) { record.set('dailyResetHour', 7); record.set('weeklyResetDay', 'wednesday'); app.save(record); }
}, (app) => {
  app.delete(app.findCollectionByNameOrId('user_tasks'));
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.removeByName('dailyResetHour'); settings.fields.removeByName('weeklyResetDay'); app.save(settings);
});
