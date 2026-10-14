migrate((app) => {
  // Server controls of the superuser dashboard's Odyle page: an announcement the dashboard
  // and the Windows app show, switches that pause portrait refresh, Discord reminders and
  // new pairings, and packet adapters accepted beside (or instead of) the built-in ones.
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.add(new TextField({ name: 'announcement', max: 300 }));
  settings.fields.add(new TextField({ name: 'announcementLevel', max: 10 }));
  for (const name of ['portraitsPaused', 'remindersPaused', 'pairingPaused']) settings.fields.add(new BoolField({ name }));
  settings.fields.add(new JSONField({ name: 'adapters', maxSize: 5000 }));
  app.save(settings);
  for (const record of app.findAllRecords('odyle_settings')) { record.set('announcementLevel', 'info'); record.set('adapters', { extra: [], disabled: [] }); app.save(record); }
  // A reader session remembers the Windows app version that opened it, for the Apps page.
  const sessions = app.findCollectionByNameOrId('publisher_sessions');
  sessions.fields.add(new TextField({ name: 'appVersion', max: 20 })); app.save(sessions);
}, (app) => {
  const sessions = app.findCollectionByNameOrId('publisher_sessions'); sessions.fields.removeByName('appVersion'); app.save(sessions);
  const settings = app.findCollectionByNameOrId('odyle_settings');
  for (const name of ['announcement', 'announcementLevel', 'portraitsPaused', 'remindersPaused', 'pairingPaused', 'adapters']) settings.fields.removeByName(name);
  app.save(settings);
});
