migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  // PocketBase creates first-time OAuth accounts through its record-create
  // handler, which applies createRule with this server-assigned context.
  users.createRule = '@request.context = "oauth2"';
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.createRule = null;
  app.save(users);
});
