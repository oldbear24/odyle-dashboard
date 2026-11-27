# Changelog

What changed in each release of the Odyle dashboard and server, newest first, written for players. Every pull request that changes the version adds its section here (AGENTS.md, Versioning). The release notes and the dashboard's **What's new** page (`#/changelog`) show it.

## 1.9.0 · 2026-11-27

### New
- **Copy a build.** **Make a copy** on your build's page, or the copy button on its card in **Builds**, keeps a private copy named `… (copy)` to try a variant; the original stays as it was.
- **Copy to builds from the armory.** Every armory profile has **Copy to builds** (it was **Make a build**): the character's gear, skills and open nodes become a build of yours. Signed out, the button asks you to sign in first instead of being missing.

### Changed
- Builds look more like a build planner: the list's cards show the class emblem framed beside each build and what it holds as chips, the header's tags line up with their icons, and on phones a build's numbers sit two by two.
- For server operators: `POST /api/odyle/build` with `copy` also takes the id of one of the account's own builds.

### Fixed
- A build's class emblem sits in the middle of its frame instead of its top left corner.

## 1.8.1 · 2026-11-27

### Fixed
- A character's natural pool and Odyle from items are no longer lost when the Windows app sends the same Odyle again without them, as it does after restarting for an update. The app's Odyle ring and **Next +15**, and the rings in rooms, stayed empty until the character's Odyle next changed in the game.

## 1.8.0 · 2026-11-27

### New
- Server operators set how much Odyle items can add at most (2,000 by default) under **Game settings → Odyle clock**. The Windows app fills its blue ring around the Odyle ring towards it.

### Fixed
- **Timers** no longer says Odyle from items has no cap: it says it holds at most 2,000 (or what the operators set).

## 1.7.0 · 2026-11-27

### New
- **Builds: put a character together by clicking.** The new **Builds** page keeps your plans for a character. Choose the item for every slot with its enchantment and exceed level, manastones or soulstones, theostones, soul binding stats and the skills it raises; set each skill's level and whether it is on your skill bar (or chosen, for stigmas); open Daevanion nodes by clicking them, or a whole board at once; and keep notes. The items, stones, skills and boards to choose from are what the armory has seen characters of that class wear and use, and the build shows what its stats add up to, like a character's profile. Points and skill bar slots are not counted, so plan freely. Builds save themselves as you change them.
- **Make a build from any character.** On an armory profile, **Make a build** copies the character's gear, skills and open nodes into a new build to change from there.
- **See what a character still needs.** A build's **Compare** tab lists what the character it was made from, or a character you bookmarked, still lacks: items to get, enchantment and exceed levels, stones, nodes to open and skills to raise.
- **Share builds with a link.** **Share** makes a link anyone can open without signing in, and signed-in players can **Save a copy** to their own builds. **Stop sharing** ends the link. Builds are private until you share them, go with your account and are part of **Download my data**.

### Changed
- For server operators: migration 1791763292 adds the collection `builds` (no API rules); new routes `GET /api/odyle/builds`, `GET /api/odyle/builds/{id}`, `GET /api/odyle/builds/shared/{code}`, `POST /api/odyle/build` and the public `GET /api/odyle/armory/catalog/{class}`, under the armory's rate limit.

## 1.6.1 · 2026-11-26

### Fixed
- Opening **Rooms & characters** while your Windows app sends a reading no longer pops up "New character saved" for a character you already had. The dialog now only offers characters saved while the page is open.

## 1.6.0 · 2026-11-26

### New
- **Where stats come from counts every stat.** The armory's table now adds what your primary and deity stats give (Might's Attack increase, Precision's Critical Hit increase, Time's Combat Speed and the rest) and the worn titles' own effects. Every primary and deity stat has a row whose total is the value the stats panel shows, with **Other sources** for the part that comes from your level, class and what PLAYNC does not list.
- **Exceed counts.** Each item's exceed bonuses (more Attack or Defense, Damage Boost, HP increase, Damage Tolerance) show in its card and have their own column in the table. A character shows them once the armory reads it again.

### Fixed
- Manastones and soulstones of Damage Boost, Critical Damage Boost and the other percentage stats show what they really give: `+100` is +1%, now added to the stat's percentage instead of a separate row.
- Cooldown from the deity stat Illusion and Cooldown Reduction from boards and titles add up in one row.

## 1.5.0 · 2026-11-26

### New
- **The armory's top players stay current.** Every top player's combat power, and that of the players just below the top, is read again every 3 days, so the order of the top lists and the players about to enter them are never more than a few days old.
- **After a big game change the whole list is read again.** When the level cap rises or the combat power of most top players changes at once, Odyle reads every character it knows again, the top players first: the top of every class within a day.

### Changed
- For server operators:
  - **Server status → Armory scout** has **Refresh every character**: start a refresh after a game patch, see what started a refresh and what it still reads, or stop it. Starting and stopping are written to the audit log;
  - migration 1791763291 adds `ranksRefreshAt` and `ranksRefreshWhy` to `odyle_settings`, which only the server writes; `POST` and `DELETE /api/odyle/admin/armory-refresh` start and stop a refresh.

## 1.4.0 · 2026-11-25

### New
- **Daevanion boards show what every node gives.** In the armory's Daevanion tab each stat node shows its stat in a few letters and its value (`ATK +3`, `PvE DEF +30`, `SPD +1.5%`), and each skill node shows the icon of the skill it raises.
- Point at a node, tap it or move to it with the keyboard to see its card: the stat or skill in full, its grade, whether it is open and, for a skill, the skill's level and how many levels the boards add.
- Beside the board, a list of everything the board gives: each stat and skill with how many of its nodes are open and what the open ones add, so you see what is still left to open.
- The arrow keys move between the board's nodes; on phones the board scrolls sideways so the nodes stay readable.

## 1.3.0 · 2026-11-24

### Changed
- For server operators:
  - the armory's AI now follows a **knowledge base** of AION 2's gear. Its best practices go into every plan, and it reads the guides on enchanting, exceed, stones, soul binding, arcana and the other mechanics when a question needs them. Migration 1791763290 starts it with researched entries, each with its sources. On the new **AI knowledge** page of the Odyle pages you read every entry as the AI reads it, correct it as patches change the game, add your own, switch one off or delete it. Changes are written to the audit log;
  - `GET /api/odyle/admin/ai` also answers what the knowledge base holds, and `/api/odyle/admin/ai/knowledge` lists, saves and deletes its entries.

## 1.2.0 · 2026-11-24

### New
- **One search box in the armory.** Type a name or just part of it. The server is optional: without one, Odyle searches every server of the region. You can also type the server or region with the name, like `Kai Lumiel` or `Kai eu`.
- **Suggestions as you type**: the characters Odyle already knows, from every region, with their class, server and combat power. The arrow keys and Enter open one.
- Search results show each character's server and, when Odyle knows it, its combat power and portrait.

