# Armory: PLAYNC's character pages

The armory (`/armory`, `backend/odyle/armory.go`) shows everything PLAYNC's official character pages list for an AION 2 Global character: its gear with each item's details (properties, soul binding, manastones and theostones, set), combat power, item level, stats with what they give, skills, titles, skins, pet and wings, and its Daevanion boards node by node, with the game's icons and the character's portrait. A profile has tabs, each with its own address: gear and stats (`/armory/<region>/<server id>/<character id>`), `/skills`, `/daevanion`, `/titles`, `/appearance` and `/upgrade` (dashboard 0.62.0, [below](#upgrade-tab)). The armory also lists the top players of each class (`/armory/top/<class>`, dashboard 0.62.0, [below](#top-players-and-the-scout)). Each profile also has a player card, `/armory/<region>/<server id>/<character id>/card`: a page of its own with the profile as a trading card that turns in 3D. The card has an edge as thick as card stock; dragging it in any direction turns it that way, double-click or Enter flips it, and the four arrow keys turn it 30° each. Let go, it settles on the face that shows, upright. The profile's header names the character's legion when PLAYNC lists one (its info page's `regionName`). The card shows the portrait, level, class, race, equipped title or legion, combat power, item level, the two strongest skills on the skill bar, the primary stats, Daevanion progress and titles owned, with the best gear grade as its set mark. The player whose Odyle app read the character picks one of twelve designs (Elysea, Asmodae, Abyss, Balaur, Beluslan, Heiron, Sanctum, Pandaemonium, Eltnen, Inggison, Dredgion, Tiamaranta; until then the race decides), with the membership a holo finish (Prism, Starfall, Etched, Sunburst, Cracked ice, Dragon scale, Aether, Opal, Galaxy, Lenticular, Brushed metal, Stained glass, Aether shield), and the card's options: a classic or full-art layout, the back's design, the main or deity stats, two of the character's learned skills, the title, legion or nothing under the class, an effect around the card on its page (glow, embers, stardust, runes, storm, wings, orbits, feathers, shards or a rift, in its accent colour; still with reduced motion), an accent colour, a frame (gilded, silvered, radiant or none) and the name in gold leaf or glowing. The picker keeps these under four tabs (Design, Finish, Effects, Contents); beside it, the card stays in view. The card has depth: as it turns, its design's backdrop, the portrait and the foil shift under its surface by their depth, while the stats panel and the back's emblem stand out of it, and the effect around it lies in the card's own 3D space, so it turns with the card (`src/card.css`). Chrome and Edge draw a 3D layer that keeps turning at one pixel per CSS pixel, so there the card is laid out at twice its size and drawn at half, which keeps it sharp on high-density screens. Holo finishes that brighten (color-dodge) are dimmed first, so they cannot blow the JPEG noise of a portrait's dark parts up into blocks. **Save image** draws the card's front in its look on a canvas (`src/cardimage.js`) and saves it as a 1500 × 2095 PNG; the content security policy lets the page load images from the Odyle server only, so the picture is drawn rather than copied from the page. This page records what PLAYNC's pages are and what the backend keeps from them. The routes are in the [API contract](api.md#armory), and what is kept and for how long is in [privacy](privacy.md).

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
- **Server ids:** race × 1000 + region digit × 100 + the server's place in its list. Elyos are race 1 and Asmodians race 2. The region digits are 1 nae, 2 naw, 3 eu, 4 la and 5 as. So Lumiel, the 4th Asmodian server, is 2304 in Europe. The lists are `elyos` and `asmodian` in `backend/odyle/servers.go`, named as PLAYNC's official server list names them (`GET https://aion2.plaync.com/en-us/api/gameinfo/servers?lang=en-us&region=<code>`: `{ serverList: [{ raceId, serverId, serverName, serverShortName }] }`, checked on 16 Nov 2026). Every region numbers its servers in the same order and opens some of them: Europe all 23 per race, North America East 9, Asia 10, South America 6 and North America West 5. The nightly `odyle-armory` job reads that list of every region again (paused with the armory) and keeps each server in `game_servers`: its id, its name and whether a region lists it now (`open`). A server past the lists is named from it, a server no region lists any more keeps its name, and a region that does not answer keeps what it listed before. A name PLAYNC gives a server the lists name otherwise is not taken (characters stay saved under the lists' name) and is logged as a warning, for a release to rename; characters are kept by server id (`characters.serverId`, see the [API contract](api.md#persistent-characters-and-publisher-sessions)), so a renamed server keeps them and they take its new name with their next reading. Characters saved on a server before it had an id take it when the job learns the server. Windows apps before 0.34.0 named seven servers otherwise (Gauss as Poeta, Lamuatan as Verteron, Tassin as Agnita, Agnita as Ishalgen, Atiel as Altgard, Tahavatha as Tahabata, Kasaka as Kasika); the migration 1791763271 renames the characters and PvP events saved under those names.
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

Left out: rankings (the Global pages show none) and the official pages' own texts. Each saved profile also keeps the character's row among the [top players](#top-players-and-the-scout) up to date (`armory_ranks`, dashboard 0.62.0). Profiles kept before 0.46.0, without the details, are fetched again when opened.

## Images

The dashboard's content security policy allows images only from the Odyle server, so browsers never load PLAYNC's images (`backend/odyle/armoryimages.go`). The queue downloads the portrait and the icons a profile names while it looks the character up, six at a time, and keeps each as a record of `armory_images` (dashboard 0.61.0): its name, its file and its size. PocketBase keeps the file in its file storage like the characters' portraits, on the data volume or in S3 storage when the operator sets it up ([deployment](deployment.md#files-in-s3-storage)). Superusers browse, search and delete the images under **Collections → armory_images**, linked from **Server status**:
- an icon under PLAYNC's file name, shrunk from 256 or 512 pixels to at most 112 (twice the largest the page shows), some 20 KB each; an icon the server keeps already is not downloaded again;
- the portrait under the SHA-256 of its bytes (`portrait-<32 hex>.jpg`), downloaded at every lookup since it can change;
- each class's emblem under PLAYNC's file name (`class_icon_chanter.png`), shrunk like the icons, named in `game_classes.icon`; rooms and profiles show it beside the class.

`GET /api/odyle/armory-images/<name>` serves them, kept for a year by browsers. Whether the server keeps an image is one query of `armory_images` (`backend/odyle/imagestore.go`), so a browser asking whether one changed is told it did not, and a name the server does not keep answers 404, without the file storage being asked either time. An image that could not be downloaded is left out of the profile, and the page shows the initials or an empty frame. Two characters at the level cap need some 130 images, 3 MB; the nightly `odyle-armory` job deletes the records (and so the files) no kept profile names. Backups leave the images' files out, as copies of PLAYNC's. A record whose file the storage no longer holds (after a restore, or a change of the file storage) is forgotten when the image is asked for, and a kept profile that names an image the server does not keep is fetched again when it is opened and at least 15 minutes old, which keeps its images again; so does one whose image a superuser deleted. The images kept before 0.61.0, in `pb_data/armory_images` or under `armory_images/` in S3 storage, become records in the background when the server starts, and are served from where they were until then.

## Top players and the scout

PLAYNC keeps rankings for Korea and Taiwan only: its ranking page (`GET https://aion2.plaync.com/api/ranking/list?rankingContentsType=<1 abyss, 3 nightmare, 4 transcendence, 5 and 6 arenas, 21 ascension trial>&rankingType=0&serverId=<id>`) answers an empty `rankingList` for every Global server and region (checked on 20 Nov 2026). The Global character search sorts only by relevance or level (`sort=desc` or `level`), needs a keyword of at least one letter and lists no combat power; Lumiel in Europe alone lists 5,819 Chanters whose name holds an "a". Finding the true strongest of a class would mean reading every character's page, hundreds of thousands a class. So Odyle keeps what it knows, and learns more slowly (dashboard 0.62.0):

- **`armory_ranks`** keeps every character the armory knows the combat power of: its search region, server id and character id, name, class, level, combat power, item level and portrait, and, once its gear was read, its **build**: what the [Upgrade tab](#upgrade-tab) compares (each item's slot, name, grade, enchantment, exceed level, icon, type, item level, stones by name, stone slots, set and where it comes from; each Daevanion board's open nodes; the skills on its skill bar), some 3 to 6 KB. Each profile a reader's lookup saves keeps its row up to date, build included, and the profiles kept before 0.62.0 join with the scout's first runs. A character PLAYNC no longer lists leaves; hiding its profile hides its row (`hidden`, which superusers also set on the row itself under **Collections → armory_ranks**), so it shows nowhere and the scout passes it over.
- **The scout** (`backend/odyle/scout.go`) is the `odyle-armory-scout` job: every minute, paused with the armory and while PLAYNC refuses the server, it asks for up to 5 pages, 10 seconds apart, one per step: while no reader's lookup waits or runs and at most every 3 minutes (divided among the scout's lanes, `scoutLanes` under Server controls; none with 0), it queues the gear of the strongest character of a class's top 500 whose build is missing or 14 days old: the armory's queue reads its info and equipment pages and each item's page as a lookup does, not the boards', on the scout's own lane, and keeps the icons, not the portrait, and no profile; else the info page of a character a search page listed, for its combat power; else a page of the character search for a random open server, class (by its class ids), letter and page (`sort=level`, 40 a page), keeping the characters of the highest level it met that were not checked for 30 days. That is some 7,000 pages a day, plus a character's gear every few minutes at most, so the lists grow more complete over time but are never a full ranking.
- **Top players** (`/armory/top/<class>`, linked from the armory's search page) lists the 500 strongest characters of a class the armory knows, by combat power, with a tab for each class (in their class ids' order, with how many of each it knows); each opens its profile.
- The nightly `odyle-armory` job forgets the characters below their class's top 500 that were checked more than 30 days ago, so the scout may find them again; the top and hidden ones stay.
- **Server status** shows what the scout still reads (dashboard 0.63.0): how many top players' gear it reads (never read, or read 14 days ago), the first 20 of them in its order, the strongest first, with how often it reads one and about how long all of them take; and how many characters its searches found whose combat power it reads next, the first 20 of them. Those are kept in server memory, so a restart forgets them; the search pages name a character by its id only, so its name comes with its info page.

## Upgrade tab

A profile's **Upgrade** tab (`/armory/<region>/<server id>/<character id>/upgrade`, dashboard 0.62.0) shows where the character's gear falls furthest behind the strongest characters of its class, and what those wear instead (`src/upgrade.js`, `backend/odyle/upgrades.go`).

- **Who the strongest are:** the 500 characters of the class with the most combat power whose build the armory keeps ([top players](#top-players-and-the-scout)), from all five Global regions, hidden ones left out and the character itself never one of them. The tab names the strongest 20 and links the full list. With fewer than 3 it says the armory knows too few of the class yet.
- **What is compared:** each slot as the paper doll has it (a character's two earrings, rings, bracelets and runes as one slot each; the five arcana in their places; the wings; not the pet): how many of the strongest wear something there, the usual grade, and the medians of the item level (of the items whose details PLAYNC gave), enchantment, exceed level and engraved stones, with the three items worn most (how many wear each, how far they enchant it, its item level and where it comes from, as its item page's `sources` say) and the five stones engraved most. Beside the slots: the sets the strongest wear pieces of (the arcana sets, say), the median of the nodes they opened on each Daevanion board, and the skills most of them keep on their skill bars.
- **Best upgrades:** each of the character's items (and each place most of the strongest fill but the character leaves empty) gets a score by how far it is behind the slot's medians: the share of the item level it lacks counts 200, each enchantment level 3, each exceed level 4, each grade (Common, Rare, Legend, Unique, Epic, Mythic; Special stands apart) 15 and each empty stone slot 2; an empty place most of the strongest fill counts 100. The five highest are the best upgrades (a big upgrade from 25, an upgrade from 8, a small one above 0), with what the strongest wear there instead, where it comes from and the stones they engrave; **Every slot** lists them all. The character's place is where its combat power puts it among the strongest.
- **How often:** a class's comparison is worked out from the builds, one character at a time, at most every 10 minutes and kept in server memory for everyone; a character among the strongest gets the comparison without itself. Nothing more is asked of PLAYNC for the tab.

## How often PLAYNC is asked

- **One queue for the whole server, worked in lanes** (dashboard 0.62.0; one lookup at a time before). A lookup asks for info and equipment, downloads the images they name that the server does not keep yet, then asks for each equipped item (up to 25) and each board with open nodes (up to 6), and downloads their images. Within a lookup PLAYNC's pages come a quarter of a second apart, one at a time; images six at a time. Up to 3 readers' lookups run at once, and beside them 1 of the scout's, which starts only while no reader's waits; superusers set both under **Server controls → Armory queue** (`armoryLanes`, 1 to 10, and `scoutLanes`, 0 to 5, in `odyle_settings`). Each lane starts its next lookup 5 seconds after its last one ended. The wait a reader is told counts with the readers' lookups running and waiting ahead, spread over the lanes, and with how long the last lookups took, 40 seconds until one has ended. **Server status** lists the queue: each lookup running (with how far it got) or waiting, for a reader or the scout, by character, without the address that asked.
- **How long a lookup takes:** PLAYNC answers each page in 0.5 to 2.3 seconds (1.3 on average for item pages, measured on 2026-10-27 from Czechia; the connection itself takes some 50 ms). A character at the level cap with 20 items and 4 open boards took 40 seconds for its 26 pages, and 72 icons one after another took 25 more on a server that kept none of them; six at a time take some 5.
- **While a lookup runs**, its readers see how far it got (the step, how much of it is done and a percent) and, with no profile kept in today's shape, the profile as far as info and equipment give it, until the items' and boards' details are in.
- **A detail PLAYNC does not give** (an item or board page that fails) leaves that item or board without it; the lookup goes on. PLAYNC refusing the server ends it, as below.
- **Queue limits:** up to 100 readers' characters waiting, at most 3 from one address. A reader whose request doesn't fit is told to try again shortly.
- **Searches:** at least a second apart, server-wide. Their results are kept for 10 minutes, and repeats are answered from memory.
- **Refreshes:** a kept profile is fetched again when someone opens it and it is older than 6 hours. A reader's **Refresh** counts only once it is 15 minutes old. Until the lookup it asked for ends, the page (and anyone else who opens the profile) shows it waiting or running, then the new copy.
- **PLAYNC refusing the server** (403 or 429): the queue waits for the time PLAYNC asks, and at least 10 minutes. Any other failure is tried again after 10 minutes, and the kept copy stays with its age.
- **Profiles nobody opened for 30 days** are deleted by the nightly `odyle-armory` job.
- **The scout** asks for up to 5 pages a minute, 10 seconds apart, and a top character's gear at most every 3 minutes while no reader's lookup waits or runs ([top players](#top-players-and-the-scout)); it shares the searches' spacing with readers' searches, stops with the queue while PLAYNC refuses the server, and is paused with the armory.
- **Classes:** the class list is asked for when a lookup reads a class whose emblem the server does not keep (at most once an hour) and by the nightly `odyle-armory` job; it downloads only the emblems the server lacks. Paused with the armory.
- **Operator switches:** superusers stop all of it with **Server controls → Pause the armory**. They keep one character out for good with `hidden` on its row (Collections → `armory_profiles`).

Whether NC is fine with this use is not settled: the question to NC (#24) is still open. If NC objects, the pause switch stops it at once.
