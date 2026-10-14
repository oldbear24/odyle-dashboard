migrate((app) => {
  // Planned runs: a dungeon, a start time and the members who are going. Owners and
  // players plan and join them, viewers read them. Runs are deleted a day after they
  // started, with the room, or by their planner or the room owner. A run keeps going
  // when its planner leaves the room; leaving takes the member off every attendee
  // list. No API rules: room snapshots list them and POST /api/odyle/plan changes them.
  const rooms = app.findCollectionByNameOrId('party_rooms'), members = app.findCollectionByNameOrId('room_members');
  app.save(new Collection({ name: 'room_runs', type: 'base', fields: [
    { name: 'room', type: 'relation', collectionId: rooms.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'dungeon', type: 'text', required: true, max: 60 },
    { name: 'startsAt', type: 'date', required: true },
    { name: 'note', type: 'text', max: 120 },
    { name: 'plannedBy', type: 'relation', collectionId: members.id, maxSelect: 1, cascadeDelete: false },
    { name: 'attendees', type: 'relation', collectionId: members.id, maxSelect: 50, cascadeDelete: false },
    { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ], indexes: ['CREATE INDEX idx_room_runs_room ON room_runs (room, startsAt)', 'CREATE INDEX idx_room_runs_start ON room_runs (startsAt)'] }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId('room_runs'));
});
