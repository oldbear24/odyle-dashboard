migrate((app) => {
  const rooms = new Collection({ name: 'rooms', type: 'base', fields: [
    { name: 'name', type: 'text', required: true, max: 60 },
    { name: 'cost', type: 'number', min: 1, max: 1000, onlyInt: true, required: true },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'created', type: 'autodate', onCreate: true },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ], listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null });
  app.save(rooms);
  const members = new Collection({ name: 'members', type: 'auth',
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
    ], listRule: '@request.auth.id != "" && room = @request.auth.room && room.expiresAt > @now',
    viewRule: '@request.auth.id != "" && room = @request.auth.room && room.expiresAt > @now',
    createRule: null, updateRule: null, deleteRule: null, manageRule: null });
  app.save(members);
  rooms.listRule = '@request.auth.id != "" && id = @request.auth.room && expiresAt > @now';
  rooms.viewRule = rooms.listRule;
  app.save(rooms);
  app.save(new Collection({ name: 'invites', type: 'base', fields: [
    { name: 'room', type: 'relation', collectionId: rooms.id, cascadeDelete: true, maxSelect: 1, required: true },
    { name: 'digest', type: 'text', required: true },
    { name: 'role', type: 'select', values: ['reporter', 'viewer'], maxSelect: 1, required: true },
    { name: 'expiresAt', type: 'date', required: true },
  ], indexes: ['CREATE UNIQUE INDEX idx_invite_digest ON invites (digest)'] }));
  const settings = app.settings();
  settings.meta.appName = 'Odyle Party';
  settings.logs.maxDays = 0;
  settings.logs.logIP = false;
  settings.logs.logAuthId = false;
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: '/api/odyle/create', maxRequests: 5, duration: 60 },
    { label: '/api/odyle/join', maxRequests: 10, duration: 60 },
    { label: '/api/odyle/', maxRequests: 120, duration: 60 },
  ];
  app.save(settings);
}, (app) => {
  for (const name of ['invites', 'members', 'rooms']) app.delete(app.findCollectionByNameOrId(name));
});
