migrate((app) => {
  // Odyle history: one record each time a character's value changes (the first
  // reading included), so owners and the rooms a character is shared in can see
  // how it moved. Records older than 30 days are deleted by the expiry cron and
  // deleting the character deletes them. No API rules: GET /api/odyle/history/{id}.
  const characters = app.findCollectionByNameOrId('characters');
  app.save(new Collection({ name: 'character_readings', type: 'base', fields: [
    { name: 'character', type: 'relation', collectionId: characters.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'value', type: 'number', min: 0, max: 1000000, onlyInt: true },
    { name: 'created', type: 'autodate', onCreate: true },
  ], indexes: ['CREATE INDEX idx_character_readings ON character_readings (character, created)', 'CREATE INDEX idx_character_readings_created ON character_readings (created)'] }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId('character_readings'));
});
