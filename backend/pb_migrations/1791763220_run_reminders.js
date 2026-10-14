migrate((app) => {
  // Discord reminders of planned runs. A room owner may connect a channel webhook; the
  // backend posts each run there 15 minutes before it starts. The URL is a secret, so
  // the field is hidden: no API response or snapshot carries it. remindedAt marks the
  // run as announced, and a new start time clears it.
  const rooms = app.findCollectionByNameOrId('party_rooms');
  rooms.fields.add(new TextField({ name: 'discordWebhook', max: 300, hidden: true }));
  rooms.fields.add(new SelectField({ name: 'discordLanguage', values: ['en', 'cs'], maxSelect: 1 }));
  app.save(rooms);
  const runs = app.findCollectionByNameOrId('room_runs');
  runs.fields.add(new DateField({ name: 'remindedAt' })); app.save(runs);
}, (app) => {
  const rooms = app.findCollectionByNameOrId('party_rooms');
  rooms.fields.removeByName('discordWebhook'); rooms.fields.removeByName('discordLanguage'); app.save(rooms);
  const runs = app.findCollectionByNameOrId('room_runs'); runs.fields.removeByName('remindedAt'); app.save(runs);
});
