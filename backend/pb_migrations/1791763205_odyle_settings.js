migrate((app) => {
  // Server-wide game rules. Only superusers can edit them, in the PocketBase
  // dashboard (Collections → odyle_settings); rooms no longer set their own cost.
  const settings = new Collection({ name: 'odyle_settings', type: 'base', fields: [
    { name: 'odylePerCube', type: 'number', min: 1, max: 1000, onlyInt: true, required: true },
  ] });
  app.save(settings);
  const record = new Record(settings); record.set('odylePerCube', 40); app.save(record);
}, (app) => {
  app.delete(app.findCollectionByNameOrId('odyle_settings'));
});
