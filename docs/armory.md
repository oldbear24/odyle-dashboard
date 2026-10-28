# Armory: PLAYNC's character pages

The armory (`/armory`, `backend/odyle/armory.go`) shows everything PLAYNC's official character pages list for an AION 2 Global character: its gear with each item's details (properties, soul binding, manastones and theostones, set), combat power, item level, stats with what they give, skills, titles, skins, pet and wings, and its Daevanion boards node by node, with the game's icons and the character's portrait. A profile has tabs, each with its own address: gear and stats (`/armory/<region>/<server id>/<character id>`), `/skills`, `/daevanion`, `/titles` and `/appearance`. This page records what PLAYNC's pages are and what the backend keeps from them. The routes are in the [API contract](api.md#armory), and what is kept and for how long is in [privacy](privacy.md).

## Endpoints

PLAYNC's Global site (`aion2.plaync.com/en-us/characters/<server id>/<character id>?region=<code>`, which each profile links as **Official page**) loads its character pages from these public JSON endpoints and its images from two hosts. No sign-in is involved.

| What | Request |
| --- | --- |
| Character search | `GET https://api-search.plaync.com/aion2global/search/v2/character?keyword=<name>&serverId=<id>&region=<code>&localeInfo=en-US&page=1&size=20` |
| Profile, stats, titles, boards | `GET https://aion2.plaync.com/api/character/info?region=<code>&lang=en-US&characterId=<id>&serverId=<id>` |
| Gear, skins, pet, wings, skills | `GET https://aion2.plaync.com/api/character/equipment?region=<code>&lang=en-US&characterId=<id>&serverId=<id>` |
| An equipped item's details | `GET https://aion2.plaync.com/api/character/equipment/item?region=<code>&lang=en-US&characterId=<id>&serverId=<id>&id=<item id>&enchantLevel=<n>&slotPos=<n>` |
| A board's nodes | `GET https://aion2.plaync.com/api/character/daevanion/detail?region=<code>&lang=en-US&characterId=<id>&serverId=<id>&boardId=<id>` |
| Icons | `GET https://assets.playnccdn.com/static-aion2-gamedata/resources/<file>.png` (256 or 512 pixels, up to some 500 KB) |
| Portrait | the `profileImage` of `info`, on `profileimg.plaync.com` (it redirects to `fizz-download.playnccdn.com`) |
| Classes | `GET https://aion2.plaync.com/en-us/api/gameinfo/pcdata?lang=en`: `{ pcDataList: [{ id, className, classText, genderName, raceName }] }`, every class id (`pcId`) with the class's own name (`ELEMENTALIST`) and the one players see (`Spiritmaster`) |
| Class emblems | `GET https://assets.playnccdn.com/static-aion2/characters/img/class/class_icon_<className in lower case>.png` (256 pixels) |

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
- **`statSecondList`:** what a stat gives (`Attack increase +2.6%`), or `null`.
- **`title`:** how many titles the character owns of how many, and per category (`Attack`, `Defense`, `Etc`) the one worn (`name` and `grade` `null` for none), how many of the category it owns, `equipStatList` (what it gives when worn) and `statList` (its own stats).
- **`daevanion.boardList`:** each board's `id` (for its nodes), `openNodeCount` and `totalNodeCount`.

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

- **Slot names:** `MainHand`, `SubHand`, `Helmet`, `Shoulder`, `Torso`, `Pants`, `Gloves`, `Boots`, `Cape`, `Belt`, `Necklace`, `Amulet`, `Earring1`–`2`, `Ring1`–`2`, `Bracelet1`–`2`, `Rune1`–`2` and `Arcana1`–`5`. `slotPos` orders them. Skins name their slots a little differently (`EarringL`, `MaceMain`).
- **Grades:** `Common`, `Rare`, `Legend`, `Unique`, `Epic`, `Mythic` and `Special`. The dashboard colours them as PLAYNC's dark pages do: white, green, blue, orange, red-orange, red and teal.
- **`wingSkin`:** the wings' skin, the wings themselves when none is worn.
- **`skill.skillList`:** every skill of the class: `category` `Active`, `Passive` or `Dp` (stigma), `skillLevel`, `needLevel`, `acquired` and `equip` (on the skill bar), 1 or 0.

`equipment/item` (shortened) is what the official page shows when an item is clicked:

```json
{ "name": "Splendent Ebony Dragon Lord Orb", "grade": "Unique", "level": 102, "enchantLevel": 15, "maxEnchantLevel": 15, "maxExceedEnchantLevel": 5, "categoryName": "Orb", "type": "Equip", "equipLevel": 45, "raceName": "Asmodians", "classNames": ["Spiritmaster"],
  "mainStats": [{ "name": "Attack", "minValue": "315", "value": "630", "extra": "174", "exceed": false }],
  "subStats": [{ "name": "Combat Speed", "value": "13%" }], "subStatCount": 5, "soulBindRate": "100", "subSkills": [{ "name": "Combustion", "level": 2, "icon": "…" }],
  "magicStoneSlotCount": 4, "magicStoneStat": [{ "name": "Attack", "value": "+10", "grade": "Unique", "icon": "…" }], "godStoneSlotCount": 1, "godStoneStat": [{ "name": "…", "grade": "…", "desc": "…", "icon": "…" }],
  "set": { "name": "Primal Vigor", "equippedCount": 2, "items": [ … ], "bonuses": [{ "degree": 2, "descriptions": ["…"] }] },
  "sources": ["Crafting"], "costumes": ["Rending Roar (Orb)"], "tradable": false, "storable": true, "desc": "…" }
```