### Changed
- The search in the **Compare** picker works like the armory's: part of a name is enough and the server is optional.
- For server operators:
  - migration 1791763289 indexes the armory's known characters by name for the suggestions and adds rate limits for them; see docs/deployment.md for what else this release can do once you set it up under Server controls;
  - `GET /api/odyle/armory/search` takes the search box's text as `q`, and the server may be left out.

## 1.1.0 · 2026-11-23

### New
- The armory's **Upgrade** tab now says what to do next, slot by slot. It sorts the advice into quick wins, new gear, enchanting, polish and goals.
  - **New gear** names the next item a good share of stronger players moved on to (not only the endgame one), with the item level, grade and stats it adds and where it comes from.
  - **Enchanting** goes only as far as the item can go and stops suggesting more enchanting on an item worth replacing. It shows about what each step adds, and exceed levels once an item is at its limit.
  - **Quick wins and polish**: empty stone slots, weaker stones, missing soul binding stats, and skills most of them keep on their bar.
- The Upgrade tab compares with **the next step** by default: the characters of your class a little stronger than you. **The strongest** are one click away, and the browser remembers the choice.
- The Upgrade tab looks at the **arcana** together:
  - the set combination stronger players run against yours;
  - the bonus you are one piece away from;
  - which arcana to swap for their set;
  - the skills each arcana raises and at what level, against yours.
- The Upgrade tab shows **the skills gear raises**: what stronger players' arcana and other gear add to each skill, against what yours adds.
- **Compare two characters side by side.** **Compare** on a profile picks a bookmarked character, one of the strongest of the class or anyone you search for, and opens a page you can share. It shows:
  - combat power, item level, Daevanion, titles and skills;
  - the gear slot by slot (item level, enchantment, exceed, stones, soul binding and set);
  - stats, Daevanion boards, skill bars and arcana sets.
  
  The better value of each pair is marked. Either side can be swapped for another character, and the two can trade places.
- Armory profiles show **how a character progressed**:
  - a Progress panel on Gear & stats charts combat power and item level over the last 180 days, with the change over the last 30 days, the item level gained, the highest combat power, and every day as a table;
  - the combat power at the top of a profile shows how much it changed in the last 30 days.
- A **Where stats come from** table on Gear & stats shows what the gear's properties, soul binding, stones, set bonuses, Daevanion and the titles worn add to each stat. Weapon attack is shown as a range. Effects that cannot be counted are listed separately.
- A **gear summary** above the paper doll shows average enchantment, items at max, exceed, stones, soul binding, empty slots, and which set bonus is one piece away. Each item on the paper doll shows its enchantment, exceed level, stones and soul binding lines at a glance.
- The Daevanion tab sums the stat effects of all boards. The Skills tab shows the skill levels gear and Daevanion add.

### Changed
- The Upgrade tab leaves out characters whose combat power their item level does not give. PLAYNC lists a few with far more combat power than their gear, and they no longer count as the strongest.
- Items that come in two grades under one name (Noble Belt, say) are told apart, so the better grade shows as an upgrade.
- For server operators:
  - the scout also reads the gear of a few characters of each band of combat power below the top 500, for the next step: about 2,000 more PLAYNC pages a day once the top's gear is read;
  - builds now keep main stats, the skills items raise, stone grades and set bonuses (some 12 KB a character at the level cap);
  - a new collection `armory_history` keeps one point a day per character for 180 days (migration 1791763288).

## 1.0.0 · 2026-11-22

