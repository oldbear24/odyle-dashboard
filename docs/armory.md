# Armory: PLAYNC's character pages

The armory (`#/armory`, `backend/odyle/armory.go`) shows an AION 2 Global character's gear, combat power, item level and stats as PLAYNC's official character pages list them. This page records what those pages are and what the backend keeps from them. The routes are in the [API contract](api.md#armory), and what is kept and for how long is in [privacy](privacy.md).

## Endpoints

PLAYNC's Global site (`aion2.plaync.com/en-us/characters/…`) loads its character pages from three public JSON endpoints. No sign-in is involved.

| What | Request |
| --- | --- |
| Character search | `GET https://api-search.plaync.com/aion2global/search/v2/character?keyword=<name>&serverId=<id>&region=<code>&localeInfo=en-US&page=1&size=20` |
| Profile and stats | `GET https://aion2.plaync.com/api/character/info?region=<code>&lang=en-US&characterId=<id>&serverId=<id>` |
| Gear | `GET https://aion2.plaync.com/api/character/equipment?region=<code>&lang=en-US&characterId=<id>&serverId=<id>` |

- **Search region codes:** `nae` and `naw` (North America East and West), `eu`, `la` (South America) and `as` (Asia).
- **Server ids:** race × 1000 + region digit × 100 + the server's place in its list. Elyos are race 1 and Asmodians race 2. The region digits are 1 nae, 2 naw, 3 eu, 4 la and 5 as. So Lumiel, the 4th Asmodian server, is 2304 in Europe. The lists are `elyos` and `asmodian` in `backend/odyle/portraits.go`. Every region has the same 50 servers per race.
- **Character ids:** the search lists each hit's `characterId` URL-encoded, for example `…We4%3D`. Decoded, it is URL-safe Base64 with padding, and the info and equipment requests take it decoded and then query-escaped.
- **Missing characters:** an unknown character answers `404` with `application/problem+json`, `code: resource.not_found`. The backend treats that as "PLAYNC does not list this character": the kept profile is deleted (unless hidden), and nobody asks for that character again for an hour.
- Both pages answer plain JSON, with no `data` wrapper.

## What the answers hold

`info` (shortened):

```json
{
  "profile": { "characterId": "…=", "characterName": "Example", "characterLevel": 45, "className": "Chanter", "combatPower": 107000, "raceName": "Asmodians", "serverId": 2304, "serverName": "Lumiel", "titleName": "Golden Glow", "titleGrade": "Unique", "profileImage": "https://profileimg.plaync.com/…" },
  "stat": { "statList": [
    { "type": "STR", "name": "Might", "value": 45, "statSecondList": null },
    { "type": "Justice", "name": "Justice [Nezekan]", "value": 41, "statSecondList": null },
    { "type": "ItemLevel", "name": "…", "value": 1671, "statSecondList": null }
  ] },
  "title": { "ownedCount": 0, "totalCount": 0, "titleList": [] },
  "ranking": { "rankingList": null },
  "daevanion": { "boardList": [ { "id": 1, "name": "Nezekan", "open": 1, "openNodeCount": 12, "totalNodeCount": 40, "openPercent": 30, "icon": "…" } ] }
}
```

- **Primary stats:** the six of type `STR`, `DEX`, `INT`, `CON`, `AGI` and `WIS` (Might, Dexterity, Intelligence, Constitution, Precision and Willpower).
- **Deity stats:** the ten named `<stat> [<deity>]`, from Justice [Nezekan] to Space [Israphel].
- **`ItemLevel`:** the item level of the equipped gear. Its `name` is Korean even in `en-US`.

`equipment` (shortened):

```json
{
  "equipment": {
    "equipmentList": [ { "slotPos": 1, "slotPosName": "MainHand", "id": 110830051, "name": "Enraged Kromede Rod", "grade": "Unique", "enchantLevel": 15, "exceedLevel": 3, "icon": "https://assets.playnccdn.com/…" } ],
    "skinList": [ … ]
  },
  "petwing": { "pet": { "name": "Pagati", "level": 3, … }, "wing": { "name": "Forest Spirit Wings", "grade": "Unique", "enchantLevel": 0, … }, "wingSkin": { … } },
  "skill": { "skillList": [ … ] }
}
```

- **Slot names:** `MainHand`, `SubHand`, `Helmet`, `Shoulder`, `Torso`, `Pants`, `Gloves`, `Boots`, `Cape`, `Belt`, `Necklace`, `Amulet`, `Earring1`–`2`, `Ring1`–`2`, `Bracelet1`–`2`, `Rune1`–`2` and `Arcana1`–`5`. `slotPos` orders them.
- **Grades:** `Common`, `Rare`, `Legend`, `Unique`, `Epic`, `Mythic` and `Special`.

## What the backend keeps

`armory_profiles.profile` keeps a normalized copy, not PLAYNC's answer:
- name, level, class, race, server, title and title grade;
- combat power and item level;
- the stats (type, name, deity, value, primary or not);
- the gear by slot (name, grade, enchantment, exceed level), with wings and pet;
- the Daevanion boards (name, open and total nodes).

Each profile read also names its class id (`pcId`) in `game_classes`, so characters with that id show their class on cards ([class and level](api.md#class-and-level)).

Left out: skills, skins, titles' effects, rankings and every image. The dashboard's content security policy allows images only from the Odyle server, so the armory shows no PLAYNC icons.

## How often PLAYNC is asked

- **One queue for the whole server.** A lookup asks for info and then equipment, and the next lookup starts 5 seconds after one ends.
- **Queue limits:** up to 100 characters, at most 3 from one address. A reader whose request doesn't fit is told to try again shortly.
- **Searches:** at least a second apart, server-wide. Their results are kept for 10 minutes, and repeats are answered from memory.
- **Refreshes:** a kept profile is fetched again when someone opens it and it is older than 6 hours. A reader's **Refresh** counts only once it is 15 minutes old.
- **PLAYNC refusing the server** (403 or 429): the queue waits for the time PLAYNC asks, and at least 10 minutes. Any other failure is tried again after 10 minutes, and the kept copy stays with its age.
- **Profiles nobody opened for 30 days** are deleted by the nightly `odyle-armory` job.
- **Operator switches:** superusers stop all of it with **Server controls → Pause the armory**. They keep one character out for good with `hidden` on its row (Collections → `armory_profiles`).

Whether NC is fine with this use is not settled: the question to NC (#24) is still open. If NC objects, the pause switch stops it at once.