- Values are text (`"630"`, `"13%"`). An `extra` of `"0"` adds nothing; an `exceed` line is the exceed level's bonus.
- `magicStoneStat` are manastones on weapons and armour and soulstones on accessories. A few of their icons are missing on PLAYNC's CDN (the official page shows a stand-in).
- An unknown item or slot answers 404, like an unknown character.

`daevanion/detail` lists a board's grid, empty cells included (`type` `None`), and what its open nodes give:

```json
{ "nodeList": [{ "row": 3, "col": 3, "grade": "Unique", "type": "Stat", "open": 1, "name": "Combat Speed", "effectList": [{ "desc": "Combat Speed +1.5%" }], "icon": "…" }],
  "openStatEffectList": [{ "desc": "HP +900" }], "openSkillEffectList": [{ "desc": "Bolt +1" }] }
```

Boards are 15 by 15 (88 to 152 nodes); node types are `Stat`, `SkillLevel` and `Start`.

## What the backend keeps

`armory_profiles.profile` keeps a normalized copy, not PLAYNC's answers (some 100 KB for a character at the level cap; the field takes up to 1 MB), in the shape of the [API contract](api.md#armory):
- name, level, class, race, gender, server, title and title grade;
- combat power and item level;
- the stats (type, name, deity, value, primary or not, what each gives);
- the gear by slot (name, grade, enchantment, exceed level), with wings and pet, and each item's details;
- the skins, the skills, the titles worn and owned;
- the Daevanion boards, with the nodes of each board that has any open, and their effects;
- the file names of the portrait and the icons.

Each profile read also names its class id (`pcId`) in `game_classes`, so characters with that id show their class on cards ([class and level](api.md#class-and-level)).

Left out: rankings (the Global pages show none) and the official pages' own texts. Profiles kept before 0.46.0, without the details, are fetched again when opened.

## Images

The dashboard's content security policy allows images only from the Odyle server, so browsers never load PLAYNC's images (`backend/odyle/armoryimages.go`). The queue downloads the portrait and the icons a profile names while it looks the character up, six at a time, and keeps them as files in `pb_data/armory_images`:
- an icon under PLAYNC's file name, shrunk from 256 or 512 pixels to at most 112 (twice the largest the page shows), some 20 KB each; an icon the server keeps already is not downloaded again;
- the portrait under the SHA-256 of its bytes (`portrait-<32 hex>.jpg`), downloaded at every lookup since it can change;
- each class's emblem under PLAYNC's file name (`class_icon_chanter.png`), shrunk like the icons, named in `game_classes.icon`; rooms and profiles show it beside the class.

`GET /api/odyle/armory-images/<name>` serves them, kept for a year by browsers. An image that could not be downloaded is left out of the profile, and the page shows the initials or an empty frame. Two characters at the level cap need some 130 images, 3 MB; the nightly `odyle-armory` job deletes the images no kept profile names, so the folder follows the kept profiles. It is part of `pb_data`, so backups include it.

## How often PLAYNC is asked

- **One queue for the whole server.** A lookup asks for info and equipment, downloads the images they name that the server does not keep yet, then asks for each equipped item (up to 25) and each board with open nodes (up to 6), and downloads their images. PLAYNC's pages come a quarter of a second apart, one at a time; images six at a time. The next lookup starts 5 seconds after one ends. The wait a reader is told counts with how long the last lookups took, 40 seconds until one has ended.
- **How long a lookup takes:** PLAYNC answers each page in 0.5 to 2.3 seconds (1.3 on average for item pages, measured on 2026-10-27 from Czechia; the connection itself takes some 50 ms). A character at the level cap with 20 items and 4 open boards took 40 seconds for its 26 pages, and 72 icons one after another took 25 more on a server that kept none of them; six at a time take some 5.
- **While a lookup runs**, its readers see how far it got (the step, how much of it is done and a percent) and, with no profile kept in today's shape, the profile as far as info and equipment give it, until the items' and boards' details are in.
- **A detail PLAYNC does not give** (an item or board page that fails) leaves that item or board without it; the lookup goes on. PLAYNC refusing the server ends it, as below.
- **Queue limits:** up to 100 characters, at most 3 from one address. A reader whose request doesn't fit is told to try again shortly.
- **Searches:** at least a second apart, server-wide. Their results are kept for 10 minutes, and repeats are answered from memory.
- **Refreshes:** a kept profile is fetched again when someone opens it and it is older than 6 hours. A reader's **Refresh** counts only once it is 15 minutes old.
- **PLAYNC refusing the server** (403 or 429): the queue waits for the time PLAYNC asks, and at least 10 minutes. Any other failure is tried again after 10 minutes, and the kept copy stays with its age.
- **Profiles nobody opened for 30 days** are deleted by the nightly `odyle-armory` job.
- **Classes:** the class list is asked for when a lookup reads a class whose emblem the server does not keep (at most once an hour) and by the nightly `odyle-armory` job; it downloads only the emblems the server lacks. Paused with the armory.
- **Operator switches:** superusers stop all of it with **Server controls → Pause the armory**. They keep one character out for good with `hidden` on its row (Collections → `armory_profiles`).

Whether NC is fine with this use is not settled: the question to NC (#24) is still open. If NC objects, the pause switch stops it at once.
