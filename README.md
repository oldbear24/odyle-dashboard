# Odyle Party Dashboard

A polished AION 2 party dashboard with **Discord sign-in**, persistent character readings, private rooms and PocketBase. Vanilla JavaScript + Vite; no React or separate ASP.NET service. The desktop companion lives in [odyle-windows](https://github.com/oldbear24/odyle-windows).

![Dashboard demo](docs/dashboard-preview.png)

## Account and room flow

1. Sign in with Discord. First sign-in creates your account. The browser stays signed in (all tabs, across restarts) until you choose **Sign out of this browser** or skip the dashboard for seven days.
2. Pair the Windows packet reader, ideally before logging the character into the game; started later it reads the value at the next Odyle change and needs one relog so the game names the character. It can detect and save the character name, server and region automatically. **+ Add → Save character** is the manual identity fallback. Saving a character never requires entering Odyle; its value stays unknown until a verified game reading arrives.
3. Create a private room, or join one using an invitation from its owner.
4. Choose which of your characters each room sees under **My rooms & characters → Room sharing** (one switch per character and room), or inside a room: add characters from the **Not in this room** bar above the party and take one out with **Remove from room** on its card. A room lists only the characters added to it, your own included. Other members see the last saved value and timestamp of every shared character, and the Windows app lists the ones that are online. Room and sharing settings live on the dashboard; the Windows app only pairs, reads and displays.
5. Pair your own Windows app using a one-time code from your dashboard account.

Each room has a **Dungeon wishlist** under the party: members add the dungeons they still need to run, join an entry with **Need it too** and take themselves off with **Remove me**. The most wanted dungeons come first, and a dot marks members with a live character in the room, so the party sees what it could run now. The room owner can **Clear** an entry for everyone after a run. Viewers can read the list but not add to it. See [API contract](docs/api.md#dungeon-wishlist).

Every character card shows the character's **official AION 2 portrait**, which the backend loads from PLAYNC's public character search within a minute of the character being saved and refreshes daily. Pictures always come from the game; players cannot upload or change them. Characters the official search does not list keep their initials. See [API contract](docs/api.md#character-pictures).

Accounts, rooms, memberships and character values persist across sign-outs and server restarts. Leaving or closing a room **does not delete character history**. Stale values remain saved and visible; only fresh readings count toward readiness. Confirmed zero stays zero.

Odyle per cube is one server-wide value (default **40**). Superusers change it in the PocketBase dashboard under *Collections → odyle_settings* (`odylePerCube`); every room's `cost` in the API reports it, so the Windows app follows it too. A room shows each player's best fresh character and its cube count is the **lowest** of those players.

Every dashboard page has its own URL (`#/`, `#/room/<id>`, `#/demo`), so reloads and links keep the page, and a fresh visit resumes the last page this browser had open.

Room invite codes expire after 30 minutes. Membership remains until the user leaves or the room owner removes them. Desktop pairing codes expire after five minutes and can be used once. Viewer invitations give read-only room access; viewers cannot share characters in that room or manage it.

**Manual Odyle entry is disabled; values come from the Windows packet reader.** The app decodes the Odyle snapshot and live updates from the game's own packets and publishes them under the adapter name `global-reference-v1`, which `backend/pb_hooks/lib/protocols.cjs` lists as accepted. The app sends Odyle when it first reads a character and then only when it changes; the reading stays live while the app's heartbeat reports the game connection and turns stale 45 seconds after that stops. The last value is always kept. Each character is shared per room. **When you deploy, also copy `backend/pb_migrations`**: `1791763204_character_sharing.js` moves room sharing to individual characters, `1791763205_odyle_settings.js` adds the Odyle-per-run setting, `1791763206_character_portraits.js` adds character pictures and `1791763207_room_wishlist.js` adds the room dungeon wishlist (the backend needs outbound HTTPS to PLAYNC for official portraits; see [deployment](docs/deployment.md)). Raw game traffic is never uploaded to PocketBase. **When you deploy, copy the current `backend/pb_hooks` to the server as well**: a backend with an empty registry rejects every reading and the app shows *Not saved*. See [packet reader details](https://github.com/oldbear24/odyle-windows/blob/main/docs/packet-reader.md).

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
npm test
npm run test:integration
npm run build
```

Integration tests use synthetic accounts in a temporary PocketBase instance on port 18090. They verify provider configuration, closed password registration, character creation before a reading, duplicate avoidance, multiple saved characters, account isolation, one-use pairing, realtime access, sequence rejection, and persistence across a real backend restart. Set `ODYLE_WINDOWS_CHECKS` and `ODYLE_WINDOWS_UI_CHECKS` to the Windows repository's corresponding test project paths to exercise both the compiled API client and the actual native Add/Save/Cancel flow. A synthetic packet adapter is approved only in the disposable test backend; these tests do not validate the Global protocol. Test-only auth hooks are generated in the temporary directory and are **not included in production**. Live Discord login requires your own provider credentials.

GitHub Actions runs the checks on every push; pushes to `main` also publish a Linux container image and a release with the PocketBase bundle. [Deployment](docs/deployment.md), [API contract](docs/api.md), [privacy](docs/privacy.md).

The account migration locks the previous MVP's guest collections. New accounts use `users`, `party_rooms`, `room_members`, `characters`, `publisher_sessions`, `room_invites` and `desktop_codes`. Old guest tokens cannot use the new API. Guest data is preserved as locked records during migration rather than silently erased.

Fonts use Google Fonts with system fallbacks; there is no analytics. Remove the CSS font import or self-host fonts for a fully self-contained UI.
