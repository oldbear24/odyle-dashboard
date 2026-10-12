migrate((app) => {
  for (const name of ['rooms', 'members', 'invites']) {
    const old = app.findCollectionByNameOrId(name); old.listRule = null; old.viewRule = null; app.save(old);
  }
  const dates = [{ name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }];
  const clientId = $os.getenv('DISCORD_CLIENT_ID'), clientSecret = $os.getenv('DISCORD_CLIENT_SECRET');
  const users = app.findCollectionByNameOrId('users');
  users.createRule = null; users.deleteRule = null; users.manageRule = null;
  users.listRule = 'id = @request.auth.id'; users.viewRule = users.listRule; users.updateRule = users.listRule;
  users.fields.add(new TextField({ name: 'displayName', required: true, max: 40 }));
  users.passwordAuth = { enabled: false };
  users.oauth2 = { enabled: Boolean(clientId && clientSecret), providers: clientId && clientSecret ? [{ name: 'discord', clientId, clientSecret }] : [] };
  users.authToken.duration = 604800;
  app.save(users);
  const own = 'user = @request.auth.id';
  const rooms = new Collection({ name: 'party_rooms', type: 'base', fields: [
    { name: 'owner', type: 'relation', collectionId: users.id, maxSelect: 1, required: true },
    { name: 'name', type: 'text', required: true, max: 60 }, { name: 'cost', type: 'number', min: 1, max: 1000, onlyInt: true, required: true }, ...dates,
  ] }); app.save(rooms);
  const relation = { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true };
  const sessions = new Collection({ name: 'publisher_sessions', type: 'base', fields: [relation,
    { name: 'sequence', type: 'number', onlyInt: true, min: 0, max: 9007199254740991 },
    { name: 'expiresAt', type: 'date', required: true }, ...dates,
  ] }); app.save(sessions);
  app.save(new Collection({ name: 'characters', type: 'base', listRule: own, viewRule: own, fields: [relation,
    { name: 'characterName', type: 'text', required: true, max: 40 }, { name: 'server', type: 'text', required: true, max: 40 },
    { name: 'region', type: 'select', values: ['GLOBAL_EU', 'GLOBAL_NA', 'GLOBAL_SA', 'GLOBAL_ASIA'], required: true, maxSelect: 1 },
    { name: 'value', type: 'number', min: 0, max: 1000000, onlyInt: true }, { name: 'confirmed', type: 'bool' }, { name: 'valid', type: 'bool' },
    { name: 'source', type: 'select', values: ['manual', 'packet'], maxSelect: 1 },
    { name: 'readingSession', type: 'relation', collectionId: sessions.id, maxSelect: 1, hidden: true },
    { name: 'lastReadingAt', type: 'date' }, { name: 'lastSeenAt', type: 'date' }, ...dates,
  ], indexes: ['CREATE UNIQUE INDEX idx_character_identity ON characters (user, region, server, characterName)'] }));
  app.save(new Collection({ name: 'room_members', type: 'base', listRule: own, viewRule: own, fields: [relation,
    { name: 'room', type: 'relation', collectionId: rooms.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'role', type: 'select', values: ['owner', 'reporter', 'viewer'], maxSelect: 1, required: true }, { name: 'sharing', type: 'bool' }, ...dates,
  ], indexes: ['CREATE UNIQUE INDEX idx_room_user ON room_members (room, user)'] }));
  app.save(new Collection({ name: 'room_invites', type: 'base', fields: [
    { name: 'room', type: 'relation', collectionId: rooms.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'digest', type: 'text', required: true }, { name: 'role', type: 'select', values: ['reporter', 'viewer'], required: true, maxSelect: 1 },
    { name: 'expiresAt', type: 'date', required: true },
  ], indexes: ['CREATE UNIQUE INDEX idx_room_code ON room_invites (digest)'] }));
  app.save(new Collection({ name: 'desktop_codes', type: 'base', fields: [relation,
    { name: 'digest', type: 'text', required: true }, { name: 'expiresAt', type: 'date', required: true },
  ], indexes: ['CREATE UNIQUE INDEX idx_desktop_code ON desktop_codes (digest)'] }));
  const settings = app.settings();
  settings.rateLimits.rules.push({ label: '/api/odyle/pair', maxRequests: 10, duration: 60 }, { label: 'users:auth', maxRequests: 10, duration: 60 }); app.save(settings);
}, (app) => {
  for (const name of ['desktop_codes', 'room_invites', 'room_members', 'characters', 'publisher_sessions', 'party_rooms', 'users']) app.delete(app.findCollectionByNameOrId(name));
});
