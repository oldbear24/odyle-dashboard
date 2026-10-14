migrate((app) => {
  // Paired PCs carry the Windows computer name the app sends, so Account & data can
  // list them and remove one. A reader session remembers the pairing it was opened
  // with: removing the PC ends its sessions, and the app learns at its next heartbeat.
  const devices = app.findCollectionByNameOrId('desktop_devices');
  devices.fields.add(new TextField({ name: 'name', max: 40 })); app.save(devices);
  const sessions = app.findCollectionByNameOrId('publisher_sessions');
  sessions.fields.add(new RelationField({ name: 'device', collectionId: devices.id, maxSelect: 1, cascadeDelete: false })); app.save(sessions);
}, (app) => {
  const sessions = app.findCollectionByNameOrId('publisher_sessions'); sessions.fields.removeByName('device'); app.save(sessions);
  const devices = app.findCollectionByNameOrId('desktop_devices'); devices.fields.removeByName('name'); app.save(devices);
});
