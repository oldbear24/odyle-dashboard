# Odyle API v2 · Discord accounts

PocketBase 0.40.5. JSON requests; authenticated requests use a PocketBase **users** token (`Authorization: Bearer <token>`). HTTPS for hosted connections. No superuser credentials belong in either client.

## Authentication

The browser calls `pb.collection('users').authWithOAuth2({ provider: 'discord', createData: { displayName: 'Adventurer' } })`. PocketBase creates or loads the account linked to that Discord identity; a new account then takes its Discord name through `POST /api/odyle/profile`. Public password registration and password sign-in are disabled, and the `users` collection accepts no direct updates (only the routes below write accounts).

`POST /api/odyle/desktop-code` with `{}` returns `{ code, expiresAt }` to an authenticated account. The 16-character code expires after five minutes, is stored as a digest, and replaces that account's previous unused code.

The dashboard presents a connection link such as `https://your-backend.example/#odyle-pair=ABCDEFGH23456789`. The Windows app extracts the endpoint and code when the user clicks **Paste link & connect** or presses Enter in the pairing input. The fragment is never sent as part of an HTTP request. This link contains the short-lived pairing code, not the account token; only the intended Windows companion should receive it. Base-path deployments are preserved, insecure remote HTTP and embedded URL credentials are rejected. Older apps can still use the raw code with a separate endpoint.

`POST /api/odyle/pair` is public and rate limited. Body `{ code, name? }`, where `name` is the PC's Windows computer name (optional, up to 40 characters; anything else is left out, never refused); response `{ token, record, deviceKey }` for the same account. The code is consumed atomically. Windows stores the device key and token in DPAPI, never Discord credentials.

### Lasting pairing

The link is used once; the pairing lasts. `deviceKey` is a 48-character secret for that one app; the server keeps only its SHA-256 digest (`desktop_devices`). Account tokens last seven days, so the app trades the key for a fresh token whenever it starts, every 24 hours while it runs, and whenever a request answers 401:

