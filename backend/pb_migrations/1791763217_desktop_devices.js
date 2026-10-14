migrate((app) => {
  // Lasting pairings of Windows apps. Pairing hands the app a device key; the server
  // keeps only its digest. The app trades the key for a fresh account token whenever
  // it starts or its seven-day token runs out, so a paired PC stays connected however
  // long it is closed, until the app disconnects, the account signs out everywhere or
  // is deleted. No API rules: the /api/odyle routes read and write them.
  const users = app.findCollectionByNameOrId('users');
  app.save(new Collection({ name: 'desktop_devices', type: 'base', fields: [
    { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
    { name: 'digest', type: 'text', required: true },
    { name: 'lastUsedAt', type: 'date' },
    { name: 'created', type: 'autodate', onCreate: true }, { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ], indexes: ['CREATE UNIQUE INDEX idx_desktop_device ON desktop_devices (digest)', 'CREATE INDEX idx_desktop_devices_user ON desktop_devices (user)'] }));
  // Device sign-in and unpairing are public like pairing. A key has 48 random characters,
  // so their cap only stops runaway clients: an app signs in at start and once a day.
  const settings = app.settings();
  settings.rateLimits.rules.push({ label: '/api/odyle/desktop-sign-in', maxRequests: 30, duration: 60 }, { label: '/api/odyle/unpair', maxRequests: 30, duration: 60 });
  app.save(settings);
}, (app) => {
  app.delete(app.findCollectionByNameOrId('desktop_devices'));
  const settings = app.settings();
  settings.rateLimits.rules = settings.rateLimits.rules.filter(r => !['/api/odyle/desktop-sign-in', '/api/odyle/unpair'].includes(r.label));
  app.save(settings);
});
