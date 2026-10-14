migrate((app) => {
  // Checklist tasks keep the order their account gives them (move up and down on the
  // dashboard); existing tasks keep their creation order within each list.
  const tasks = app.findCollectionByNameOrId('user_tasks');
  tasks.fields.add(new NumberField({ name: 'position', onlyInt: true })); app.save(tasks);
  const next = {};
  for (const t of app.findRecordsByFilter('user_tasks', 'id != ""', 'created', 0, 0)) {
    const list = t.getString('user') + '|' + t.getString('cadence'); next[list] = (next[list] || 0) + 1;
    t.set('position', next[list]); app.save(t);
  }
}, (app) => {
  const tasks = app.findCollectionByNameOrId('user_tasks'); tasks.fields.removeByName('position'); app.save(tasks);
});
