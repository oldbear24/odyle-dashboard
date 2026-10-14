migrate((app) => {
  // Accounts can now be deleted by their owner and, when a superuser sets
  // inactiveAccountDays, after that many days without using the dashboard or the
  // Windows app. lastActiveAt is the last time the account used an Odyle route
  // (written at most hourly); existing accounts count as active from this upgrade.
  const users = app.findCollectionByNameOrId('users');
  users.fields.add(new DateField({ name: 'lastActiveAt' }));
  users.addIndex('idx_users_last_active', false, '`lastActiveAt`', '');
  app.save(users);
  const now = new Date().toISOString().replace('T', ' ');
  for (const user of app.findAllRecords('users')) { user.set('lastActiveAt', now); app.save(user); }
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.add(new NumberField({ name: 'inactiveAccountDays', min: 0, max: 3650, onlyInt: true }));
  app.save(settings);
  for (const record of app.findAllRecords('odyle_settings')) { record.set('inactiveAccountDays', 0); app.save(record); }
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.removeIndex('idx_users_last_active'); users.fields.removeByName('lastActiveAt'); app.save(users);
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.removeByName('inactiveAccountDays'); app.save(settings);
});