### Changed
- Odyle 1.0.0 supports **Odyle for Windows 0.37.0 and newer**. Apps update by themselves, so yours almost certainly is. What the server still kept for older apps and older dashboards is gone.
- If your Windows app was paired before October 2026 and never got its lasting pairing, it can no longer connect: it says the PC is no longer paired. Copy a new connection link from the dashboard (**Pair Windows app**) and paste it in the app; your characters, rooms and history stay.
- Odyle values are taken only from the Windows app of a paired PC, never from a browser.
- For server operators: **a server older than 0.62.0 updates to 0.67.1 first**, lets it finish moving the armory's old images and profiles, then updates to 1.0.0. A server with data those releases have not moved yet does not start and its log says what to do; nothing is changed until then (see the runbook, "Upgrading to 1.0.0").
- For server operators: readings only come from the adapter `global-reference-v2`, rooms no longer keep an Odyle per cube of their own (they show the server's), the dungeon catalog is saved and answered only as `catalog`, and the routes kept for old clients (`POST /api/odyle/invites`, `desktop-device`) answer 404. The API contract lists every change.

### New
- For server operators: when it signs a Windows app in and in every heartbeat, the server names its release (`serverVersion`), so the app knows which Odyle it talks to.

### Fixed
- Characters PLAYNC no longer lists, or that dropped out of the armory's top players, no longer come back into them a minute later.

## 0.67.1 · 2026-11-22

### Changed
- The welcome page, the armory and the timers load about 40 % less code before they show, so they open faster, most of all on phones.
- The Czech notice about what Odyle for Windows reads now speaks to you informally, like the rest of the dashboard and the Windows app.
- For server operators: the texts of Discord posts and push messages, the TH.GL map names and the player card's options now ship as data files, so a new language or map is one file to change.

### Fixed
- The armory no longer shows a number from PLAYNC hundreds of digits long, and an item icon that arrives broken is no longer kept.
- A request with a field left out no longer saves the word "undefined" or "null" in its place.

## 0.67.0 · 2026-11-21

### New
- An open dashboard tab, or the installed app, tells you when a new version of Odyle is out and offers to reload. A tab in the background reloads by itself, unless you are typing in it.
- Signing out in one tab signs out every open tab of that browser, and signing in signs them all in.
- Server operators are told in their alert channel, and see under **Server status**, when a backup failed or a scheduled one was not made, a background job keeps failing or gets stuck, files could not be moved to S3 storage, PLAYNC refuses the armory, or push messages or Discord posts keep failing.

### Changed
- The dashboard shows up straight away with a loading state instead of a blank page.
- Updates download only what changed, and the offline copy drops the files it no longer needs.
- Keyboard focus stays where you were after **Going**, **Can't**, **Need it too**, **Remove me** or **Hide**. Screen readers no longer read messages again on every update, and they hear when the connection drops.
- Date pickers match the dark look, phones no longer zoom into form fields, and character initials use the right font. The installed app gets a proper Android icon and shortcuts to Tasks, Timers and Armory. Small print is easier to read, and English dates follow your browser's English.
- The rooms list, open rooms, the armory's top players, the scout and the **Upgrade** comparison load much faster on busy servers. While a character flies, its rooms see its position every few seconds, and always its last one.
- For server operators: the health check fails only when the data disk cannot be written or scheduled jobs have stopped, a job that runs over 10 minutes no longer starts a second time, and one address can hold at most 200 live connections (`ODYLE_REALTIME_PER_ADDRESS`). The dashboard is built with Node 26, with updated dependencies.

### Fixed
- Room cards keep their "+15 in …" countdown and cap warnings up to date.
- **Sign out everywhere** also turns off the address of your private calendar feed.
- Deleting a character no longer holds up the server.

## 0.66.0 · 2026-11-21

### New
- **Account & data** has a switch for the names of the other players in your party and force, which Odyle for Windows sends to the armory so it can look up their public PLAYNC profiles. It stays on unless you turn it off; then the server takes no names from your characters, and Odyle for Windows 0.36.0 stops sending them within a minute. The notice on the welcome page, in the pairing dialog and under **Reader & privacy** now says so.

### Fixed
- A page that fails to load (while the server updates or restarts, or the network drops) now says so, with **Try again now**, and loads by itself ten seconds later. Before, it stayed empty until you reloaded, or kept showing the page before with buttons that no longer worked.
- A room with Discord reminders 15 and 10 minutes before a run now gets both posts. Before, the 10-minute one never came.
- A run reminder by push that the push service failed to take is sent again on the next try instead of being lost, and a push service that asks Odyle to slow down is waited for.
- PLAYNC asking the armory to wait a very long time no longer stops lookups until the server restarts: a wait lasts an hour at most, and resuming the armory under **Server controls** ends it.
- When PLAYNC's pages change, or many of a character's item pages fail, the armory keeps the profile it had instead of saving an empty one. A profile missing a few item pages is fetched again sooner.
- An unexpected server failure now says so in words the dashboard translates and is written to the server log, instead of showing internal text as if your request had been wrong.

## 0.65.0 · 2026-11-20

### Changed
- **Remove PC** under Account & data now cuts that PC off at once: its Odyle app stops reaching your account straight away, cannot pair itself again, and its live connection closes. Before, a removed PC could keep using your account for up to a week. The app's own **Disconnect** and **Sign out everywhere** work the same way.
- A paired PC that has not started Odyle for 180 days is unpaired by itself, so a sold, lost or reinstalled PC does not keep a lasting key to your account. Pair it again with a new code if you come back to it.
- Odyle for Windows renews its sign-in every day instead of every week. You notice nothing: it does so by itself with its pairing.

### Fixed
- A room whose name contains markup (such as `<img …>`) now always shows as plain text, also on the "Add it to your rooms?" prompt after you add a room there.
- Server sign-ins, password resets, live updates and files are now rate limited like the rest of Odyle, so no one can try passwords against the server operators' accounts without limit.
- One account can no longer flood the server with reader sessions or readings, crowd other players' party members out of the armory's scout, or put text of its choosing into the server operators' alert channel.

## 0.64.1 · 2026-11-20

### Fixed
- The armory's scout reads as many top players' gear at once as **Server controls → Scout lookups at once** allows. Before, it read one at a time however many lookups were allowed, and a character whose gear could not be read held back everyone after it.
- **Server status → Armory scout** names the characters waiting for their combat power, with their class, as PLAYNC's search lists them. Before, it showed the start of their PLAYNC id, which is the same for every character of a server, so the list looked like one character over and over. Regions read NA, NAW, EU, SA and Asia instead of PLAYNC's codes (naw, eu…).

## 0.64.0 · 2026-11-20

### New
- The armory's **Upgrade** tab compares rolled stats too (soul binding): for each slot it shows which stats the strongest of your class roll on their items and how high, and tells you where your item lacks one of them or rolls it lower ("Rolled Combat Speed 8% → 13%"), which counts towards the best upgrades. Characters looked up before keep theirs from their saved profile; the others join as the scout reads their gear again, so the comparison fills in over the next two weeks.

## 0.63.0 · 2026-11-20

### New
- **Top players by class** fill up faster with the players who matter: the armory's scout now also checks the characters Odyle's players play, looks up the players they met in PvP, and, from Odyle for Windows 0.35.0, the players in their party or force. Only what PLAYNC's public pages show is kept, never who played with whom.
- Server operators see under **Server status → Armory scout** what the scout still reads for the top players: whose gear, the strongest first, with how often it reads one and about how long all of them take, which characters wait for their combat power, how many of Odyle's characters it checks next and which party and force members it looks up. **Server controls** can switch off the party and force names (the teammate adapter).

### Fixed
- A character whose armory profile the operators hid no longer shows up among the top players when the scout finds it.

## 0.62.0 · 2026-11-20

### New
- Every armory profile has an **Upgrade** tab: it compares the character with the 500 strongest characters of its class that Odyle knows, from every Global region, and shows where you gain the most. The best upgrades come first, slot by slot: what you wear, what the strongest wear there instead, how far they enchant it, where it comes from and which stones they engrave. Below are every slot, the arcana sets they wear, how far they opened each Daevanion board and the skills most of them keep on their skill bar, with your place among them by combat power.
- **Top players by class** in the armory lists the 500 strongest characters of each class by combat power, a tab for each class, each one a click from its profile. PLAYNC lists no rankings for Global, so Odyle builds them itself: from every character anyone looks up, and from a slow scout that reads PLAYNC's character search in the background. The lists grow more complete day by day.
- Server operators set how many armory lookups run at once under **Server controls → Armory queue**, and see the queue under **Server status**: each lookup running or waiting, for a player or the scout, with how far it got.

### Changed
- The armory looks up to three characters up at once instead of one after another, so a busy armory shows your profile sooner. The scout's background lookups run on a lane of their own and wait while players wait.
- The server runs on PocketBase 0.42.3 and the dashboard on its JavaScript SDK 0.29.0. A sign-in that expired is now refused on every page, so the dashboard renews it or asks you to sign in again instead of quietly showing you signed out. Windows apps renew theirs with their device key as before and stay paired.

## 0.61.0 · 2026-11-17

### New
- Server operators can browse, search and delete the armory's icons and portraits in the superuser dashboard, under **Collections → armory_images**. A profile whose image was deleted fetches it again when it is opened.

### Changed
- The armory keeps its icons and portraits in PocketBase's file storage, like the characters' portraits: on the server's disk, or in S3 storage when the operator sets it up. The ones kept before move over by themselves after the update, and armory pages keep showing them meanwhile.

### Fixed
- An armory image the server could not find no longer stays missing in your browser for a year: once the server has it again, the page shows it.

## 0.60.0 · 2026-11-17

### New
- Server operators can keep the characters' portraits and the armory's icons in S3-compatible storage instead of on the server's disk. The pictures already on the disk move there by themselves, and your browser still loads them from the Odyle server and keeps them as before.

### Changed
- Your characters are kept by their server's id, the number the game gives each server, not only by its name: if AION 2 renames a server, your characters keep their history, room sharing and PvP stats, and show the new name with their next reading.
- The nightly backups no longer copy the armory's icons and portraits, which are PLAYNC's and come back by themselves, so backups are smaller.
- Calendar feeds, **Download my data** and deleting an account find what they need without reading every account, room or invite link on the server.
- The server keeps room sharing, its background jobs' notes on each character and when each Windows app was last in contact in places of their own, which keeps those lookups cheap. Rooms, the sharing switches and the Apps page show the same as before.

### Fixed
- An armory profile whose pictures the server no longer has, after a restore or a move of its files, fetches them again when you open it, instead of showing empty frames.
- A character's portrait that went missing from the server's files comes back with its next daily lookup instead of staying blank.

## 0.59.0 · 2026-11-16

### New
- Odyle reads PLAYNC's official server list every night. When AION 2 opens a new server, the armory lists it and the Windows app (0.34.0 or newer) can save your characters there, without waiting for an Odyle update.
- The armory's search form lists only the servers your chosen region has open: 9 of each race in North America East, 5 in North America West, 23 in Europe, 6 in South America and 10 in Asia.

### Fixed
- The armory's server list now has the European servers **Gauss**, **Lamuatan** and **Tassin**, and every server under the name PLAYNC gives it.
- Characters on seven servers show their real server: they were saved as Poeta instead of Gauss, Verteron instead of Lamuatan, Agnita instead of Tassin, Ishalgen instead of Agnita, Altgard instead of Atiel, Tahabata instead of Tahavatha and Kasika instead of Kasaka. They keep their history, room sharing and PvP stats under the right name, and so do the players met in PvP. A Windows app that has not updated yet still finds them; Windows 0.34.0 saves new ones under the right name.

## 0.58.0 · 2026-11-12

### New
- **PvP stats**: turn on **Count my PvP kills, assists and deaths** under **Account & data**, and Odyle counts your characters' PvP kills, assists and deaths while the Windows app reads the game. Off by default; it needs Windows app 0.33.0 or newer.
- Every counted character shows its kills and deaths on its row. Click the line to open **PvP**: the kills, assists, deaths and kills per death of the last week, 30 days or 90 days, and the count since you turned PvP stats on.
- **Players**: a table of everyone the character met, with how often it killed them, helped kill them and was killed by them. Sort it by any column; a player whose server the game named links to the armory's lookup.
- **Kills assisted for** lists the allies whose kills the character helped with, and **Latest** every kill, assist and death, newest first. An assist is a hit on a player at most 15 seconds before an ally kills them.
- The rooms a character is shared in see its PvP stats too. Events are kept for 90 days unless the server's operators set another period, and turning PvP stats off deletes them at once. **Download my data** includes them.

### Changed
- The notice about what the Windows reader reads now says it plainly: no damage numbers, HP or skills, and PvP kills, assists and deaths with the players' names only after you turn on PvP stats. The privacy notice says what is kept.

### Fixed
- The server is built with Go 1.27.4, which fixes a way to crash it with crafted requests (GO-2026-6859).

## 0.57.1 · 2026-11-02

### Changed
- The dashboard downloads about half as much before your first page shows, so it opens sooner on a first visit and after an update: the armory, player cards, **Timers**, **Achievements**, **Your week in Odyle**, **What's new**, the privacy notice, **Account & data**, the slot machine and the dialogs for a character's history and places, invitations, pairing the Windows app and Discord reminders now load the first time you open them, or quietly in the background once your first page is on screen, instead of all at once before it.
- A dashboard left open across a server update loads the new version by itself when it opens a page the old one no longer has, instead of failing. If that page still cannot load, it says so instead of reloading again and again.

### Fixed
- The buttons on character rows line up at the right again (at the left on phones), as they did before player cards came.

## 0.57.0 · 2026-11-02

### New
- **Timers**: a new page anyone can open, signed in or not. It counts down to the daily and weekly reset, the next Odyle regeneration tick and the weekly maintenance, every second and in your own time. It lists the ticks of the next 24 hours, when an empty natural pool would be full (560 without the membership, 840 with it) and what a day of regeneration is worth. With the server's dungeon catalog it also shows what a cube of each dungeon costs and how many cubes a day of regeneration and a full pool pay for. Find it in the sidebar, on the welcome page and on Daily & weekly.
- **Achievements**: 25 milestones of your own, reached by playing with Odyle: pairing the reader, your first reading, a room, the Odyle your characters spend on cubes (up to 20,000), Odyle from items, the days you play with the reader (and days in a row), friends who join your rooms with your invite links, the runs you plan, a reset week without a tick lost at the cap, and two secrets. Each one brings slot machine spins, and ten bring an item for your name that the slot machine never gives: a crate, a runic or laurel frame, a legend's gold name and more. You wear them next to your name in your rooms. Nobody else sees your achievements, and nothing ranks them.
- Achievements count by themselves. One reached while the dashboard is open pops up at the top of the page, and the sidebar shows how many are new. What you did before this update counts too, as far back as the server still keeps it (the last 30 days of Odyle history, open invite links and planned runs).
- **Your week in Odyle**: a page that sums up a reset week of your characters. It shows the cubes you opened, the Odyle you spent, what regenerated and what items added, and what your natural pools lost at the cap. It also shows the days you played with the reader, your biggest day and the achievements you reached, each next to the week before. **Earlier** and **Later** go back as far as the server keeps the history (three weeks by default).
- **Share your week**: **Save image** draws your week as a picture, **Copy for Discord** gives a text to paste, and on phones **Share** sends both. Both are made in your browser and go nowhere until you post them. After the weekly reset, Rooms & characters tells you once that your week is ready.

### Changed
- On phones, My week, Achievements and Timers are in the account menu at the top. Signed out, Timers sits right beside it.
- The slot machine marks the items that only achievements give, and links to the achievements.

## 0.56.0 · 2026-11-02

### New
- **Announcements on a schedule**: the server's operators can give a notice a start and an end, so a maintenance notice appears above every page and on your Windows app card at the time they chose, and disappears by itself once it is over, within a minute.
- **Audit log** for the server's operators: the Odyle pages of the superuser dashboard now record who changed the game settings or the server controls and what each value was before, who ran a background job by hand, asked every Windows app to update or vacuumed the database. Entries are kept for a year and cannot be changed or deleted, so a pause or a changed cube cost always has a name and a time.

## 0.55.1 · 2026-10-29

### Fixed
- **Update all apps now** also reaches Odyle for Windows apps that were reconnecting when it was pressed, usually right after a server update. Until now those apps never heard it and kept running the old version. An app that reconnects within ten minutes now updates and restarts like the others.

## 0.55.0 · 2026-10-28

### New
- **Who plays together**: players in one party in the game now stand together on the room page in a blue frame, and players of one force in a violet frame around their parties. Odyle for Windows 0.31.0 reads it from the game when the party or force forms or changes, and only for live characters. It sends only the ids the game gives the party and the force, never who else is in them. The demo room shows it too.

## 0.54.0 · 2026-10-28

### New
- **Update all apps now**: server operators can ask every connected Odyle for Windows app to update at once, from the Apps & packets page of the superuser dashboard. Apps older than the newest release download it, install it and restart, and the reader hands the live character over; apps already on it carry on. Apps not running at that moment update at their next start, as before.

## 0.53.0 · 2026-10-28

### New
- **Six more player card designs**: Sanctum (white marble and gold), Pandaemonium (black iron and lantern light), Eltnen (desert sand and copper), Inggison (a twilight jungle of glowing blooms), Dredgion (warship steel and warning lights) and Tiamaranta (dragon gold over dark jade).
- **Six more finishes** that come with the membership: Opal, Galaxy, Lenticular, Brushed metal, Stained glass and Aether shield. **Save image** draws them too.
- **Five more effects around the card**: a Daeva's wings, Orbits, Feathers, Shards and a Rift.

### Changed
- Player cards have more depth. As a card turns, its backdrop, portrait and foil shift under its surface, while the stats panel and the emblem on its back stand out of it. Every effect around the card turns with it in 3D, partly in front of the card and partly behind it.
- The look picker on a player card is much shorter: its choices sit under four tabs (Design, Finish, Effects and Contents), and the designs and finishes are small tiles.
- **Save image** saves the card at twice the size (1500 × 2095 pixels).

### Fixed
- Player cards look sharp on high-resolution screens. In Chrome and Edge, a turning card was drawn at a low resolution, and holo finishes made the dark parts of a portrait look blocky.

## 0.52.0 · 2026-10-28

### New
- **Effects around player cards**: a glow, embers, stardust, a ring of runes or a storm around the card on its page, in the card's accent colour. With reduced motion turned on in your system, they hold still.
- **More ways to style a card**: an accent colour (gold, silver, ember, jade, azure, violet or rose), a frame (gilded, silvered, radiant or none) and the name in gold leaf or glowing. **Save image** draws them too.
- **Four more holo finishes** for player cards: Sunburst (rays fanning out from the shine), Cracked ice (foil shards that catch the light), Dragon scale (Balaur scales in burnished foil) and Aether (bands of light drifting like an aurora). Like the others, they come with the membership (Account & data), and **Save image** draws them too.

### Changed
- On a wide screen, the player card stays in view while you scroll its look picker.

### Fixed
- **Refresh** on an armory profile shows the lookup again: the page says it is waiting for PLAYNC or reading the character until the new copy is in, then shows it. Before, the old copy came back at once, as if nothing had happened, and the new one only appeared after reloading the page.

## 0.51.0 · 2026-10-28

### New
- **More player card designs**: Balaur (crimson dragon scale), Beluslan (glacier blue) and Heiron (forest green and bronze) join Elysea, Asmodae and Abyss.
- **More ways to make a card yours**: a full-art layout with the portrait across the whole card, a back in another design, the main or the deity stats, the two skills it shows, and what stands under the class: the title, the legion or nothing.
- **Save image**: save a player card as a picture (PNG) in its look, to share anywhere.
- **Legions**: the armory shows a character's legion on its profile, and a card can show it too, when PLAYNC lists one.

### Changed
- Player cards have depth: turn one and you see its edge, in the colours of its design.
- Drag a player card in any direction (up, down, sideways or diagonally) and it turns that way, all the way over if you like. Let go and it settles on the face that shows, upright. On phones, dragging the card turns it instead of scrolling the page, and the arrow keys turn it up and down as well as sideways.

### Fixed
- Dragging a profile's portrait or a player card by its picture no longer drags the picture away.

## 0.50.0 · 2026-10-28

### New
- **Player cards**: every armory profile has a trading card of its own (**Player card** on the profile), with the portrait, level, class, combat power, item level, the strongest skills on the skill bar and the main stats. It turns in 3D: drag it, double-click it or press Enter to flip it to its back. Share its link like the profile's.
- If your Odyle app reads the character, you pick its card's design: Elysea, Asmodae or Abyss. Until you do, it follows the character's race. With the membership (Account & data) you can add a holo finish: Prism, Starfall or Etched. Everyone who opens the card sees your choice.

## 0.49.0 · 2026-10-28

### New
- Every page has a real address instead of a `#/` one (`/armory/eu/2304/…`, `/tasks`), and search engines and link previews see what each page is about: an armory profile shows the character's name, level, class, server, combat power and portrait when you share it in Discord, and turns up in search results under its own title. Old `#/…` links still open the same page; invite links stay as they are.

### Changed
- The browser tab names the page you are on, such as a character's profile or What's new.

## 0.48.1 · 2026-10-27

### Changed
- The server runs on PocketBase 0.41.0, which has moved from GitHub to its author's own site (ganigeorgiev.com). Operators who build Odyle themselves fetch it from there; nothing changes for players.
- Updated libraries: Vite 8.3.5 builds the dashboard, and a file-type detection library is back on a release its author stands by (1.4.16).

## 0.48.0 · 2026-10-27

### New
- **Class emblems**: characters show their class's emblem from PLAYNC's character pages beside the class, on their cards in rooms and on your characters page, and in the armory on the profile, in search results and in bookmarks.
- The armory's search lists each character's class.

## 0.47.1 · 2026-10-27

### Fixed
- Security: the server's networking library is updated (golang.org/x/net 0.62.0), so a crafted HTML page can no longer make the server spend a long time reading it (GO-2026-6860).

## 0.47.0 · 2026-10-27

### New
- **The armory shows how far a lookup got**: a progress bar with the step it is at (the character page, icons, item details, Daevanion boards).
- **A character looked up for the first time shows up sooner**: its gear, stats, skills and titles appear after a few seconds, and the items' cards and the Daevanion boards fill in once PLAYNC has listed them.

### Changed
- Icons are downloaded several at a time, so a lookup that needs many of them is some 20 seconds faster.
- The wait the armory tells you is closer to how long PLAYNC really takes, some 40 seconds for a character at the level cap.
- A profile next in line is followed from the moment its lookup starts, instead of the page checking back only every 15 seconds.
- While a profile is being fetched, the page no longer redraws itself every two seconds, so an item's card you are reading stays open.

## 0.46.1 · 2026-10-27

### Fixed
- Server operators can change **Server controls** (Odyle → Server controls) again. Since location sharing the page stopped drawing after the built-in adapters, so the rest of the form and **Save changes** were missing.

## 0.46.0 · 2026-10-27

### New
- **A new armory profile** that shows everything PLAYNC's official character pages list, with the game's icons and the character's portrait. A header gives the portrait, title, level, class, race and server with the combat power, item level and how much of the Daevanion, titles and skills the character has.
- **Gear & stats**: the gear laid out by slot (weapons and armour, accessories, arcana, pet and wings), each item in its grade's colour with its enchantment and exceed level. Hover or tap an item for its card: properties, soul binding, manastones and theostones with their empty slots, its set and the set's effects, its skin and how to obtain it. The stats beside it say what each one gives.
- **Skills**: every active, passive and stigma skill with its level, which ones are on the skill bar, which are not learned yet and how much gear and Daevanion add.
- **Daevanion**: each board drawn node by node, open nodes lit in their grade's colour, with what the board's open nodes give.
- **Titles** (owned, and the one worn in each category with its effects) and **Appearance** (skins, pet and wings).
- Each tab has its own address to share, and **Official page ↗** opens the character on PLAYNC's site. Bookmarked characters show their portrait.

### Changed
- Item grades now have the game's own colours (rare green, legend blue, unique orange).
- Characters looked up before this version fill in the rest the next time their profile is opened.

## 0.45.0 · 2026-10-27

### New
- The **Odyle history** and **Location** windows page through their lists: 15 changes or 12 places at a time, with buttons to the newer, older, newest and oldest pages, instead of one long list behind **Show all**.
- The Odyle history picks its period: **7 days**, **30 days**, **90 days** or **1 year**, as far back as the server keeps it. The chart, the weeks and the changes follow the period you pick; the weeks come six at a time.
- Server operators choose how long the Odyle history and the places of location sharing are kept, from 1 day to ten years (30 days unless they change it), under Odyle → Game settings. Your account page and the help say how long your server keeps them.

### Changed
- Pop-up windows keep their title and close button in view: only their content scrolls, and the page behind no longer scrolls along. A short last page keeps the list's height, so the page buttons stay under your pointer.
- On wide screens the Odyle history shows its chart and weeks beside the changes, and the Location window its map beside the places, so both fit without scrolling. A change or place from an earlier year shows the year.

## 0.44.1 · 2026-10-27

### Fixed
- For superusers: adding maps under **Game settings → Maps** no longer stalls. Adding or removing a map redraws only that row, so the field you type in keeps its place; typing an id or a name no longer redraws the ids seen without a name, and a click on one of them or on **Save changes** is no longer lost. An id that already has a row is no longer offered again.

## 0.44.0 · 2026-10-27

### New
- Places in dungeons, Abyss layers, arenas and other instances can show their map too: superusers now pick from **all of TH.GL's AION 2 maps** (151, not just the six regions) under **Game settings → Maps**.
- Maps link themselves: a map id named after a place TH.GL lists, like *Altgard* or *Valka's Nest*, gets its TH.GL map without typing it, and picking a TH.GL map of one place names the map. Maps named earlier link the same way.
- Under the map of a place, **Open on TH.GL ↗** opens the full map on TH.GL's site.

## 0.43.0 · 2026-10-24

### New
- **Location sharing**, off until you turn it on: under **Account & data → Location sharing**, **Share my location with my rooms** lets the rooms your characters are shared in see where each was last seen. The Windows app (from 0.28.0) reads the place from the game at each loading screen, while gliding or flying and with some skills; a plain walk sends nothing, so a place always shows how long ago it was.
- Character rows show the map and its age (📍 Altgard · 4m ago). Click it for the place on **TH.GL's AION 2 map**, centred on the character with a pin, and the character's places of the last 30 days. An open map follows the character's newer places until you move it.
- Places are kept for 30 days. Turning sharing off deletes them at once, and **Download my data** includes them.
- For superusers: **Game settings → Maps** names the game's map ids and links each to its TH.GL map; ids players visited without a name are listed to add. **Server controls** can switch the location adapter off.

## 0.42.1 · 2026-10-24

### Fixed
- A main character now shows the **avatar frame** won on the slot machine. The gold ring around the portrait used to cover it and is gone; the gold card edge and the **Main** label still mark the main character.

## 0.42.0 · 2026-10-24

### New
- The slot machine gives every account **3 free spins every day**, on top of the spins your characters earn. They come back with the daily reset; unused ones do not carry over, and the machine shows how many free ones you have left today.
- **25 new cosmetics** to win: name colours Lilac, Peach, Lime, Coral, Sunset, Ocean, Odyle glow and Prism; avatar frames Bark, Frost, Blossom, Jade, Void and Eclipse; badges Mushroom, Paw, Tea, Bow, Potion, Owl, Lightning, Skull, Unicorn, Comet and Trophy.
- Server operators set the free spins a day and the spins each character read earns under Odyle → Game settings → Slot machine.

## 0.41.1 · 2026-10-23

### Fixed
- **Run now** answers at once again, and the rest of the dashboard no longer stalls while the push notifications go out. Players are told only once the run is really planned.
- Signing out everywhere stays signed out: old sign-ins no longer come back to life a moment later. Slot machine spins, notification settings, your display name and other account changes made at the same moment are kept too.
- Connecting a Discord webhook no longer undoes a room rename or setting saved while Discord answered.
- A run cancelled or changed while its Discord post was being updated now shows on Discord as well, instead of the post staying as it was.
- A character's latest reading is kept when its reader session ends or its class is named at the same moment, and an armory profile hidden by the server operator stays hidden.

## 0.41.0 · 2026-10-23

### New
- **Run now**: beside **Plan run**, call the party to a dungeon right away. The run starts in about ten minutes, and the players who play now or hold enough Odyle for a cube are told on the dashboard, by push and in Odyle for Windows (0.27.0 and later), unless it is their quiet hours. A room calls once every 30 minutes.
- **The waitlist**: once as many go as the dungeon's party size, the next players **Join the waitlist** and get a place, first come first, when someone leaves. Party ready, the Discord post and **Done** count the party only, so those still waiting keep the dungeon on their wishlist.
- **The party's make-up** on every planned run: its classes, tanks first, and *no tank* or *no healer* once three or more go. Server operators set each class's role under **Odyle → Game settings → Class roles**.

## 0.40.0 · 2026-10-22

### New
- Server operators can vacuum the database from the admin dashboard (**Odyle → Server status → Database**): one button for the data and one for the logs, each showing how much space a vacuum would give back to the disk and how the last one went.

## 0.39.0 · 2026-10-22

### New
- Every room has an **information board** at its top: the leader and officers write what every member should know (the week's plan, rules, a Discord link) under **Write** or **Edit**. Lines stay as written and web addresses become links; members see who changed it last and when.
- **Room features** under Room settings: the leader turns the information board, planned runs, the dungeon wishlist and the party's week on or off for the whole room. The board's text and the wishlist's entries are kept while they are off; turning planned runs off cancels the runs planned at the time, after asking.

## 0.38.1 · 2026-10-21

### Fixed
- While the armory fetches a character from PLAYNC, the waiting line shows a small spinner beside its text again, instead of a long line sweeping across the page.

## 0.38.0 · 2026-10-21

### New
- A character whose natural pool will be full within two days stands out in orange (**Nearly full**), and in red once it is full or fills within the hour (**Full**), in your list and in every room, so you can spend Odyle before regeneration is lost.

### Changed
- **Membership** under Account & data starts at **No membership**, so the Odyle clock and cap alerts count with 560 from the first reading. Accounts that had not answered are set to no as well, or to yes when one of their characters already held more than 560. Change it any time.

### Fixed
- The server is built with Go 1.27.3, which no longer trusts compromised intermediate certificates on its outgoing connections (Discord, PLAYNC, GitHub).

## 0.37.0 · 2026-10-20

### New
- Mark one of your characters as your main with the star under Rooms & characters. It is highlighted in gold and comes first, in your list and in your group in every room it is shared in.

## 0.36.1 · 2026-10-20

### Changed
- In a room's party your own characters come first, above the other players.

## 0.36.0 · 2026-10-20

### Changed
- A room's party lists each player's characters together under the player's name, with how many characters they have and how many are ready. The player closest to ready comes first. The room leader removes a player from that player's name.

## 0.35.0 · 2026-10-18

### New
- A room says under its name what the party spent this week: the Odyle its shared characters spent since the weekly reset, and about how many cubes that is. One line for the whole party, never per member.
- Once a run has started, it says when the readers saw its attendees spend the run's cost, and **Done** stands out, so wrapping the run up is one click.
- A character's Odyle history shows, by week, about how many hours the natural pool sat full and how much regeneration it lost, when its cap is known.

## 0.34.0 · 2026-10-17

### New
- **Calendar feed**: under **Account & data**, make a private link for Google, Outlook or Apple Calendar that keeps the runs you are going to up to date (dungeon, room and time; never notes). Make a new link or stop it any time.
- **Event links**: a run can link its event elsewhere (Raid-Helper, Apollo, a Discord event). Edit the run to add one; it shows on the run, in its Discord posts and in Copy for Discord.

## 0.33.1 · 2026-10-17

### Changed
- The slot machine is a real gamble now: a spin wins only 15 % of the time, and the reels show three different symbols when it wins nothing. It plays sounds as the reels spin, win or lose (🔊 turns them off), and its odds line is smaller.

## 0.33.0 · 2026-10-17

### New
- **Wishlist invites**: a run planned with **Plan** from the wishlist invites everyone who wants that dungeon. They get a notice in their open dashboards, and the run lists who is invited until they answer Going or Can’t.

## 0.32.0 · 2026-10-17

### New
- **A secret** for players who read with Odyle every day: something now hides behind the logo. Those who find it can win things to wear in their rooms.

## 0.31.0 · 2026-10-17

### New
- **Odyle history by week**: the history dialog adds up each reset week: Odyle spent (and about how many cubes), regeneration, and items and other gains, from the changes the reader saw.

## 0.30.0 · 2026-10-17

### New
- **Rooms & characters** lists **Your next runs**: the runs you are going to in the next two weeks, each opening its room, and **Add all to calendar** for all of them in one file.
- Each room there says its members, who plays live now, the cubes the party can open now and its next run, instead of the cost per cube.
- Until you have saved a character, a room shows four steps to get one into its party: install and pair the Windows app (with what to do when Windows warns, and Npcap), keep it running, log in to the character once, and add it here. With characters saved, the room offers them to add as before.
- **Can’t**: next to Going, a run takes the answer that you cannot come, lists who can’t and counts the players who have not answered yet; Going counts against the dungeon's party size when the catalog knows it ("3/5 going").
- **Planned runs call the roll** from 15 minutes before the start to 30 minutes after: each attendee shows ready, short, not in game or no character, and a line counts them ("Roll call: 3 ready · 1 short").

## 0.29.1 · 2026-10-17

### Fixed
- Names, notes, dungeon and task titles no longer keep invisible characters or text-direction controls, which could make one name look like another or reverse how a note reads.

## 0.29.0 · 2026-10-17

### New
- **Party ready**: from an hour before a run you are going to, once everyone going plays live with enough Odyle for a cube, each of you is told once, in the browser, by push and in Odyle for Windows once it updates. Turn it off under **Account & data → Notifications**; quiet hours apply.

## 0.28.0 · 2026-10-17

### New
- A planned run that falls into the game's **weekly maintenance** says so, with the maintenance times in your local time. The server's operators set the window under Game settings.

## 0.27.0 · 2026-10-17

### New
- **Room settings → Discord reminders** shows the language of the room's posts and lets its owner change it (English or Czech); posts still showing a run follow at once. Before, it was quietly the language the dashboard had when the channel was connected.

## 0.26.0 · 2026-10-17

### New
- The server's operators can **hold back a Windows app version** that misbehaves: Odyle for Windows 0.18.0 and later never installs it, and moves back to the latest good release if it already runs it.

## 0.25.0 · 2026-10-17

### New
- **Account & data → Notifications** has a switch for **daily and weekly tasks**: two hours before a reset, Odyle for Windows (0.17.0 and later) lists in its tray the tasks you have not ticked yet. It is on until you turn it off.

## 0.24.0 · 2026-10-17

### New
- **Officers**: under **Room settings** the room's owner can make a member an officer. Officers play like players, and also make invite links, change or cancel any run, clear a dungeon off everyone's wishlist and keep the Discord reminders. Renaming and closing the room, roles and handing it over stay with the owner. When an owner's account is deleted, an officer takes the room before the other players.

## 0.23.0 · 2026-10-17

### New
- **Discord reminders** can show how many of those going can claim a cube: "3/5 by the start", and "5/5 · party ready" once the run starts. The room's owner turns it on under **Room settings → Discord reminders**; the post shows counts only, never names or Odyle values, and follows changes up to the start.

## 0.22.0 · 2026-10-17

### New
- **Account & data** shows what you use against the limits (rooms you lead, rooms, PCs, characters) and since when you are a member, and, when the server deletes unused accounts, the date yours would go if you stayed away.
- Each paired PC says which Odyle for Windows it runs, and **update available** when a newer one is out.
- When the server's operator pauses reminders, Account & data and Room settings say so.

## 0.21.0 · 2026-10-17

### New
- **NA-East and NA-West are told apart.** Both have servers of the same names (Siel, Lumiel…), so two characters of the same name, one in each, used to become one. Cards and the armory say NA-E or NA-W. Characters already saved move to NA-West once the daily lookup finds them there (with Odyle for Windows 0.16 or newer for new readings).

## 0.20.0 · 2026-10-17

### Changed
- A character no Windows reader has read or seen for 12 months is deleted with its history by a nightly job. Playing it again with the reader saves it anew.
- **Privacy** names who runs Odyle and how to reach them, and says what your e-mail is used for: only the alert when your account signs in from a new device.
- The armory calls item level **GP**, as players do.

### Fixed
- The armory's combat power and GP panel is laid out again (it lost its layout in 0.17.0).

## 0.19.0 · 2026-10-17

### New
- **Open in Odyle** in the Pair Windows app dialog: one click hands the connection link to Odyle for Windows (0.15 or newer), also while it is running. Odyle names the server and asks before pairing; copying the link still works.

## 0.18.1 · 2026-10-17

### Changed
- **Rooms & characters** is the heading of its page, like the item that opens it.
- Once you have a room, creating or joining another sits folded under your rooms; **Create or join a room** in the room menu opens it.

### Fixed
- Short pages such as Daily & weekly and the armory start at the top instead of halfway down.

## 0.18.0 · 2026-10-17

### New
- A character the Windows app read before its Odyle unlocks says **No Odyle yet · it unlocks at level 22** instead of waiting for a value (with a Windows app that sends it).
- The wishlist says how long each dungeon has been on it.
- **Show all** in a character's history lists every change, not just the newest 12.

### Changed
- When the room's next run is of a dungeon the catalog lists, the room's numbers and rows count at that dungeon's cost, and the heading says so.
- "Party can open N cubes" counts the best players up to the dungeon's party size when more are live.
- On phones the history chart no longer stops the page from scrolling.

### Fixed
- **Sign out everywhere** no longer signs out the browser you clicked it in as well, now and then.

## 0.17.0 · 2026-10-17

### New
- **Room switch**: the sidebar (on phones the bar at the top) names the room you are in and opens any of your rooms in one click, or the way to create or join one.
- **Account menu** behind your name: Account & data, pairing the Windows app, invitations, Reader & privacy, What's new and signing out, in a small menu instead of a dialog.

### Changed
- **A new room page**: the room's name is its heading, and one panel shows the party's cubes, who is ready, who is live and the lowest player, with who is not counted under it.
- **Characters are rows**: name, class and level, status, Odyle with its natural and item parts, regeneration, cubes and actions on one line on wide screens, nothing cut off. Medium screens use two lines, phones a compact block.
- Shorter navigation: Party, Rooms & characters, Tasks and Armory, each on one line; the reader's state sits at the bottom of the sidebar.
- Less on every page: no small-caps lines over the headings and no panels repeating the help under the party; planned runs and the wishlist sit side by side on wide screens.
- The account page puts its short cards in one column beside Notifications.
- **Room settings** is one section per subject: name, members (you first), Discord reminders, your new characters and, last, closing the room.
- Planned runs and the wishlist use readable small print, and in a narrow column the people going take their own line instead of being cut off.

## 0.16.0 · 2026-10-17

### New
- **Privacy** is a page of the dashboard: what Odyle keeps, where it goes and how long it stays, with links to report a problem or ask. The welcome page, the help and the footer link it.

### Changed
- The fonts come with the dashboard, so opening it no longer contacts Google Fonts; no page loads anything from another site.

## 0.15.0 · 2026-10-17

### New
- **A checklist per character**: Daily & weekly keeps a list for your account and one for each of your characters, so alts track their own dailies and weeklies. Each list holds up to 40 tasks.
- **Add from the Global list**: the server's operators keep a list of the game's daily and weekly tasks, and you add the ones you want to a list in one go.
- The navigation shows how many tasks are left, and each list says how many it has left.

## 0.14.0 · 2026-10-17

### New
- **Copy for Discord** on each planned run: a message with the dungeon, a time Discord shows in everyone's own time zone, who is going and a link back to the room, ready to paste in any channel. No webhook needed.

## 0.13.0 · 2026-10-17

### New
- **Discord reminders link back to the room** and stay correct: a post is updated when the run changes and marked when it is cancelled or done.
- Room owners choose up to three reminder times (5 minutes to 2 hours) and can have a run posted as it starts too.
- **Discord mentions**: turn them on under Account & data → Notifications and the reminder of a run you are going to pings you in Discord, even with the PC off.
- Room settings show the webhook's name and whether the last post got through, and why reminders stopped if Discord dropped the webhook.

### Fixed
- A run is never posted twice when the server fails to note a reminder.

## 0.12.0 · 2026-10-16

### New
- Character cards show the class and level PLAYNC lists for the character, such as **Chanter · Lv 45**, and run attendees show their class. They come from the daily portrait lookup, so a level can be a day old.
- A card's **Armory** link opens the character's own profile once PLAYNC has listed it, instead of a search by name.

## 0.11.0 · 2026-10-16

### New
- **Phones** get a bar at the bottom with Overview, Rooms, Daily, Armory and Account; Invitations and Reader & privacy are in the avatar menu.
- The pages in the sidebar are links, so they open in a new tab too.

### Changed
- Small print is at least 11 px on narrow screens, the sidebar with icons only names its items, and the breadcrumb leads home.

### Fixed
- Signed out, the dashboard no longer says "Not connected" while the server answers.
- Screen readers get a skip link, dialogs named by their heading, and who is live in the wishlist and runs as text.

## 0.10.0 · 2026-10-16

### New
- **What's new**: this list of changes, opened from the version in the footer. After an update the dashboard says so once.
- What's new also shows what the newest Windows app release changed.

## 0.9.0 · 2026-10-16

### New
- **Account & data → Membership**: say whether your game account has the membership. The Odyle clock then knows the natural pool's cap (840 with it, 560 without) instead of guessing from your readings. Rooms see only the cap on the characters you share, never the answer.
- A character whose natural pool held more than your answer allows says so on its card.

### Fixed
- The cap alert choice and its notes no longer run past the Notifications card.

## 0.8.0 · 2026-10-16

### New
- **Armory bookmarks**: bookmark a character on its armory profile and the armory page lists it, with its combat power and item level. No account needed; bookmarks stay in your browser.

## 0.7.0 · 2026-10-16

### New
- **Armory**: look up any AION 2 Global character's gear, combat power, item level and stats, without signing in. Profiles come from PLAYNC's official pages, are kept for everyone and refresh at most every six hours; a new one waits in a slow queue, and the page says how long.
- Every character card links its armory profile.

### Fixed
- Card buttons wrap onto a second row instead of being cut off.

## 0.6.0 · 2026-10-16

### New
- The room explains its numbers: who holds the party back, who isn't counted and why, and the last known party while someone is missing.
- **Live only** hides the characters that aren't live.
- New characters can join chosen rooms by themselves (Room settings → New characters).
- Planned runs count their own party: each attendee brings a chosen character, and the plan form suggests the earliest time everyone can claim a cube.
- Started runs can be wrapped up: **Done** clears the wishlist, **Didn't happen**, or **Plan again next week**.

### Changed
- Releases carry semantic versions (0.6.0 and on). Earlier releases were numbered 0.5.0 plus a run number; their notes are on GitHub.
