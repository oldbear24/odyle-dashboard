function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(name + ' is required (max ' + max + ' characters).');
  return value.trim();
}
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(name + ' must be an integer between ' + min + ' and ' + max + '.');
  return value;
}
function characterIdentity(body) {
  const regions = ['GLOBAL_EU', 'GLOBAL_NA', 'GLOBAL_SA', 'GLOBAL_ASIA'];
  if (!regions.includes(body.region)) throw new Error('Select a Global region.');
  return { characterName: text(body.characterName, 'Character', 40), server: text(body.server, 'Server', 40), region: body.region };
}
function reading(body, current, verifiedAdapters = []) {
  if (body.sessionId !== current.sessionId) throw new Error('Publisher session changed. Reconnect your client.');
  integer(body.sequence, 'Sequence', 1, Number.MAX_SAFE_INTEGER);
  if (body.sequence <= current.sequence) throw new Error('Outdated reading.');
  if (body.source !== 'packet') throw new Error('Odyle must come from game packets. Manual readings are disabled.');
  const parserVersion = text(body.parserVersion, 'Packet adapter', 80);
  if (!verifiedAdapters.includes(parserVersion)) throw new Error('This packet adapter has not been validated for Global. No reading was saved.');
  if (body.confirmed !== true) throw new Error('A verified packet observation is required.');
  const regions = ['GLOBAL_EU', 'GLOBAL_NA', 'GLOBAL_SA', 'GLOBAL_ASIA'];
  if (!regions.includes(body.region)) throw new Error('Select a Global region.');
  return { value: integer(body.value, 'Odyle', 0, 1000000), characterName: text(body.characterName, 'Character', 40), server: text(body.server, 'Server', 40), region: body.region, sequence: body.sequence, source: 'packet', parserVersion };
}
function status(member, now) {
  if (!member.sharing) return 'offline';
  if (!member.confirmed || !member.lastReadingAt) return 'unknown';
  if (!member.lastSeenAt || now - Date.parse(member.lastSeenAt) >= 90000) return 'offline';
  if (now - Date.parse(member.lastReadingAt) >= 45000 || now - Date.parse(member.lastSeenAt) >= 45000) return 'stale';
  return 'live';
}
module.exports = { text, integer, characterIdentity, reading, status };
