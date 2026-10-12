migrate((app) => {
  const characters = app.findCollectionByNameOrId('characters');
  characters.fields.add(new TextField({ name: 'parserVersion', max: 80 }));
  app.save(characters);
  // Preserve historical totals while removing manual confidence.
  const old = app.findRecordsByFilter('characters', 'source = "manual"', '', 0, 0);
  for (const record of old) { record.set('valid', false); app.save(record); }
}, (app) => {
  const characters = app.findCollectionByNameOrId('characters');
  characters.fields.removeByName('parserVersion');
  app.save(characters);
});
