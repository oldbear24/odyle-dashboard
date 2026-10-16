# Deployment

The simplest deployment serves both UI and API from one backend instance: PocketBase with Odyle built in, one Go program. Keep one instance per SQLite data volume.

## Docker

```sh
docker compose up --build -d
```

Open `http://127.0.0.1:8090` for a local installation. The image builds the backend from source with Go, with the dashboard built in, and runs it on distroless (`gcr.io/distroless/static-debian13`: the server, CA certificates and time zones, no shell or package manager) as the non-root user 10001, the user of the earlier Alpine image, so existing data volumes keep working. It stores the database in a named volume and reports its health with `odyle healthcheck`, which asks the running server for `/api/health` (`docker compose ps` shows `healthy`). Run server commands through the binary, for example `docker compose exec odyle /pb/odyle superuser upsert you@example.com <password>`. When the Compose command moves the server to another port, point the check there too:

```yaml
healthcheck:
  test: ["CMD", "/pb/odyle", "healthcheck", "--url=http://127.0.0.1:9000/api/health"]
```

For internet access, put an HTTPS reverse proxy in front of port 8090 and change the Compose command to:

```yaml
command: ["--origins=https://odyle.example.com"]
```

Replace the example with your actual origin. Keep the port bound to loopback when the proxy runs on the host. Forward HTTP/1.1 connections and disable response buffering for `/api/realtime` so SSE arrives immediately: open dashboards follow rooms, readings and heartbeats over it and otherwise fall back to fetching every 15 seconds. The [reverse proxy](#reverse-proxy) section has sample Caddy and nginx configurations. Odyle checks room membership on subscription and with every delivery, and unsubscribes a member who left or was removed; PocketBase checks collection permissions on its own topics.

If you use a separate static host, provide `VITE_POCKETBASE_URL` as a Docker build argument or Vite build environment variable, and allow that exact frontend origin. Static hosting alone cannot run the backend.

## Reverse proxy

Rate limits count requests per client address: 600 Odyle requests and 10 sign-ins a minute each. Behind a reverse proxy every request arrives from the proxy, so unless the backend knows the client's address, all players share one budget: from about 180 running Windows apps everyone gets *Too Many Requests*, and only 10 people a minute can sign in. Name the one header in which your proxy writes the client's address in `.env.backend`:

```sh
ODYLE_TRUSTED_PROXY_HEADERS=X-Real-IP
```

The backend writes it into **Settings → Application → Trusted proxy** at every start. When the header holds a list, the rightmost address is used (the one your proxy added); `ODYLE_TRUSTED_PROXY_IP=leftmost` takes the first instead, only for a chain of proxies that all replace the header. Trust only a header that your proxy *replaces* with the address it sees: a header a client can send itself lets that client pick its address and slip past the limits. A list of headers is refused, because a request is counted under the first trusted header it carries; pair each sample proxy below with exactly the header it replaces. Never set it while clients can reach port 8090 directly. Without the variable the setting stays as saved under Settings; set to an empty value, it trusts no header. A wrong value is logged and shown on **Server status**, which also warns when most of the last hour's requests came from private or loopback addresses: then no header is trusted, or the proxy does not set the trusted one.

Caddy replaces `X-Forwarded-For` with the address it sees (unless you list `trusted_proxies`) and passes SSE through without buffering:

```caddyfile
odyle.example.com {
	reverse_proxy 127.0.0.1:8090
}
```

Use it with `ODYLE_TRUSTED_PROXY_HEADERS=X-Forwarded-For`.

nginx sets `X-Real-IP` to the address it sees; the realtime location turns buffering off and waits longer than PocketBase's five-minute idle timeout:

```nginx
server {
    listen 443 ssl;
    server_name odyle.example.com;
    # ssl_certificate and ssl_certificate_key as usual

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/realtime {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 360s;
    }

    # Uploading a backup under Settings → Backups needs more than nginx's 1 MB default.
    location /api/backups/upload {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 1g;
    }
}
```

Use it with `ODYLE_TRUSTED_PROXY_HEADERS=X-Real-IP`. Behind a CDN, the proxy sees the CDN's addresses: trust the CDN's client header only when the server accepts connections from the CDN alone.

## Releases

Every push to `main` runs the checks, then publishes:

- the image `ghcr.io/oldbear24/odyle-dashboard` for `linux/amd64` and `linux/arm64`, tagged `latest`, its semantic version (for example `0.6.0`; releases before 0.6.0 were `<version>.<run number>`, up to `0.5.0.24`) and `sha-<commit>`. It is built without `VITE_POCKETBASE_URL`, so the UI talks to the instance that serves it;
- the GitHub release `v<version>` with `odyle-dashboard-<version>-<os>-<arch>.zip` for `linux-amd64`, `linux-arm64` and `windows-amd64` and their checksums. Each ZIP holds the server `odyle` (`odyle.exe` on Windows) with the dashboard and the migrations built in; run `odyle serve --http=127.0.0.1:8090`. Data is kept in `pb_data` next to it unless `--dir` says otherwise. The built-in dashboard answers with an ETag per file: the page, `sw.js`, the manifest and the icons are revalidated on each load, and the content-hashed files under `assets/` are cached for a year, so a new release reaches browsers at once. `--publicDir=<folder>` serves a dashboard folder instead, for example one built with `VITE_POCKETBASE_URL`. Releases before the built-in dashboard shipped it in `pb_public`; an upgraded installation can delete that folder.

The version comes from `package.json`; bump it to start a new line. Release archives and the image carry it in the server (with the image's commit), and the **Server status** page shows it. To run the published image instead of building locally, replace `build: .` in `compose.yaml` with:

```yaml
image: ghcr.io/oldbear24/odyle-dashboard:latest
```

A new Windows release reaches players without a restart: the **Release check** job asks GitHub every two minutes, and a newer release is news for every open dashboard (its download links and a short note) and every running Windows app (it checks for the update at once, still verified against GitHub and the release's checksum). Right after publishing, **Background jobs → Release check → Run now** tells them immediately. A changed announcement under **Server controls** reaches them the same way, within seconds.

## Operations

- Bootstrap the first PocketBase operator account locally. Restrict the management path `/_/` at your proxy to operator access.
- Application clients use the Discord-enabled `users` auth collection, never superusers. Configure the provider using [Discord setup](discord-setup.md).
- The PocketBase dashboard's **Odyle** page (`/_/#/odyle`) shows the connected Windows apps and their live requests and edits the game settings. It is the UI extension in `backend/admin`, built into the backend. If a CDN caches `/_/`, bypass its cache for `/_/` itself (its first answer to each browser carries a one-time `Clear-Site-Data` header and cookie), `/_/extensions.js` and `/_/extensions/*`, or purge them after a deploy.
- Back up before upgrading (**Settings → Backups → Backup now**; see [Backups and restore](#backups-and-restore)). PocketBase is pinned in `backend/go.mod` and upgraded like any Go module, its JavaScript SDK in `package.json`; keep both together and run the integration checks on upgrades.
- Character pictures need outbound HTTPS from the backend to `api-search.plaync.com`, `profileimg.plaync.com` and `fizz-download.playnccdn.com` (the portrait host redirects there; redirects are followed only to `*.plaync.com` and `*.playnccdn.com`, and an image larger than 512 KB is refused). Without it characters keep their initials. `PLAYNC_SEARCH_URL` and `PLAYNC_IMAGE_URL` override both hosts for tests.
- The Windows app download link needs outbound HTTPS from the backend to `api.github.com` (one request as it starts and then every ten minutes at most, cached in memory, conditional on the known release so an unchanged one does not count against GitHub's rate limit; redirects only within `api.github.com`). Without it the dashboard links GitHub's latest-release page without a version. `ODYLE_WINDOWS_REPOSITORY` points at a fork of the Windows app; `ODYLE_WINDOWS_RELEASE_URL` replaces the feed URL for tests.
- Discord reminders of planned runs need outbound HTTPS from the backend to `discord.com` (a test post when a room owner connects a webhook, then one post per run; the `odyle-reminders` job runs every minute and holds back a webhook while Discord asks it to wait). Without it rooms simply have no Discord reminders. `ODYLE_DISCORD_WEBHOOK_BASE` replaces `https://discord.com` for tests.
- Web Push (run reminders and cap alerts on phones and computers with the dashboard closed) needs outbound HTTPS from the backend to the browsers' push services: `fcm.googleapis.com` (Chrome, Edge and Android browsers), `*.notify.windows.com` (Edge on Windows), `*.push.services.mozilla.com` (Firefox) and `*.push.apple.com` (Safari); no other endpoint is ever accepted. The backend signs its messages with a VAPID key: `ODYLE_VAPID_PRIVATE_KEY` (a P-256 private key, base64url) when set, else one it creates once as `odyle_vapid.key` in the data directory, so backups keep it. A new key means every device has to turn push on again, so keep it across deploys. On iPhone and iPad, push works once the dashboard is added to the Home Screen.
- The dashboard registers a service worker (`sw.js` next to `index.html`) that keeps the page and its built files for visits without a connection; it never caches `/api/` or `/_/`. Serve `sw.js` without a long cache lifetime at your CDN or proxy, so a deploy reaches browsers on their next visit.
- Dashboard pages and files are served with `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (`backend/odyle/register.go`). `/api/` and `/_/` are excluded because the OAuth redirect page and the PocketBase UI use inline scripts. Add HSTS at your HTTPS proxy.
- PocketBase sends email only once **Settings → Mail settings** names an SMTP server and a sender. Accounts then get an alert when they sign in from a new device (switch it off with **Send email alert for new logins** under the `users` collection's **Options**), and superusers get password resets and, with MFA or one-time passwords on, sign-in codes. The emails come in the dashboard's look (**Send test email** beside the collection's **Options → Mail templates** sends one); their buttons and links start with **Settings → Application → Application URL**, so set it to the public origin (`https://odyle.example.com`): the alert's **Open Account & data** opens `<Application URL>/#/account`, the dashboard this backend serves.
- Request/IP logs are disabled by the migration. Configure proxy logs consistently with your privacy preference.
- **Server status** offers Go profiles of the running server (CPU, heap, allocations, goroutines) as files for `go tool pprof`; from a shell: `curl -H "Authorization: <superuser token>" https://odyle.example.com/api/odyle/admin/pprof/heap -o heap.pb.gz`, then `go tool pprof -http=: heap.pb.gz`. A CPU profile takes the seconds it is asked for (`profile?seconds=30`).
- The backend writes its own log lines (failed jobs; failed PLAYNC, Discord and GitHub lookups; deleted inactive accounts) to the standard error as text with their fields (`job`, `character`, `room`, `error`, …), so `docker compose logs` shows them. Failed outbound calls name the method and host, never the address, so webhook tokens and character names stay out of logs and the Background jobs page; answers are read up to a size limit per call. When **Settings → Logs** keeps logs (the migration turns that off, request logs included), PocketBase also stores them and lists them under **Logs** with the same fields.
- Rate limits are enabled for room creation and invite joins (30 a minute each), application routes under `/api/odyle/` (600 a minute), pairing and sign-in (10 a minute), Windows app device sign-in and unpairing (30 a minute) and the public invite preview (30 a minute); all per client address. Behind a reverse proxy, trust the header it writes the client's address into, and only that one (see [Reverse proxy](#reverse-proxy)).
- Accounts are capped at 30 characters, 20 owned rooms, 50 memberships, 40 tasks and 10 paired Windows PCs. Unused accounts are kept unless you set **Delete inactive accounts after (days)** on the Odyle page (30 days or more; a nightly job at 03:17 UTC deletes up to 200 accounts per run and passes their rooms on). Before you save a period, the page shows how many accounts the next run would delete with it. Deleting an account in the PocketBase dashboard passes its rooms on the same way.
- The server-wide settings (`odyle_settings`) are kept in memory and read again after every change made through PocketBase: the **Odyle** pages, **Collections → odyle_settings** or the API. A change written straight into the SQLite file applies after a restart.
- **Server status** shows activation and feature use: how many accounts paired a PC, got a first reading and share a character in a room, rooms reading together, and the rooms and accounts using runs, wishlists, tasks and Discord reminders, with the Windows app versions of the last 24 hours. They are totals computed from the database, never per account. The `odyle-stats` job stores one row of them every night at 23:55 UTC in `odyle_stats` (superusers only), and the page lists the last 30 days.
- **Know when the decoder breaks.** Windows apps send what their reader is doing and the game build they read with each heartbeat; **Server status → Readers** sums it up and warns when apps connected to the game have read no Odyle for 10 minutes, which after the game's Wednesday maintenance usually means a patch changed the packets, or when readings arrive under an adapter this backend refuses (a Windows release that shipped before its backend). The **Odyle clock** tile counts how many login readings matched the clock's projection; when most of a day's miss, a patch probably moved the regeneration: fix the rules under **Game settings → Odyle clock**, or tick **Hide the Odyle clock** until you know them. Set `ODYLE_ALERT_WEBHOOK` in `.env.backend` to a private Discord channel's webhook to be told without watching the page: the **Reader health** job (every 5 minutes) posts once when such a problem starts and once when it clears. Then follow the patch-day runbook in the Windows app's [packet reader docs](https://github.com/oldbear24/odyle-windows/blob/main/docs/packet-reader.md#when-a-game-patch-breaks-reading).
- Odyle history keeps 30 days of changes per character and finished planned runs are deleted a day after their start, both by the five-minute expiry job.
- Rooms and account-owned character values persist in the data volume. Freshness uses server timestamps; client clocks affect only display, corrected using heartbeat responses. Heartbeats are written every ten seconds and when the backend stops; a crash loses at most those ten seconds of presence, which the next heartbeats restore.
- Invite links last 30 minutes, 24 hours (the default) or 7 days and can be limited to a number of joins; a room has up to 20 open links. Revoke a link to stop new joins with it; remove a member to revoke existing access. Rooms allow up to 50 members, including viewers. The expiry job deletes a link three days after it expired, so an old link still names its room until then.
- Invite links shared in Discord and chat apps unfurl with the page's Open Graph title, text and icon. Set **Settings → Application → Application URL** in the PocketBase dashboard to the dashboard's public address (for example `https://odyle.example.com`): the page then names its icon by an absolute address, which link previews need. While it is PocketBase's default (`http://localhost:8090`) the icon stays relative to the page.
- Browser sign-ins are stored in localStorage, shared by all tabs and kept across browser restarts until sign-out. Account tokens last seven days and are renewed each time the dashboard opens. Sign in again with the same Discord account to recover owned rooms and characters. There is no automatic inactivity deletion of rooms.

## Dungeon catalog

A deploy leaves the catalog as it is, and a new server starts with none, so wishlists and runs take any name until a superuser fills it under **Game settings → Dungeon catalog**. Each dungeon has its own Odyle per cube (empty uses the server-wide Odyle per cube), party size, category and an **Unconfirmed** mark that rooms show next to the cost. A catalog of names from before these entries keeps its names, each at Odyle per cube with nothing else set.

Odyle ships no costs: NCSOFT publishes no table of cube costs for Global and the guides disagree. The list below is a starting point taken from public guides (MetaBot's Global dungeon list and daily and weekly checklist, and the 1 July 2026 patch notes on aion2hub, which may describe the Korean service), so every line is marked unconfirmed. Check the costs in game, paste the lines into **Add several from a list**, adjust the table and untick **Unconfirmed** for each cost you checked:

```text
Krao Cave | 20 | 5 | Exploration | unconfirmed
Urugugu Canyon | 20 | 5 | Exploration | unconfirmed
Draupnir | 40 | 5 | Conquest | unconfirmed
Ferocious Horn Den | 40 | 5 | Conquest | unconfirmed
Abyssal Forge: Ludra | 80 | 10 | Sanctuary | unconfirmed
Corroded Decontamination Facility | 80 | 10 | Sanctuary | unconfirmed
Chalice of Muspel | 80 | 10 | Sanctuary | unconfirmed
```

Each line is name | Odyle per cube | party size | category | unconfirmed; only the name is needed, and a dungeon already in the table takes the values of its line. A mode that costs more (the Korean notes give 60 for Hard) is a dungeon of its own, for example `Draupnir (Hard)`. The membership double-open (twice the cost for twice the loot) is not counted anywhere. Rename dungeons with care: wishlist entries and runs keep the old name and lose its cost.

## Backups and restore

The migration `1791763227_backups.go` turns on PocketBase's scheduled backups: every night at 03:00 UTC, before the inactive-account clean-up at 03:17, keeping the newest seven. A schedule already set under **Settings → Backups** stays as it is; change the time or the number kept there. A backup is a ZIP of the whole `pb_data`: the database (accounts with their Discord sign-ins and emails, rooms, characters, history, settings and their secrets), PocketBase's log database and the portrait files. It is made from a live copy of the database, so the server keeps running. **Settings → Backups** lists the backups and makes, downloads, uploads, deletes and restores them. **Odyle → Server status** shows the newest backup with its size, the schedule and how many backups it keeps, how many are stored and where, and warns when none is from the last 48 hours.

### Off the host

Backups land in `pb_data/backups`, on the same volume as the data, so losing the disk loses them too. To keep them elsewhere, create a private bucket at an S3-compatible provider and a key that can only read and write that bucket, and set all five variables in `.env.backend`:

```sh
ODYLE_BACKUP_S3_BUCKET=odyle-backups
ODYLE_BACKUP_S3_REGION=eu-central-1
ODYLE_BACKUP_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
ODYLE_BACKUP_S3_ACCESS_KEY=your-access-key
ODYLE_BACKUP_S3_SECRET=your-secret-key
# For MinIO and other hosts that need path-style URLs:
# ODYLE_BACKUP_S3_FORCE_PATH_STYLE=true
```

The backend writes them into **Settings → Backups → Store backups in S3 storage** at every start, so every later backup, scheduled or by hand, goes to the bucket, and the bucket's backups are the ones listed and kept seven times; backups made before stay in `pb_data/backups`. The secret is stored like one typed into that form (start the server with `--encryptionEnv` to encrypt the settings in the database). An incomplete set, or one PocketBase refuses, is logged and shown on **Server status**, and backups stay where they were. Removing the variables leaves the S3 settings in place; switch S3 off under **Settings → Backups**. Backups hold personal data: keep the bucket private. Deleted accounts stay in the backups until those rotate out, seven nights by default (see [privacy](privacy.md)).

### Restore in the superuser dashboard

On the Docker image or a Linux server: open **Settings → Backups**, first make a backup of the current state with **Backup now** so the restore can be undone, then choose the backup (upload it first when it comes from elsewhere) and **Restore**. PocketBase swaps `pb_data` for the backup's (the `backups` folder stays) and restarts the server in place; the distroless image needs no shell for that, and the container keeps running. Everything since the backup is gone: accounts created since sign in again as new accounts, PCs paired since pair again, and values come back with each app's next reading. The Windows server cannot restore from the dashboard; restore it by hand.

If a release broke the data, first pin the previous image in `compose.yaml` (`image: ghcr.io/oldbear24/odyle-dashboard:<version>`), or the next start migrates the restored data the same way again.

### Restore by hand

When the server no longer starts, or on Windows. The image has no shell, so a throwaway Alpine container works on the volume of the stopped `odyle` container:

```sh
docker compose stop odyle
# The backup: downloaded from Settings → Backups or the bucket into this folder, or copied off the volume:
docker run --rm --volumes-from "$(docker compose ps -aq odyle)" -v "$PWD":/restore alpine cp /pb/pb_data/backups/<backup>.zip /restore/
# The current data moves to ./before-restore and the backup takes its place:
docker run --rm --volumes-from "$(docker compose ps -aq odyle)" -v "$PWD":/restore alpine sh -c '
  set -e; mkdir /restore/before-restore; cd /pb/pb_data
  find . -mindepth 1 -maxdepth 1 ! -name backups -exec mv {} /restore/before-restore/ \;
  unzip -q /restore/<backup>.zip; chown -R 10001:10001 /pb/pb_data'
docker compose start odyle
```

With a release archive: stop the server, move `pb_data` aside, unzip the backup into a new, empty `pb_data` and start the server again. Delete the old data once the restored server works.

### Test a restore on a copy

Test once after setting up backups, and after larger upgrades: unzip a backup into a new volume and start a second server on it. The copy carries the live server's Discord webhooks and S3 settings, so it must not reach the internet: it would post run reminders again and, at 03:00, prune the bucket's backups. A Docker network created with `--internal` has no way out:

```sh
docker volume create odyle-drill
docker run --rm -v odyle-drill:/pb/pb_data -v "$PWD":/restore alpine sh -c 'cd /pb/pb_data && unzip -q /restore/<backup>.zip && chown -R 10001:10001 .'
docker network create --internal odyle-drill
docker run -d --name odyle-drill --network odyle-drill -v odyle-drill:/pb/pb_data ghcr.io/oldbear24/odyle-dashboard:latest
docker exec odyle-drill /pb/odyle healthcheck   # repeat until it answers: the copy runs the migrations first
docker exec odyle-drill /pb/odyle superuser upsert drill@example.com '<a long password>'
docker run --rm --network odyle-drill curlimages/curl -s http://odyle-drill:8090/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' -d '{"identity":"drill@example.com","password":"<a long password>"}'
docker run --rm --network odyle-drill curlimages/curl -s -H 'Authorization: <token from the answer>' http://odyle-drill:8090/api/odyle/admin/status
docker rm -f odyle-drill && docker network rm odyle-drill && docker volume rm odyle-drill
```

The status answer's `counts` (accounts, characters, rooms, history) should match **Server status** of the live server at the time of the backup. The same steps without Docker (unzip into an empty data directory, start a server on it, compare) were run against the test build of the server, and `backend/odyle/backups_test.go` repeats them on every check.

## Wind-down and reader pause

When the packet reader has to stop for everyone at once, for example because NCSOFT objects to it, stop it from the server first; no release is needed:

1. **Pause the readers.** On the PocketBase dashboard's **Odyle → Server controls**, switch on **Pause packet readers** and save. Within about 20 seconds every paired Windows app that knows the switch stops capturing, closes Npcap and says so on its card. Apps released before the switch keep capturing; their readings are refused (400, so they retry once a minute instead of reconnecting) and their cards show the message as a refused reading. Heartbeats continue but no longer keep readings live, so every character turns stale within 45 seconds; saved values and history stay.
2. **Tell the players.** On the same page, post a **Warning** announcement: what happened, that reading is paused and what comes next. It shows above every dashboard page and on the Windows app card.
3. **For a lasting stop**, ship a Windows release without packet capture (it still pairs, lists the party and ticks tasks), and keep the pause on until **Server status** shows the apps in contact on that version.
4. **Never fall back to typed values.** Odyle comes only from game packets: no manual entry, imports or overrides to keep rooms going. Rooms keep showing the last saved values with their age.

Switching the pause off lets the apps capture again by themselves within about 20 seconds. To stop only a decoder that reads wrong values, switch its adapter off under **Packet adapters** instead: its readings are refused while the apps keep running (see [New packet adapters](api.md#new-packet-adapters)).

## Upgrading from the JavaScript backend

Releases before the Go backend ran the stock PocketBase binary with `pb_hooks` and `pb_migrations`. The Go backend uses the same data directory: keep the volume (or `pb_data`), replace the image (or the `pocketbase` binary with `odyle`) and remove `pb_hooks` and `pb_migrations`. Its migrations keep the names of the JavaScript ones, so a migrated database runs none of them again, and accounts, sign-ins, paired PCs, portraits and settings carry over. Command-line flags of the stock binary that are gone: `--hooksDir`, `--hooksWatch`, `--hooksPool`, `--migrationsDir` and `--automigrate`. A stock PocketBase or PocketHost instance cannot run the backend any more; deploy the image or a release archive.
