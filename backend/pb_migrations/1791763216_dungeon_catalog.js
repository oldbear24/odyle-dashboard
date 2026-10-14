migrate((app) => {
  // An optional list of dungeon names superusers keep on the dashboard's Odyle page.
  // While it is empty, wishlists and planned runs take any name; once it lists
  // dungeons, new entries must be one of them and take its spelling.
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.add(new JSONField({ name: 'dungeons', maxSize: 20000 }));
  app.save(settings);
  for (const record of app.findAllRecords('odyle_settings')) { record.set('dungeons', []); app.save(record); }
}, (app) => {
  const settings = app.findCollectionByNameOrId('odyle_settings');
  settings.fields.removeByName('dungeons'); app.save(settings);
});
