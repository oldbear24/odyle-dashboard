const { test } = require('node:test');
const assert = require('node:assert/strict');
// Discord reminders under Room settings (#33): src/discord.js.
const now = Date.parse('2026-10-17T12:00:00Z');
const ago = minutes => new Date(now - minutes * 60000).toISOString().replace('T', ' ');

test('room settings say when runs are posted and how the webhook last fared', async () => {
  const { postTimes, deliveryLine, leadsOf, discordSettings } = await import('../src/discord.js');
  assert.deepEqual(leadsOf({}), [15]);
  assert.deepEqual(leadsOf({ discordLeads: [15, 60] }), [60, 15]);
  assert.equal(postTimes({}), '15 min before it starts');
  assert.equal(postTimes({ discordLeads: [120, 30, 5], discordStartPost: true }), '2 h, 30 min and 5 min before it starts, and as it starts');
  assert.equal(deliveryLine({ discordReminders: true }, now), null);
  assert.deepEqual(deliveryLine({ discordReminders: true, discordStatus: { okAt: ago(5) } }, now), { tone: 'ok', text: 'Last post delivered 5m ago.' });
  assert.equal(deliveryLine({ discordReminders: true, discordStatus: { okAt: ago(60), error: 'Discord answered 500.', errorAt: ago(2) } }, now).text, 'The last post failed 2m ago: Discord answered 500.');
  assert.match(deliveryLine({ discordReminders: false, discordStatus: { dropped: 'Discord answered 404: …', droppedAt: ago(180) } }, now).text, /^Reminders stopped 3h ago: Discord no longer knew the webhook/);
  assert.equal(deliveryLine({ discordReminders: false, discordStatus: { okAt: ago(1) } }, now), null);
  // Connected: its name, the times chosen, the times form with a save button.
  const on = discordSettings({ discordReminders: true, discordName: 'Raid <bot>', discordLanguage: 'cs', discordLeads: [60, 15], discordStatus: { okAt: ago(1) } }, now);
  assert.match(on, /Posting as Raid &lt;bot&gt;, in Czech\./);
  assert.match(on, /value="60" checked/); assert.match(on, /value="15" checked/); assert.doesNotMatch(on, /value="5" checked/);
  assert.match(on, /id="discord-options-form"[\s\S]*>Save<\/button>/);
  assert.match(on, /discord-status ok/);
  // Off: the times go with the connection, so the form has no button of its own.
  // Readiness in the posts (#46): the room's choice, counts only.
  assert.match(on, /name="readiness"\s+>/); assert.match(discordSettings({ discordReminders: true, discordReadiness: true }, now), /name="readiness" checked/);
  assert.match(on, /Counts only, never names or Odyle values/);
  // The posts' language (#50): the room's once connected, else this dashboard's; the form sends it.
  assert.match(on, /name="language"[\s\S]*value="cs" selected/); assert.match(discordSettings({ discordReminders: false }, now), /value="en" selected/);
  const off = discordSettings({ discordReminders: false }, now);
  assert.doesNotMatch(off, />Save<\/button>|discord-off/);
  assert.match(off, /Post each planned run to a Discord channel before it starts/);
});
