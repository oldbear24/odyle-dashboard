migrate((app) => {
  // The dashboard never shows PocketBase's default account avatar, yet the owner
  // update rule let every account upload one (5 MB, rewritten at will). Remove the
  // field so the display name is the only profile data an account can write.
  const users = app.findCollectionByNameOrId('users');
  if (users.fields.getByName('avatar')) { users.fields.removeByName('avatar'); app.save(users); }
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.add(new FileField({ name: 'avatar', maxSelect: 1, maxSize: 0, mimeTypes: ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp'] }));
  app.save(users);
});
