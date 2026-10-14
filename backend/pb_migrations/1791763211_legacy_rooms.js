migrate((app) => {
  // The anonymous rooms of 1791763200_odyle.js (rooms, members, invites) were
  // replaced by the account-based party_rooms, room_members and room_invites in
  // 1791763201_accounts.js, which also locked their API rules. No hook or client
  // reads them since, so drop them with whatever records they still hold.
  for (const name of ['invites', 'members', 'rooms']) app.delete(app.findCollectionByNameOrId(name));
}, (app) => {
  // Restores the empty, locked collections as 1791763201_accounts.js left them.
  const rooms = new Collection({ name: 'rooms', type: 'base', fields: [
    { name: 'name', type: 'text', required: true, max: 60 },
    { name: 'cost', type: 'number', min: 1, max: 1000, onlyInt: true, required: true },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'created', type: 'autodate', onCreate: true },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ] });
  app.save(rooms);
  app.save(new Collection({ name: 'members', type: 'auth',
    passwordAuth: { enabled: false }, authToken: { duration: 86400 },
    fields: [
      { name: 'room', type: 'relation', collectionId: rooms.id, cascadeDelete: true, maxSelect: 1, required: true },
      { name: 'role', type: 'select', values: ['owner', 'reporter', 'viewer'], maxSelect: 1, required: true },
      { name: 'displayName', type: 'text', max: 40, required: true },
      { name: 'characterName', type: 'text', max: 40 }, { name: 'server', type: 'text', max: 40 },
      { name: 'region', type: 'select', values: ['GLOBAL_EU', 'GLOBAL_NA', 'GLOBAL_SA', 'GLOBAL_ASIA'], maxSelect: 1 },
      { name: 'value', type: 'number', min: 0, max: 1000000, onlyInt: true },
      { name: 'confirmed', type: 'bool' }, { name: 'sharing', type: 'bool' },
      { name: 'source', type: 'select', values: ['manual', 'packet'], maxSelect: 1 },
      { name: 'sequence', type: 'number', min: 0, max: 9007199254740991, onlyInt: true },
      { name: 'sessionId', type: 'text', hidden: true, max: 64 },
      { name: 'lastSeenAt', type: 'date' }, { name: 'lastReadingAt', type: 'date' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ] }));
  app.save(new Collection({ name: 'invites', type: 'base', fields: [
    { name: 'room', type: 'relation', collectionId: rooms.id, cascadeDelete: true, maxSelect: 1, required: true },
    { name: 'digest', type: 'text', required: true },
    { name: 'role', type: 'select', values: ['reporter', 'viewer'], maxSelect: 1, required: true },
    { name: 'expiresAt', type: 'date', required: true },
  ], indexes: ['CREATE UNIQUE INDEX idx_invite_digest ON invites (digest)'] }));
});
