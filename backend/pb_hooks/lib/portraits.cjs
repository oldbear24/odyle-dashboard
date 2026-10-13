// Official AION 2 Global character portraits. PLAYNC's public character search
// returns a profileImageUrl for each character; the backend downloads that image
// into the character's portrait field, so browsers never contact NCSOFT.
//
// Server ids follow the game protocol (see odyle-windows GameIdentity.cs):
// race * 1000 + region * 100 + list index + 1. Saved characters keep only the
// server name and region, so the id is rebuilt here. NA has two search regions
// (East 1xx, West 2xx) and both are tried.
const elyos = 'Siel,Nezekan,Vaizel,Kaisinel,Yustiel,Ariel,Fregion,Meslamtaeda,Hithanya,Nania,Tahabata,Luteros,Phernos,Daminu,Kasika,Bakarma,Tsenka,Kochi,Ishtar,Tiamat,Poeta,Verteron,Nathara,Talisra,Zumion,Nahid,Asahr,Caelid,Laveis,Perion,Dramata,Reda,Auldor,Vakron,Narun,Gartua,Chloris,Ione,Teina,Dymones,Bargott,Atheron,Ruthilis,Siliator,Idris,Satia,Estian,Rahu,Rhanman,Hebran'.split(',');
const asmodian = 'Israphel,Zikel,Triniel,Lumiel,Marchutan,Azphel,Ereshkigal,Beritra,Nemon,Hadala,Ludra,Ulgorn,Munin,Odar,Zemurru,Kromede,Quai,Baba,Fafnir,Indnath,Ishalgen,Altgard,Agnita,Atiel,Valdemar,Lagta,Gerod,Urd,Ecco,Giselle,Kashapa,Stof,Berk,Nuakum,Grisilla,Santras,Reuben,Hugo,Kraki,Hystan,Rathman,Sigebert,Nazmun,Gelcos,Paton,Pelleir,Elvida,Ketu,Pydeon,Notun'.split(',');
const regions = { GLOBAL_NA: [[1, 'nae'], [2, 'naw']], GLOBAL_EU: [[3, 'eu']], GLOBAL_SA: [[4, 'la']], GLOBAL_ASIA: [[5, 'as']] };
const searchUrl = () => $os.getenv('PLAYNC_SEARCH_URL') || 'https://api-search.plaync.com/aion2global/search/v2/character';
const imageBase = () => $os.getenv('PLAYNC_IMAGE_URL') || 'https://profileimg.plaync.com';
const headers = { accept: 'application/json', 'user-agent': 'Odyle (AION 2 party dashboard)' };
const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function searches(server, region) {
  const elyosIndex = elyos.indexOf(server), asmodianIndex = asmodian.indexOf(server);
  const race = elyosIndex >= 0 ? 1 : asmodianIndex >= 0 ? 2 : 0, index = Math.max(elyosIndex, asmodianIndex) + 1;
  return race ? (regions[region] || []).map(([digit, code]) => ({ serverId: race * 1000 + digit * 100 + index, region: code })) : [];
}
const plain = name => String(name || '').replace(/<[^>]*>/g, '').trim().toLowerCase();
function imageUrl(name, server, region) {
  for (const s of searches(server, region)) {
    const query = 'keyword=' + encodeURIComponent(name) + '&serverId=' + s.serverId + '&region=' + s.region + '&localeInfo=en-US&page=1&size=20';
    const res = $http.send({ url: searchUrl() + '?' + query, method: 'GET', headers, timeout: 10 });
    if (res.statusCode !== 200) throw new Error('The official character search is unavailable (' + res.statusCode + ').');
    const hit = (res.json?.list || []).find(c => plain(c.name) === plain(name) && Number(c.serverId) === s.serverId);
    // Only ever fetch from the portrait host: the search result supplies a path.
    if (hit?.profileImageUrl && String(hit.profileImageUrl).startsWith('/')) return imageBase() + hit.profileImageUrl;
  }
  return '';
}
// Returns { file, hash } for the character's official portrait, or null when the
// search does not list it (new, renamed or deleted characters, unknown servers).
function fetchPortrait(name, server, region) {
  const url = imageUrl(name, server, region); if (!url) return null;
  const res = $http.send({ url, method: 'GET', headers: { 'user-agent': headers['user-agent'] }, timeout: 15 });
  const type = String(res.headers?.['Content-Type']?.[0] || '').split(';')[0].trim();
  if (res.statusCode !== 200 || !types[type]) throw new Error('The official portrait could not be downloaded.');
  return { file: $filesystem.fileFromBytes(res.body, 'portrait.' + types[type]), hash: $security.sha256(toString(res.body)) };
}
module.exports = { fetchPortrait, searches };
