migrate((app) => {
  // Accounts change their profile only through POST /api/odyle/profile, which checks
  // the display name. The users collection's own update API also accepted names of
  // only spaces and let an account move its lastActiveAt into the future, out of
  // reach of the inactive-account clean-up. Only the hooks write users records now.
  const users = app.findCollectionByNameOrId('users');
  users.updateRule = null; app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.updateRule = 'id = @request.auth.id'; app.save(users);
});