| Method / route | Body | Result |
| --- | --- | --- |
| POST `/api/odyle/desktop-sign-in` | `{ deviceKey, name? }` | Public, 30 a minute per client: `{ token, record }` for the paired account; the key's `lastUsedAt` is updated and a given `name` replaces the PC's name. An unknown key answers 401 and the app asks to pair again |
| POST `/api/odyle/desktop-device` | `{ name? }` | Signed-in account: `{ deviceKey }` for a new pairing. Apps paired before device keys existed call it once with their still-valid token |
| POST `/api/odyle/unpair` | `{ deviceKey }` | Public, 30 a minute per client: forgets that key and ends its reader sessions (the app's **Disconnect**); unknown keys answer 200 too |
| POST `/api/odyle/forget-device` | `{ deviceId }` | Signed-in account (**Account & data → Remove PC**): forgets one of its pairings and ends that PC's reader sessions; another account's PC answers 403, an unknown one 404 |

A pairing has no inactivity expiry: it ends when the app disconnects, the PC is removed on the dashboard, the account signs out everywhere or is deleted. An account keeps its 10 most recently used pairings; pairing an eleventh PC drops the one unused longest. The account page lists them (`devices` in `GET /api/odyle/account`) and the data export as `pairedWindowsApps` (`name`, `pairedAt`, `lastSignInAt`), without keys or digests.

A paired app opens its reader session with its key (`POST /api/odyle/session` with `deviceKey`), which ties the session to the PC. Removing the PC deletes those sessions, so the app's next heartbeat answers 403 *Publisher session expired*; its new session with the same key answers 401 *This PC is no longer paired with an account.* and the app asks for a new link, within about a minute. Apps that open sessions without their key (releases before 0.6) stop at their next device sign-in instead: at start-up or within a day.

`POST /api/collections/users/auth-refresh` refreshes a valid token. Tokens last seven days; accounts/data persist independently of token expiry. A Windows app paired by a backend without device keys keeps its connection only by refreshing within those seven days.

## Rooms

| Method / route | Body | Result and authorization |
| --- | --- | --- |
| POST `/api/odyle/create` | `{ name }` | Signed-in user creates owned room; returns `{ room, membership, invites }` |
| POST `/api/odyle/join` | `{ code }` | Join as reporter/viewer; returns `{ room, membership }`; repeat join is idempotent |
| GET `/api/odyle/rooms` | — | `{ rooms, odylePerCube, announcement, readerPaused, serverNow }`: all rooms of the current account; `announcement` is `{ text, level }` (`info` or `warning`) or `null`, and `readerPaused` is `true` while superusers pause packet readers (see [Reader pause](#reader-pause) and [Server controls](#superuser-monitor-and-settings)) |
| GET `/api/odyle/announcement` | — | Public `{ announcement }`, the same message, for pages without an account |
| GET `/api/odyle/snapshot/{id}` | — | Member-only `{ room, members, wishlist, runs, dungeons, serverNow }`; each member has `displayName` and `characters`; `dungeons` is the server's dungeon catalog (empty: any name) |
| POST `/api/odyle/sharing` | `{ roomId, characterId, enabled }` | Reporter/owner shares or hides one of their own characters in this room; returns `{ sharedCharacters }`. Without `characterId` (older clients) the choice applies to every character saved at that moment |
| POST `/api/odyle/wishlist` | `{ roomId, dungeon, wanted, everyone? }` | Adds (`wanted: true`, reporter/owner) or removes (`false`, any member) the caller's own entry for a dungeon; `everyone: true` with `wanted: false` lets the owner clear that dungeon for all members. Returns `{ wishlist }` |
| POST `/api/odyle/invites` | `{ roomId }` | Owner revokes old codes and receives reporter/viewer invites |
| POST `/api/odyle/revoke` | `{ roomId, memberId }` | Owner removes another membership |
| POST `/api/odyle/leave` | `{ roomId }` | Non-owner removes their membership; character data remains |
| POST `/api/odyle/close` | `{ roomId }` | Owner deletes room and memberships; character data remains |
| POST `/api/odyle/rename` | `{ roomId, name }` | Owner renames the room (1–60 characters); returns `{ room }` |
| POST `/api/odyle/role` | `{ roomId, memberId, role }` | Owner makes another member `reporter` (player) or `viewer`; a member made viewer stops sharing characters in the room. Returns `{ membership }` |
| POST `/api/odyle/transfer` | `{ roomId, memberId }` | Owner hands the room to another member, who becomes `owner`; the caller stays as `reporter`. Returns `{ room }` |
| POST `/api/odyle/plan` | see [Planned runs](#planned-runs) | Plans, changes, joins, leaves or cancels a run; returns `{ runs }` |
| POST `/api/odyle/discord-webhook` | `{ roomId, webhook, language? }` | Owner connects a Discord channel webhook for run reminders (`language` `en` or `cs`) or disconnects it (`webhook: ''`); see [Run reminders](#run-reminders). Returns `{ room }` |

Room codes are valid for 30 minutes; memberships and rooms have no automatic inactivity expiry (accounts can have one, see [Account and data](#account-and-data)). Dashboards share codes as invite links of the form `https://your-dashboard.example/#/join/<code>`; the code stays in the fragment, so no server receives it with the page request, and opening the link while signed in calls `join` with it. An account can own up to 20 rooms and be a member of up to 50; a room holds up to 50 members. Every change answered by the routes above sends the room's realtime news (see [Realtime](#realtime)). Sharing is per character: each membership lists the characters its owner linked to that room (`sharedCharacters` in `GET /api/odyle/rooms`). New characters start private everywhere. Room snapshots include only linked characters of other members; members always see all of their own characters, each with `shared: true|false`. Upgrading a backend keeps every character of a membership that shared everything shared. Viewer accounts can maintain private characters, but cannot share them in a viewer-only room. Display-name collisions are resolved by user/member IDs.

### Dungeon wishlist

Each room keeps a list of dungeons its members still need to run. Names are free text (1–60 characters); whitespace is collapsed and names are matched without regard to case, so `fire  temple` joins an existing `Fire Temple` entry, which keeps its first spelling. Repeating an add or removing an entry you are not on changes nothing. A member can be on up to 20 dungeons per room and a room lists up to 50. Entries belong to the membership: leaving, being removed or closing the room deletes them. Viewers see the list but cannot add to it.

The snapshot's `wishlist` is grouped by dungeon, most wanted first, then oldest:

```json
[{ "key": "fire temple", "dungeon": "Fire Temple", "since": "2026-10-13 18:00:00.000Z", "users": ["user-id-1", "user-id-2"] }]
```

`users` are account ids in the order they added the dungeon; clients take display names from `members`. Every change sends the room's realtime refresh, edits in the PocketBase dashboard included. The `room_wishes` collection has no API rules; use the routes above.

### Planned runs

Members plan runs of a dungeon at a time and join them. `POST /api/odyle/plan`:

| Body | Who | Effect |
| --- | --- | --- |
| `{ roomId, dungeon, startsAt, note? }` | owner, players | Plans a run with the caller going. `startsAt` is an ISO time from an hour ago to 60 days ahead, `note` up to 120 characters; up to 20 runs per room |
| `{ roomId, id, going }` | owner, players | `true` joins the run, `false` leaves it |
| `{ roomId, id, dungeon?, startsAt?, note? }` | planner, owner | Changes the run with the same rules as planning; a dungeon that only differs in case or spacing keeps its name, an empty or blank `note` removes the note, a new `startsAt` announces the run on Discord again |
| `{ roomId, id, remove: true }` | planner, owner | Cancels the run |

The snapshot's `runs` lists runs until three hours after they started, soonest first; the expiry cron deletes them a day after the start. `planner` and `attendees` are account ids (`planner` is empty once its member left; leaving or removal takes a member off every run):

```json
[{ "id": "run-id", "dungeon": "Fire Temple", "startsAt": "2026-10-14 19:00:00.000Z", "note": "Bring potions", "planner": "user-id-1", "attendees": ["user-id-1", "user-id-2"] }]
```

Viewers read runs but cannot plan or join them. The `room_runs` collection has no API rules.

### Run reminders

`GET /api/odyle/upcoming` returns `{ runs, serverNow }`: the runs the signed-in account is going to in the next 24 hours, across its rooms, soonest first, each `{ id, roomId, room, dungeon, startsAt, note }`. The dashboard (while open, when **Run reminders** is on in that browser) and the Windows app show a notification 15 minutes before each start.

A room owner can connect a Discord channel webhook (`POST /api/odyle/discord-webhook`). Only `https://discord.com/api/webhooks/<id>/<token>` URLs (also `discordapp.com`, `ptb.` and `canary.`) are accepted; the backend posts a test message first and refuses the webhook when Discord does not accept it. The URL is stored in a hidden field: no response, snapshot or export carries it, and rooms report only `discordReminders: true|false`. Every minute the `odyle-reminders` job posts each run of those rooms that starts within 15 minutes and was not announced yet (dungeon, Discord timestamps that show in every reader's time zone, note and the display names of the members going, in the language chosen when connecting); mentions are switched off. A webhook Discord answers 401 or 404 for is dropped. When Discord asks to wait (429), the backend waits out up to two seconds once; a longer wait leaves that webhook (every webhook, when Discord names its limit global) alone until it is over, and its runs stay due for a later run. A connection test Discord answers 429 for is refused with "Discord asked to slow down. Try again in a minute."

### Dungeon catalog

Superusers can keep a list of dungeon names in `odyle_settings.dungeons` (see [Superuser monitor and settings](#superuser-monitor-and-settings)). While it is empty, wishlist entries and runs take any name. Once it lists dungeons, a new wishlist entry or run must match one of them (regardless of case and spacing) and takes the catalog's spelling; existing wishlist entries can still be joined and left. Snapshots report the list as `dungeons` for suggestions.

## Daily and weekly tasks

Each account keeps a private checklist of daily and weekly tasks in its own order. Titles are free text (1–60 characters, inner whitespace collapsed) and an account can keep up to 40 tasks. Checking a task stores the time in `doneAt`; the server never unchecks it. Clients show a task as done while `doneAt` is on or after the start of the current period: daily periods begin at `resets.dailyResetHour` UTC, weekly periods on `resets.weeklyResetDay` at that hour (`src/tasks.js` is the reference implementation). Both values come from `odyle_settings` (`dailyResetHour` 0–23, `weeklyResetDay` `sunday`…`saturday`), which superusers edit on the PocketBase dashboard's Odyle page or under *Collections*; the defaults are the Global service's 07:00 UTC and Wednesday.

| Method / route | Body | Result |
| --- | --- | --- |
| GET `/api/odyle/tasks` | — | `{ tasks, resets, serverNow }` of the signed-in account in the account's order (`position`, then oldest first); new tasks go to the end of their list |
| POST `/api/odyle/task` | `{ title, cadence }` | Adds a task; `cadence` is `daily` or `weekly` |
| POST `/api/odyle/task` | `{ id, done }` | `true` stores the current time in `doneAt`, `false` clears it |
| POST `/api/odyle/task` | `{ id, title }` | Renames the task (same rules as adding) |
| POST `/api/odyle/task` | `{ id, move }` | `up` or `down` swaps it with its neighbour in the same list; at either end nothing changes |
| POST `/api/odyle/task` | `{ id, remove: true }` | Deletes the task |

Every POST answers with the same `{ tasks, resets, serverNow }` as the GET:

```json
{ "tasks": [{ "id": "task-id", "user": "user-id", "title": "Daily dungeon", "cadence": "daily", "doneAt": "2026-10-13 18:00:00.000Z", "created": "2026-10-13 09:00:00.000Z", "updated": "2026-10-13 18:00:00.000Z" }], "resets": { "dailyResetHour": 7, "weeklyResetDay": "wednesday" }, "serverNow": "2026-10-13T18:00:01.000Z" }
```

A task of another account answers 403 and an unknown id 404. A change tells the account's own realtime topic (`odyle.user.<accountId>`, so the Windows app and other tabs follow); tasks are not part of room snapshots. The `user_tasks` collection has no API rules; use the routes above.

## Persistent characters and publisher sessions

Own characters can be read with the normal PocketBase `characters` collection API. Others' records and all direct character writes are locked. Shared readings are read via authorized room snapshots; the Windows app reads `GET /api/odyle/snapshot/{id}` for each room to list the party.

### Odyle history

Every reading that changes a character's value (the first one included) is also stored in `character_readings` for 30 days, with `adapter`, the `parserVersion` of the reading (points saved before adapters were recorded carry their character's latest adapter, `global-reference-v1` on the hosted backend). `GET /api/odyle/history/{characterId}` returns the changes of those 30 days, oldest first, to the character's owner and to members of rooms it is shared in (others get 403, unknown ids 404):

```json
{ "character": { "id": "character-id", "characterName": "Lumina", "value": 140, "confirmed": true }, "readings": [{ "value": 100, "at": "2026-10-13 18:00:00.000Z", "adapter": "global-reference-v1" }, { "value": 140, "at": "2026-10-14 09:12:00.000Z", "adapter": "global-reference-v2" }], "hourlyBefore": null, "serverNow": "2026-10-14T12:00:00.000Z" }
```

The answer always reaches back to the start of the 30 days and holds at most 1,721 points. Up to 1,000 changes are all listed and `hourlyBefore` is `null`. A character with more lists its newest 1,000 one by one and, before the oldest of them, the last change of each hour; `hourlyBefore` is then the time of that oldest change, so clients know the points before it are hourly. A value holds until the next point either way, so a step chart stays correct to the hour. The `character_readings` collection has no API rules.

### Character pictures

Each character record carries `portrait`, a file name or empty. Clients load the image from `/api/files/characters/{id}/{portrait}` (the SDK's `pb.files.getURL(record, record.portrait)`); room snapshots include both fields for shared characters only, so other members never receive the link of a private character.

`portrait` is always the character's **official AION 2 portrait**; players cannot set, upload or replace it, and no route writes it. The backend looks up a new character as soon as it is saved through PLAYNC's public Global character search (`api-search.plaync.com/aion2global/search/v2/character`, by name, server id and region, 20 names to a page) and downloads the `profileImageUrl` it lists from `profileimg.plaync.com`; rooms the character is shared in hear of the picture over realtime when it arrives. The search lists every name that contains the keyword, so a lookup reads further pages until it finds the exact name or the last page (by `pagination.total`), five pages at most. Up to ten newly saved characters wait for their lookup at a time; the cron job looks up the others, and those saved while portraits were paused, within a minute or two. It refreshes characters with a portrait daily, rewriting the file only when the image changed. A character the search does not list is tried again an hour, six hours and a day after its first misses, then weekly; a failed search does not count as a miss. Characters no reader has seen for 60 days (or saved that long ago and never read) are not looked up until a reader sees them again. At most two lookups run at a time, and never two for one character. The search server id is rebuilt from the saved server name and region (the game protocol's race × 1000 + region × 100 + server number); NA East and West are both tried, West also when East fails. Characters the search does not list, such as ones on servers the reader cannot name, keep their initials; a failed lookup keeps the last downloaded portrait.

`POST /api/odyle/character` accepts only `{ characterName, server, region }` and returns `{ character }` for the signed-in account. An account keeps up to 30 characters; saving or reporting a new one beyond that answers 400. It saves identity before any reading, with unknown Odyle (`confirmed: false`, `valid: false`, no reading timestamp or source). Repeating the same identity returns the existing record without changing its last value or confidence. Ownership always comes from authentication; extra fields such as `value`, `user`, `source`, `confirmed` and `characterId` are rejected. The Windows app uses this endpoint for automatic game identification.

`POST /api/odyle/session` with `{}` returns `{ sessionId, sequence: 0, readerPaused }` (see [Reader pause](#reader-pause)). Optional `{ previousSessionId }` rotates that device's session and invalidates its last readings without clearing stored values or other devices' sessions. A paired app also sends `{ deviceKey }`; a key the server no longer knows (or of another account) answers 401, see [Lasting pairing](#lasting-pairing). Newer apps also send `{ appVersion }` (for example `0.6.0.12`; anything else is left out, never refused) for the superuser monitor. A PC runs one app at a time, so a new session with a device key removes the sessions that PC still had open (left by a restart, an update or a crash) without marking their readings stale: the restarted app takes its character over by reporting it again, and otherwise the missing heartbeat turns the reading stale after 45 seconds. The account page and the superuser monitor therefore list one session per paired PC.

`POST /api/odyle/report`:

```json
{
  "sessionId": "publisher-session-id",
  "sequence": 1,
  "characterId": null,
  "characterName": "Your character",
  "server": "Your server",
  "region": "GLOBAL_EU",
  "value": 0,
  "source": "packet",
  "parserVersion": "global-reference-v1",
  "confirmed": true
}
```

Returns `{ character, serverNow }`. Existing `characterId` must belong to the authenticated account and keeps its saved name, server and region: the identity fields in the body are validated but never rewrite an existing character. Without an ID, the identity tuple `(user, region, server, characterName)` finds or creates a character. Value is an integer 0–1,000,000; sequence increases per device session. Supported regions: `GLOBAL_EU`, `GLOBAL_NA`, `GLOBAL_SA`, `GLOBAL_ASIA`. Only packet reports whose `parserVersion` is listed in the backend registry (`backend/odyle/protocols.go`) are accepted; it currently lists `global-reference-v1` and `global-reference-v2`, the Windows companion's Global stream decoders (v2 reads the stat records by Odyle's resource id). Superusers can switch a built-in adapter off or accept another one under [Server controls](#superuser-monitor-and-settings); any other adapter is refused with *This packet adapter has not been validated for Global. No reading was saved.*, a message the Windows app recognizes. Manual reports are always rejected. While packet readers are paused every report answers 503, see [Reader pause](#reader-pause). The Windows app sends a value the first time it reads a character and afterwards only when the value changes, so `lastReadingAt` is the time of the last change (a value re-sent unchanged, for example after the reader paused, keeps that timestamp); its 20-second heartbeat keeps an unchanged value live. Client metadata is not cryptographic proof of a game observation. The synthetic `test-fixture-v1` adapter is approved only in disposable integration-test hooks.

`POST /api/odyle/heartbeat` with `{ sessionId, characterId }` updates presence for the character only when that session owns its latest reading. It never changes the last reading timestamp and answers `{ serverNow, readerPaused }`. Empty `{}` only returns those. Heartbeats are kept in server memory and written to the database every ten seconds in one transaction (the character's `lastSeenAt`, the session's last contact and expiry); every answer already shows the latest one (snapshots, the `characters` collection, the account page, the superuser monitor). Members of the character's rooms who may see it, and its owner, hear of each heartbeat over realtime (`seen`, see [Realtime](#realtime)) instead of fetching the room again; `GET /api/odyle/rooms` and the snapshot carry `serverNow` for clock correction.

`POST /api/odyle/invalidate` with `{ characterId, sessionId }` marks the latest reading invalid for current readiness if it belongs to that session. It **retains** value, identity and observation timestamp. Confirmed historical values are distinct from current confidence (`valid`). A valid reading is live while presence is newer than 45 seconds, however old the value is; 45 seconds without presence or an invalidated reading is stale, and 90 seconds without presence means offline.

### New packet adapters

A push to `main` ships a Windows release to every installed app at once, so a new decoder name reaches the backend first: list it in `backend/odyle/protocols.go` (or accept it under **Server controls → Also accept**) and deploy that before the Windows release that sends it. Otherwise every updated app has its readings refused. Once the apps in contact run the new release (**Server status** lists them by version), switch the old adapter off under **Server controls → Built-in adapters**. Apps still sending it are refused with the adapter message above, which the Windows app answers by checking for its update at once. A later backend release can then drop the old name from `protocols.go`. History points keep the adapter they were decoded by (`adapter`), so values of a retired decoder can be told apart.

### Reader pause

Superusers can pause every packet reader at once under **Server controls** (`readerPaused` in `odyle_settings`). While it is on, `GET /api/odyle/rooms`, `POST /api/odyle/session` and `POST /api/odyle/heartbeat` answer `readerPaused: true`, and `POST /api/odyle/report` answers 503 with *Packet readers are paused by the server operators.* without saving anything. Sessions, heartbeats and `invalidate` keep working, so readings turn stale as usual. Windows apps that know the switch stop capturing and close Npcap, say so on their card and start capturing again by themselves once the flag is `false`; older apps keep capturing, but their readings are refused. Saved values and history stay.

## Account and data

| Method / route | Body | Result |
| --- | --- | --- |
| GET `/api/odyle/account` | — | `{ account, characters, limits, apps, serverNow }`: `account` has `id`, `displayName`, `email`, `created`, `lastActiveAt`; `characters` is the number saved; `limits` is `{ characters: 30, ownedRooms: 20, memberships: 50 }`; `apps` lists the open reader sessions (`sessionId`, `connectedAt`, `lastContactAt`, `character`, `device`: the id of the PC that opened it, or empty), most recent contact first; `devices` lists the paired PCs (`id`, `name`, `pairedAt`, `lastSignInAt`), most recently used first |
| POST `/api/odyle/profile` | `{ displayName }` | Sets the display name rooms show (1–40 characters, inner whitespace collapsed); returns `{ record }` |
| GET `/api/odyle/export` | — | Everything stored for the account as one JSON document: account and sign-in identities, characters with their whole history (each change's `value`, `at` and `adapter`), memberships with shared characters, wishlist entries and runs, tasks, reader sessions and paired Windows apps |
| POST `/api/odyle/delete-character` | `{ characterId }` | Deletes one of the account's characters with its history and portrait; rooms stop listing it. Another account's character answers 403, an unknown one 404 |
| POST `/api/odyle/sign-out-everywhere` | `{}` | Rotates the account's token key, so every token (other browsers, paired Windows apps) stops working, deletes its Windows device keys, ends its reader sessions and pairing codes; returns `{ token, record }` for the calling browser |
| POST `/api/odyle/delete-account` | `{ confirm: true }` | Deletes the account with its characters, history, memberships, wishlist entries and tasks |

Whenever an account is deleted (by this route, in the PocketBase dashboard or for inactivity), each room it owns passes to its longest-standing player (`reporter`), or closes when it has none. `lastActiveAt` records the last use of any authenticated Odyle route (written at most hourly); when superusers set `inactiveAccountDays` (0 keeps accounts; at least 30), a nightly job deletes accounts unused for that many days.

## Windows app release

`GET /api/odyle/windows-release` is public and returns the newest release of the Windows companion as the backend last read it from GitHub:

```json
{ "repository": "oldbear24/odyle-windows", "releasesUrl": "https://github.com/oldbear24/odyle-windows/releases/latest", "latest": { "version": "0.5.0.2", "tag": "v0.5.0.2", "url": "https://github.com/oldbear24/odyle-windows/releases/tag/v0.5.0.2", "publishedAt": "2026-10-13T22:34:09Z", "packages": { "small": { "name": "odyle-0.5.0.2-win-x64.zip", "size": 217557, "url": "https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-x64.zip" }, "selfContained": { "name": "odyle-0.5.0.2-win-x64-self-contained.zip", "size": 71595826, "url": "https://github.com/oldbear24/odyle-windows/releases/download/v0.5.0.2/odyle-0.5.0.2-win-x64-self-contained.zip" } } } }
```

The backend calls GitHub's `releases/latest` API when it starts and then at most every ten minutes (every minute while it knows no release, and never before GitHub's rate limit allows) and serves the cached answer, so browsers never contact GitHub and the unauthenticated API limit is never reached. Requests never wait for a lookup while a release is known: they get it while GitHub is asked again in the background, and concurrent requests share one lookup. Later lookups name the known release's ETag, so an unchanged release costs GitHub a 304 that its rate limit does not count. Only versioned, published releases count; only packages with GitHub download links are listed: the x64 ZIPs under `small`/`selfContained`, the per-user installer `odyle-<version>-win-x64-setup.exe` under `installer` and the Windows on ARM ZIPs under `arm64.small`/`arm64.selfContained`. Checksum files are left out because the Windows app verifies its own downloads. When GitHub is unreachable the last known release is kept; without one, `latest` is `null` and clients link `releasesUrl`, GitHub's stable latest-release page. The dashboard shows the link on **My rooms & characters** and the packages in the **Pair Windows app** dialog, the installer first. `ODYLE_WINDOWS_REPOSITORY` points the lookup at a fork; `ODYLE_WINDOWS_RELEASE_URL` replaces the feed URL for tests.

## Superuser monitor and settings

The PocketBase superuser dashboard has an **Odyle** page (UI extension in `backend/admin`, served at `/_/extensions/odyle/`). The monitor, status, jobs and settings routes need a **superuser** token: anonymous requests answer 401 and `users` tokens 403.

| Method / route | Body | Result |
| --- | --- | --- |
| GET `/api/odyle/admin/monitor` | — | `{ serverNow, latestVersion, apps, packets }`; `latestVersion` is the newest Windows release (see [Windows app release](#windows-app-release)), or empty |
| GET `/api/odyle/admin/status` | — | `{ serverNow, startedAt, build, runtime, database, counts, release, versions, traffic }`, see [Server status](#server-status) |
| GET `/api/odyle/admin/pprof/{name}` | — | Go's profile of the running server, gzipped protobuf for `go tool pprof`: `profile?seconds=30` (CPU), `trace?seconds=5`, `heap`, `allocs`, `goroutine`, `threadcreate`, `block`, `mutex` (block and mutex sampling is off, so those stay empty); unknown names answer 404 |
| GET `/api/odyle/admin/jobs` | — | `{ serverNow, startedAt, jobs }` |
| POST `/api/odyle/admin/jobs/{name}` | — | Runs `odyle-expiry`, `odyle-portraits` or `odyle-reminders` now; `{ result, serverNow, startedAt, jobs }`. `odyle-retention` only runs on its schedule (400), unknown names answer 404, a job still running 400 |
| GET `/api/odyle/admin/settings` | — | `{ settings, defaults, builtInAdapters, acceptedAdapters, seenAdapters }` |
| POST `/api/odyle/admin/settings` | `{ odylePerCube?, dailyResetHour?, weeklyResetDay?, inactiveAccountDays?, dungeons?, announcement?, announcementLevel?, portraitsPaused?, remindersPaused?, pairingPaused?, readerPaused?, adapters? }` | Validates and saves the given values, keeps the others; same answer as GET. Bodies up to 64 KB, enough for a full dungeon catalog |
| GET `/api/odyle/admin/ui` | — | Public `{ version }`: content hash of the extension page, see below |

`apps` has one entry per open reader session, ordered by account name and then connection time, so heartbeats never reorder them. `device` is the paired PC's name and `appVersion` the version the app sent with its session (both empty when unknown). A running Windows app keeps one session and touches it with every heartbeat and reading, so `lastContactAt` is its last contact, the latest heartbeat included (the page shows 45 seconds without contact as late and 90 as offline). `character` is the character that session read last, or `null`; a character moves to whichever session read it most recently.

```json
{ "sessionId": "session-id", "user": "user-id", "account": "Lumina", "device": "DESKTOP-LUMINA", "appVersion": "0.6.0.12", "connectedAt": "2026-10-14 11:52:10.438Z", "lastContactAt": "2026-10-14 11:52:30.537Z", "readings": 1, "character": { "id": "character-id", "characterName": "Lumina", "server": "Lumiel", "region": "GLOBAL_EU", "value": 390, "confirmed": true, "valid": true, "lastSeenAt": "2026-10-14 11:52:30.537Z", "lastReadingAt": "2026-10-14 11:52:10.481Z", "parserVersion": "global-reference-v1" } }
```

`packets` are the newest 200 requests to every `POST /api/odyle/<action>` route (the `kind` is the action), `pair`, `desktop-sign-in` and `unpair` included, oldest first, each with a server-wide increasing `id`. They are kept in server memory only and a restart clears them. Each lists `at`, `kind`, its `source` (`app` for the Windows app's routes `session`, `report`, `heartbeat`, `invalidate`, `character`, `pair`, `desktop-sign-in`, `desktop-device` and `unpair`, `web` for the dashboard's), `user`, `account`, `ok`, the handling time `ms`, `error` when the request was rejected, and only the safe body fields of its route (`backend/odyle/monitor.go`, `shown`), for example `previousSessionId` and `appVersion` (session); `sessionId`, `sequence`, `characterId`, `characterName`, `server`, `region`, `value`, `parserVersion` (report); `roomId` with the room's name for room routes; `taskId` and `runId` for the body `id` of task and plan. Tokens, invite and pairing codes, device keys, webhook URLs, run notes and task titles are never kept. A device sign-in names the account its key belongs to.

```json
{ "id": 4, "at": "2026-10-14T11:52:10.547Z", "kind": "report", "source": "app", "user": "user-id", "account": "Lumina", "ok": false, "ms": 0, "error": "Outdated reading.", "sessionId": "session-id", "sequence": 1, "characterName": "Lumina", "server": "Lumiel", "region": "GLOBAL_EU", "value": 400, "parserVersion": "global-reference-v1" }
```

Superusers subscribe to the realtime topic `odyle.admin.packets` to receive each packet as `{ packet }` the moment it is handled; other clients are refused at subscription and before every delivery.

Settings: `odylePerCube` is an integer 1–1000, `dailyResetHour` 0–23 (UTC), `weeklyResetDay` `sunday`…`saturday`, `inactiveAccountDays` 0 (keep accounts) or 30–3650, and `dungeons` a list of up to 200 dungeon names (1–60 characters; duplicates by case and spacing keep the first spelling).

Server controls: `announcement` is one line of up to 300 characters (spaces and line breaks collapse; empty removes it) and `announcementLevel` `info` or `warning`. `portraitsPaused` and `remindersPaused` make those jobs skip their runs; `pairingPaused` refuses `desktop-code` and `pair` with *Pairing new PCs is paused for now. Try again later.* while paired PCs keep signing in. `readerPaused` pauses every packet reader, see [Reader pause](#reader-pause). `adapters` is `{ extra, disabled }`: readings are accepted from the built-in adapters (`backend/odyle/protocols.go`, listed as `builtInAdapters`) that are not disabled, plus up to 20 extra names (letters, digits, `.`, `-`, `_`, up to 80 characters); at least one must remain. `acceptedAdapters` is the resulting list and `seenAdapters` the adapter names in the latest packets with their saved and rejected readings.

`jobs` lists each scheduled job with `name`, `manual` (can run by hand), `state` (`active`, `paused` or `off` while inactive accounts are kept), `running`, and since the server started (`startedAt`): `lastRunAt`, `ms`, `byHand`, the last run's `done`, `failed`, `error` or `skipped` (`paused`, `off`), and `runs`, `failedRuns`, `totalDone`, `lastFailureAt`, `lastError`. Records live in server memory like packets. Saving creates the `odyle_settings` record if it was deleted. Rooms, room snapshots and the checklist report the new values on their next request.

### Server status

`startedAt` is when the server started. `build` is `{ version, commit, modified, builtAt, go, pocketbase, platform }`: the release version (`dev` for a build without one), its commit and whether the checkout had uncommitted changes, the commit's time, and the Go and PocketBase versions. `runtime` is `{ goroutines, heapBytes, heapObjects, systemBytes, gcCycles, lastPauseMs, pauseTotalMs, cpus, maxProcs, realtimeClients }`. `database` is `{ dataBytes, logsBytes }`: the sizes of `data.db` and of PocketBase's log database `auxiliary.db`, each with its write-ahead log. `counts` holds `accounts { total, active24h, active7d }` (by `lastActiveAt`), `characters { total, live }` (a valid reading with a heartbeat in the last 45 seconds), `rooms { total, discordReminders }`, `pairedPcs { total }`, `readerSessions { open, connected }` (in contact within 90 seconds), `plannedRuns { total, upcoming }`, `historyPoints { total }` and `tasks { total }`. `versions` lists the Windows apps in contact within 90 seconds by the `version` their session reported (`''` when the app sent none) with their number of `apps`. `release` is the Windows release lookup: `{ repository, version, publishedAt, checkedAt, fetchedAt, error }`, where `checkedAt` is the last time GitHub was asked, `fetchedAt` its last answer, an unchanged one (304) included (both empty before the first), and `error` why the last lookup failed (empty when it worked; a rate limit names when it ends).

`traffic` is the last hour, counted per minute in server memory only (a restart starts it over): every `POST /api/odyle/<action>` route under its `kind` with the packet's `source`, and the Odyle GET routes (`rooms`, `tasks`, `snapshot`, `history`, `upcoming`, `account`, `export`, `windows-release`, `announcement`) as `GET <route>` with the source `read`. The superuser routes and requests refused before Odyle handles them (missing sign-in) are not counted, and no account is recorded.

```json
{ "minutes": [{ "at": "2026-10-15T08:30:00.000Z", "app": 4, "web": 1, "read": 3, "rejected": 2 }],
  "total": { "count": 10, "rejected": 2, "averageMs": 2.6, "medianMs": 2, "p95Ms": 7, "maxMs": 7 },
  "routes": [{ "kind": "report", "source": "app", "count": 4, "rejected": 1, "averageMs": 2.5, "medianMs": 2, "p95Ms": 4, "maxMs": 4 }],
  "errors": [{ "kind": "report", "message": "Outdated reading.", "count": 1, "lastAt": "2026-10-15T08:30:53.048Z" }] }
```

`minutes` always has 60 entries, oldest first, each with the accepted requests by source and the rejected ones from any source. `routes` lists every route of the hour, busiest first, and `errors` up to 20 rejection reasons, most frequent first. `averageMs` and `maxMs` are exact; `medianMs` and `p95Ms` are upper bounds, because times are counted in steps of 1, 2, 5, 10, 25, 50, 100, 250 and 500 ms, 1, 2.5 and 5 s; they report the slowest time instead when that is lower, and for anything beyond 5 s. `total` has the timings only once a request was counted.

PocketBase serves extension files with a 14-day browser cache. The backend sends the combined entry `/_/extensions.js` (the extension's `main.js`) with `Cache-Control: no-cache`, so browsers fetch it on every load, and the entry imports the page (`odyle.js`, `odyle.css`) under the `version` hash, so a deploy reaches open dashboards on their next reload. Browsers that loaded the entry before it was sent with `no-cache` would keep it for up to 14 days, so the dashboard page `/_/` answers each browser once with `Clear-Site-Data: "cache"` and marks it with the cookie `odyle_entry=1` (path `/_/`); the browser then fetches the current entry. Browsers honour that header only over HTTPS or on localhost.

## Realtime

Subscribe through the PocketBase SDK (`backend/odyle/realtime.go`):

| Topic | Who may subscribe | Messages |
| --- | --- | --- |
| `odyle.room.<roomId>` | members | `{ refresh: true }` after a room, membership, role, sharing, wishlist, run, Discord reminder or display-name change: fetch the snapshot again. `{ refresh: true, characters: [...] }` when only characters changed (a reading, a stale mark, a new portrait, a new character), in their snapshot form with `shared`, and only the ones that member may see: apply them, and fetch the snapshot only for a character not listed yet. `{ refresh: true, removed: true }` to a member who left or was removed; its clients are then unsubscribed from the room and hear nothing more. |
| `odyle.presence.<roomId>` | members | `{ seen: { <characterId>: <lastSeenAt> } }` as the room's readers send heartbeats, for the characters that member may see, at most every two seconds |
| `odyle.user.<accountId>` | that account | `{ refresh: true }` when its characters were added or deleted, its memberships, rooms, tasks, paired PCs, reader sessions or profile changed; `{ characters: [...] }` when only its characters changed; `{ seen: {...}, contact: { <readerSessionId>: <time> } }` for its readers' heartbeats |
| `odyle.admin.packets` | superusers | see [Superuser monitor and settings](#superuser-monitor-and-settings) |

News is collected and delivered together a moment later (150 ms, heartbeats every two seconds), so a burst of changes is one message per client; each delivery reads the room's members once, for who hears it and which characters each may see. Every room message carries `refresh: true`, so a client that only fetches the snapshot again keeps working. Fetch again on reconnect, as messages may have been missed meanwhile. User and provider tokens are never broadcast. The dashboard fetches its page again only on such news, on reconnect and every five minutes (every 15 seconds while realtime is down).
