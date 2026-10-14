migrate((app) => {
  // Lookups the hooks run on every reading, page load and cron tick: an account's
  // memberships and reader sessions, the characters a session read, portraits that
  // are due and expired codes. Unique indexes from earlier migrations lead with
  // another column, so none of these could use them.
  const indexes = {
    room_members: [['idx_room_members_user', 'user']],
    characters: [['idx_characters_session', 'readingSession'], ['idx_characters_portrait', 'portraitCheckedAt']],
    publisher_sessions: [['idx_publisher_sessions_user', 'user'], ['idx_publisher_sessions_expiry', 'expiresAt']],
    room_invites: [['idx_room_invites_room', 'room'], ['idx_room_invites_expiry', 'expiresAt']],
    desktop_codes: [['idx_desktop_codes_user', 'user'], ['idx_desktop_codes_expiry', 'expiresAt']],
  };
  for (const name in indexes) {
    const collection = app.findCollectionByNameOrId(name);
    for (const [index, column] of indexes[name]) collection.addIndex(index, false, '`' + column + '`', '');
    app.save(collection);
  }
}, (app) => {
  const indexes = { room_members: ['idx_room_members_user'], characters: ['idx_characters_session', 'idx_characters_portrait'], publisher_sessions: ['idx_publisher_sessions_user', 'idx_publisher_sessions_expiry'], room_invites: ['idx_room_invites_room', 'idx_room_invites_expiry'], desktop_codes: ['idx_desktop_codes_user', 'idx_desktop_codes_expiry'] };
  for (const name in indexes) {
    const collection = app.findCollectionByNameOrId(name);
    for (const index of indexes[name]) collection.removeIndex(index);
    app.save(collection);
  }
});
