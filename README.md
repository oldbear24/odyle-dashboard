# Odyle Party Dashboard

A polished AION 2 party dashboard with **Discord sign-in**, persistent character readings, private rooms and PocketBase. Vanilla JavaScript + Vite; no React or separate ASP.NET service. The desktop companion lives in [odyle-windows](https://github.com/oldbear24/odyle-windows).

![Dashboard demo](docs/dashboard-preview.png)

## Account and room flow

1. Sign in with Discord. First sign-in creates your account.
2. Save your characters with their own region, server and confirmed Odyle total.
3. Create a private room, or join one using an invitation from its owner.
4. Choose whether to share your saved characters in each room. Other members see the last saved value and timestamp of every shared character.
5. Pair your own Windows app using a one-time code from your dashboard account.

Accounts, rooms, memberships and character values persist across sign-outs and server restarts. Leaving or closing a room **does not delete character history**. Stale values remain saved and visible; only fresh readings count toward readiness. Confirmed zero stays zero.

Room invite codes expire after 30 minutes. Membership remains until the user leaves or the room owner removes them. Desktop pairing codes expire after five minutes and can be used once. Viewer invitations give read-only room access; viewers cannot share characters in that room or manage it.

**Manual confirmation is available. Automatic game reading is unavailable pending Global protocol validation.** No game account, game memory, raw packets or gameplay automation is involved.

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

Integration tests use synthetic accounts in a temporary PocketBase instance on port 18090. They verify provider configuration, closed password registration, multiple saved characters, account isolation, one-use pairing, realtime access, sequence rejection, and persistence across a real backend restart. Test-only auth hooks are generated in the temporary directory and are **not included in production**. Live Discord login requires your own provider credentials.

GitHub Actions runs the checks and uploads the static build. [Deployment](docs/deployment.md), [API contract](docs/api.md), [privacy](docs/privacy.md).

The account migration locks the previous MVP's guest collections. New accounts use `users`, `party_rooms`, `room_members`, `characters`, `publisher_sessions`, `room_invites` and `desktop_codes`. Old guest tokens cannot use the new API. Guest data is preserved as locked records during migration rather than silently erased.

Fonts use Google Fonts with system fallbacks; there is no analytics. Remove the CSS font import or self-host fonts for a fully self-contained UI.
