// The game's Global regions and server names as the dashboard checks them, in one place
// (#193): the armory's paths (armorylinks.js), the armory link on a character's row and the
// players in PvP stats (pvp.js) all ask the same. The backend keeps its own table
// (backend/odyle/servers.go).

// A search region as PLAYNC names it (GLOBAL_NA is North America East, GLOBAL_NAW West) and a
// server name, as parts of a pattern.
export const regionSource = 'GLOBAL_(?:NAW?|EU|SA|ASIA)',
  serverSource = '[A-Za-z]{2,20}';
// A profile's region as the armory's paths name it.
export const profileRegionSource = '(?:nae|naw|eu|la|as)';
const regionName = new RegExp(`^${regionSource}$`),
  serverName = new RegExp(`^${serverSource}$`);
export const isRegion = region => regionName.test(region || '');
export const isServer = server => serverName.test(server || '');
// Whether the armory can look a player up by name: the game said their server and region.
export const findable = ({ server, region } = {}) => isServer(server) && isRegion(region);
