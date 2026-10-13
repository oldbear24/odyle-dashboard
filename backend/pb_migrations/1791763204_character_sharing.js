migrate((app) => {
  // Sharing moves from one flag per membership to an explicit list of the
  // member's own characters. Memberships that shared everything keep sharing
  // every character they had at upgrade time.
  const members = app.findCollectionByNameOrId('room_members'), characters = app.findCollectionByNameOrId('characters');
  members.fields.add(new RelationField({ name: 'sharedCharacters', collectionId: characters.id, maxSelect: 500, cascadeDelete: false }));
  app.save(members);
  for (const m of app.findRecordsByFilter('room_members', 'sharing = true', '', 0, 0)) {
    m.set('sharedCharacters', app.findRecordsByFilter('characters', 'user = {:user}', 'created', 0, 0, { user: m.getString('user') }).map(c => c.id)); app.save(m);
  }
  members.fields.removeByName('sharing');
  app.save(members);
}, (app) => {
  const members = app.findCollectionByNameOrId('room_members');
  members.fields.add(new BoolField({ name: 'sharing' }));
  app.save(members);
  for (const m of app.findRecordsByFilter('room_members', 'id != ""', '', 0, 0)) { m.set('sharing', m.getStringSlice('sharedCharacters').length > 0); app.save(m); }
  members.fields.removeByName('sharedCharacters');
  app.save(members);
});
