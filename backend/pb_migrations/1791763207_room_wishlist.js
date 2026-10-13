migrate((app) => {
  // Dungeons room members still need to run. One record per member and dungeon;
  // `key` is the normalized name, so "Fire temple" and "fire  Temple" are one
  // entry. Records belong to the membership, so leaving, removal or closing the
  // room deletes them. No API rules: rooms read the list through the snapshot
  // route and change it through POST /api/odyle/wishlist.
  const rooms = app.findCollectionByNameOrId('party_rooms'), members = app.findCollectionByNameOrId('room_members');
  app.save(new Collection({ name: 'room_wishes', type: 'base', fields: [
    { name: 'room', type: 'relation', collectionId: rooms.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'member', type: 'relation', collectionId: members.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'dungeon', type: 'text', required: true, max: 60 }, { name: 'key', type: 'text', required: true, max: 60 },
    { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ], indexes: ['CREATE UNIQUE INDEX idx_room_wish ON room_wishes (member, key)', 'CREATE INDEX idx_room_wishes_room ON room_wishes (room)'] }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId('room_wishes'));
});
