migrate((app) => {
  // The character's official AION 2 portrait, downloaded by the backend
  // (lib/portraits.cjs). Players cannot set it: the collection keeps no update
  // rule and no route writes this field. Files are served from unguessable URLs
  // that only the owner and rooms the character is shared in receive.
  const characters = app.findCollectionByNameOrId('characters');
  characters.fields.add(new FileField({ name: 'portrait', maxSelect: 1, maxSize: 524288, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], protected: false }));
  characters.fields.add(new DateField({ name: 'portraitCheckedAt', hidden: true }));
  characters.fields.add(new TextField({ name: 'portraitHash', max: 64, hidden: true }));
  app.save(characters);
}, (app) => {
  const characters = app.findCollectionByNameOrId('characters');
  for (const name of ['portrait', 'portraitCheckedAt', 'portraitHash']) characters.fields.removeByName(name);
  app.save(characters);
});
