// The dashboard's clicks, form submits and changes as dispatch tables (#192). Each part of the
// dashboard registers what its buttons and forms do when its module loads, and a button is only
// on screen once the module that drew it has loaded. main.js listens on the page and asks here.
//
// - onData({ key: handler }): a button with that data-* attribute (key as in el.dataset, so
//   data-move-task is moveTask). The attribute needs a value, unless `present` is set (an
//   empty data-task-scope is the account's list). No button carries two of these keys.
// - onAction({ name: handler }): a button whose data-action is name, when it has none of the keys.
// - onSubmit({ id: handler }): a form by its id; handler(form, data) gets its fields.
// - onChange({ key: handler }): a changed control with that data-* attribute.
// Handlers get the element and the event; what they return is awaited.

const data = new Map(), actions = new Map(), submits = new Map(), changes = new Map();
const add = (map, table, entry = run => run) => { for (const [key, run] of Object.entries(table)) { if (map.has(key)) throw new Error(`${key} is handled twice`); map.set(key, entry(run)); } };

export const onData = (table, present = false) => add(data, table, run => ({ run, present }));
export const onAction = table => add(actions, table);
export const onSubmit = table => add(submits, table);
export const onChange = table => add(changes, table);

// The handler of a clicked button: its first registered data-* key, else its data-action; null for none.
export function clickHandler(el) {
  for (const [key, value] of Object.entries(el.dataset)) {
    const entry = data.get(key);
    if (entry && (entry.present || value)) return entry.run;
  }
  return actions.get(el.dataset.action) || null;
}
export const submitHandler = form => submits.get(form.id) || null;
export function changeHandler(el) {
  for (const key of Object.keys(el.dataset || {})) if (changes.has(key)) return changes.get(key);
  return null;
}
