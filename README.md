# Odyle Party Dashboard

A polished AION 2 party dashboard with **Discord sign-in**, persistent character readings, private rooms and PocketBase. Vanilla JavaScript + Vite; no React or separate ASP.NET service. The desktop companion lives in [odyle-windows](https://github.com/oldbear24/odyle-windows).

![Dashboard demo](docs/dashboard-preview.png)

## Account and room flow

1. Sign in with Discord. First sign-in creates your account. The browser stays signed in (all tabs, across restarts) until you choose **Sign out of this browser** or skip the dashboard for seven days.
2. Download the Windows packet reader: **My rooms & characters** links the newest [GitHub release](https://github.com/oldbear24/odyle-windows/releases/latest) as **Windows app &lt;version&gt;** and the **Pair Windows app** dialog offers both packages (the backend reads the release list from GitHub every ten minutes; see [API contract](docs/api.md#windows-app-release)). Once installed, the app updates itself from new releases. Pair it, ideally before logging the character into the game; started later it reads the value at the next Odyle change and needs one relog so the game names the character. It can detect and save the character name, server and region automatically. **+ Add → Save character** is the manual identity fallback. Saving a character never requires entering Odyle; its value stays unknown until a verified game reading arrives.
3. Create a private room, or join one using an invitation from its owner: open the **invite link** they send (`#/join/<code>`, you join right after signing in) or enter the code under **Join your friends**.
4. Choose which of your characters each room sees under **My rooms & characters → Room sharing** (one switch per character and room), or inside a room: add characters from the **Not in this room** bar above the party and take one out with **Remove from room** on its card. A room lists only the characters added to it, your own included. Other members see the last saved value and timestamp of every shared character, and the Windows app lists the ones that are online. Room and sharing settings live on the dashboard; the Windows app only pairs, reads and displays.
5. Pair your own Windows app using a one-time link from your dashboard account. The pairing lasts: the app stays connected across restarts and weeks switched off until you disconnect it or sign out everywhere.

The room owner manages the room under **Room settings**: rename it, make members players or viewers, hand the room over (**Make leader**; the previous owner stays as a player), remove members, invite and close it. Closing or leaving a room, removing a member, handing a room over and deleting anything ask for confirmation first.

Each room has a **Dungeon wishlist** under the party: members add the dungeons they still need to run, join an entry with **Need it too** and take themselves off with **Remove me**. The most wanted dungeons come first, and a dot marks members with a live character in the room, so the party sees what it could run now. The room owner can **Clear** an entry for everyone after a run. Viewers can read the list but not add to it. See [API contract](docs/api.md#dungeon-wishlist).

**Planned runs** sit below the wishlist: players pick a dungeon (or **Plan** one from the wishlist), a start time in their local time and an optional note; the party joins with **Going**. Runs are listed soonest first with a countdown until three hours after they started and are deleted a day later; the planner or the room owner can cancel one. See [API contract](docs/api.md#planned-runs).

Every character card has a **History** button: a chart and list of every Odyle change in the last 30 days, readable by the owner and by the rooms the character is shared in. See [API contract](docs/api.md#odyle-history).

**Account & data** (sidebar, or the avatar menu on phones) changes the display name rooms see, switches the dashboard between **English and Czech** (detected from the browser, remembered per browser), lists the Windows apps reading for the account, signs out everywhere (every other browser and paired app loses its token), downloads everything stored for the account as JSON and deletes the account. A deleted account's rooms pass to their longest-standing player, or close when there is none. Saved characters can be deleted under **My rooms & characters**. Each account keeps up to 30 characters, owns up to 20 rooms and is a member of up to 50. See [API contract](docs/api.md#account-and-data).

**Daily & weekly** in the sidebar is each account's own checklist: add the tasks you run every day or week, tick them off and remove the ones that no longer apply. Ticked tasks uncheck themselves at the game's reset instead of being deleted: the Global service resets daily at **07:00 UTC** and weekly on **Wednesday** at the same hour, and the page shows both in your local time with a countdown. Superusers can move both on the PocketBase dashboard's **Odyle → Game settings** page (or under *Collections → odyle_settings*: `dailyResetHour`, `weeklyResetDay`). Tasks are private to the account and are not shown in rooms; the Windows app can show your own checklist beside its card and tick tasks off from there. See [API contract](docs/api.md#daily-and-weekly-tasks).

Every character card shows the character's **official AION 2 portrait**, which the backend loads from PLAYNC's public character search within a minute of the character being saved and refreshes daily. Pictures always come from the game; players cannot upload or change them. Characters the official search does not list keep their initials. See [API contract](docs/api.md#character-pictures).

Accounts, rooms, memberships and character values persist across sign-outs and server restarts. Leaving or closing a room **does not delete character history**. Stale values remain saved and visible; only fresh readings count toward readiness. Confirmed zero stays zero.

Odyle per cube is one server-wide value (default **40**). Superusers change it on the PocketBase dashboard's **Odyle → Game settings** page (or under *Collections → odyle_settings*: `odylePerCube`); every room's `cost` in the API reports it, so the Windows app follows it too. A room shows each player's best fresh character and its cube count is the **lowest** of those players.

Every dashboard page has its own URL (`#/`, `#/room/<id>`, `#/tasks`, `#/account`, `#/demo`, and invite links `#/join/<code>`), so reloads and links keep the page, and a fresh visit resumes the last page this browser had open. An open dashboard renews its sign-in every six hours and returns to the welcome page once the server no longer accepts it.

Room invite codes expire after 30 minutes; the owner's browser remembers the codes it created until then, so the invite dialog shows them again after a reload. Membership remains until the user leaves or the room owner removes them. Desktop pairing codes expire after five minutes and can be used once. Viewer invitations give read-only room access; viewers cannot share characters in that room or manage it.

**Manual Odyle entry is disabled; values come from the Windows packet reader.** The app decodes the Odyle snapshot and live updates from the game's own packets and publishes them under the adapter name `global-reference-v1`, which `backend/pb_hooks/lib/protocols.cjs` lists as accepted. The app sends Odyle when it first reads a character and then only when it changes; the reading stays live while the app's heartbeat reports the game connection and turns stale 45 seconds after that stops. The last value is always kept. Each character is shared per room. **When you deploy, also copy `backend/pb_migrations`**: `1791763204_character_sharing.js` moves room sharing to individual characters, `1791763205_odyle_settings.js` adds the Odyle-per-run setting, `1791763206_character_portraits.js` adds character pictures, `1791763207_room_wishlist.js` adds the room dungeon wishlist, `1791763208_users_avatar.js` removes the unused account avatar upload, `1791763209_user_tasks.js` adds the daily and weekly checklists with the reset-time settings `1791763210_rate_limits.js` relaxes the room creation, join and application-route limits, `1791763211_legacy_rooms.js` drops the unused `rooms`, `members` and `invites` collections left from the first, account-less release, `1791763212_indexes.js` adds indexes for the hot lookups, `1791763213_account_lifecycle.js` adds the accounts' last activity and the inactive-account setting, `1791763214_odyle_history.js` adds Odyle history, `1791763215_room_runs.js` adds planned runs `1791763216_dungeon_catalog.js` adds the dungeon catalog setting and `1791763217_desktop_devices.js` adds lasting Windows app pairings (the backend needs outbound HTTPS to PLAYNC for official portraits; see [deployment](docs/deployment.md)). Raw game traffic is never uploaded to PocketBase. **When you deploy, copy the current `backend/pb_hooks` to the server as well**: a backend with an empty registry rejects every reading and the app shows *Not saved*. See [packet reader details](https://github.com/oldbear24/odyle-windows/blob/main/docs/packet-reader.md).

## Odyle page in the PocketBase dashboard

The backend adds an **Odyle** page to the PocketBase superuser dashboard (`/_/#/odyle`), a PocketBase UI extension in `backend/pb_hooks/admin`:

- **Apps & packets** lists every connected Windows app (one reader session each) with its account, online/late/offline status, the character it reads and its last Odyle value, and shows the requests the apps send as they arrive: reader sessions, readings, 20-second heartbeats, stale marks and character saves, rejected ones with the reason. Pause the list to read it; heartbeats can be hidden. The newest 200 packets are kept in server memory only and never in the database.
- **Game settings** edits the server-wide `odyle_settings`: Odyle per cube and the daily and weekly reset, validated and applied to every room, checklist and the Windows app; the **dungeon catalog** (one name per line; while it lists dungeons, new wishlist entries and planned runs must be one of them and take its spelling; empty allows any name) and **Delete inactive accounts after (days)** (0, the default, keeps every account; 30 or more deletes accounts that have not used the dashboard or the Windows app for that long every night, passing their rooms on as above).

Only superusers can open the page; its data routes and live feed refuse every other account. It needs PocketBase 0.37 or newer (the extension API is still marked experimental); it ships with `backend/pb_hooks`. See [API contract](docs/api.md#superuser-monitor-and-settings).

## Run locally

Node.js 22 and Git:

```powershell
npm ci
npm run backend:install
npm run backend
```

In another terminal:

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`. **Configure Discord before real sign-in:** follow [Discord setup](docs/discord-setup.md). The callback is `http://127.0.0.1:8090/api/oauth2-redirect`. Put provider credentials in ignored `.env.backend`, never in frontend `VITE_*` variables. No Discord bot is needed.

The installer verifies PocketBase **0.40.5** against its official release checksum. Migrations run on startup. Data is stored in ignored `backend/pb_data/`; keep this directory or your Docker data volume to retain accounts and readings.

To serve UI and API together:

```powershell
npm run build
npm run backend
```

Open `http://127.0.0.1:8090`. For another frontend host, set `VITE_POCKETBASE_URL` in `.env` before building. The backend must allow that exact frontend origin and use HTTPS in production.

## Checks and deployment

```powershell
npm run lint
npm test
npm run test:integration
npm run build
npm run test:ui
```

`npm run lint` runs ESLint over the dashboard, tests, hooks and migrations. `npm run test:ui` drives the built dashboard in Chromium through Playwright against a temporary PocketBase on port 18091 (demo, invite links, room settings, runs, history, the account page in English and Czech, an expired sign-in and the superuser settings page); run `npx playwright install chromium` once, set `ODYLE_UI_SHOTS` to a directory to keep screenshots and `ODYLE_UI_WIDTH=390` to check a phone width. Integration tests use synthetic accounts in a temporary PocketBase instance on port 18090. They verify provider configuration, closed password registration, character creation before a reading, duplicate avoidance, multiple saved characters, account isolation, one-use pairing with lasting device keys, realtime access, sequence rejection, and persistence across a real backend restart. Set `ODYLE_WINDOWS_CHECKS` and `ODYLE_WINDOWS_UI_CHECKS` to the Windows repository's corresponding test project paths to exercise both the compiled API client and the actual native Add/Save/Cancel flow. A synthetic packet adapter is approved only in the disposable test backend; these tests do not validate the Global protocol. Test-only auth hooks are generated in the temporary directory and are **not included in production**. Live Discord login requires your own provider credentials.

GitHub Actions runs the checks on every push; pushes to `main` also publish a Linux container image and a release with the PocketBase bundle. The **Windows companion checks** workflow runs the Windows app's API and UI checks from [odyle-windows](https://github.com/oldbear24/odyle-windows) against this backend weekly, on demand and when `backend/` changes on `main`. [Deployment](docs/deployment.md), [API contract](docs/api.md), [privacy](docs/privacy.md).

The account migration locks the previous MVP's guest collections. New accounts use `users`, `party_rooms`, `room_members`, `characters`, `character_readings`, `publisher_sessions`, `room_invites`, `room_wishes`, `room_runs`, `user_tasks` and `desktop_codes`. Old guest tokens cannot use the new API. Guest data is preserved as locked records during migration rather than silently erased.

Fonts use Google Fonts with system fallbacks; there is no analytics. Remove the CSS font import or self-host fonts for a fully self-contained UI.
