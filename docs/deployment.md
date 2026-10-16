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

Replace the example with your actual origin. Keep the port bound to loopback when the proxy runs on the host. Forward HTTP/1.1 connections and disable response buffering for `/api/realtime` so SSE arrives immediately: open dashboards follow rooms, readings and heartbeats over it and otherwise fall back to fetching every 15 seconds. Odyle checks room membership on subscription and with every delivery, and unsubscribes a member who left or was removed; PocketBase checks collection permissions on its own topics.

If you use a separate static host, provide `VITE_POCKETBASE_URL` as a Docker build argument or Vite build environment variable, and allow that exact frontend origin. Static hosting alone cannot run the backend.

## Releases

Every push to `main` runs the checks, then publishes:

- the image `ghcr.io/oldbear24/odyle-dashboard` for `linux/amd64` and `linux/arm64`, tagged `latest`, `<version>.<run number>` (for example `0.4.0.12`) and `sha-<commit>`. It is built without `VITE_POCKETBASE_URL`, so the UI talks to the instance that serves it;
- the GitHub release `v<version>.<run number>` with `odyle-dashboard-<version>.<run number>-<os>-<arch>.zip` for `linux-amd64`, `linux-arm64` and `windows-amd64` and their checksums. Each ZIP holds the server `odyle` (`odyle.exe` on Windows) with the dashboard and the migrations built in; run `odyle serve --http=127.0.0.1:8090`. Data is kept in `pb_data` next to it unless `--dir` says otherwise. The built-in dashboard answers with an ETag per file: the page, `sw.js`, the manifest and the icons are revalidated on each load, and the content-hashed files under `assets/` are cached for a year, so a new release reaches browsers at once. `--publicDir=<folder>` serves a dashboard folder instead, for example one built with `VITE_POCKETBASE_URL`. Releases before the built-in dashboard shipped it in `pb_public`; an upgraded installation can delete that folder.

The version comes from `package.json`; bump it to start a new line. Release archives and the image carry it in the server (with the image's commit), and the **Server status** page shows it. To run the published image instead of building locally, replace `build: .` in `compose.yaml` with:

```yaml
image: ghcr.io/oldbear24/odyle-dashboard:latest
```

## Operations

- Bootstrap the first PocketBase operator account locally. Restrict the management path `/_/` at your proxy to operator access.
- Application clients use the Discord-enabled `users` auth collection, never superusers. Configure the provider using [Discord setup](discord-setup.md).
- The PocketBase dashboard's **Odyle** page (`/_/#/odyle`) shows the connected Windows apps and their live requests and edits the game settings. It is the UI extension in `backend/admin`, built into the backend. If a CDN caches `/_/`, bypass its cache for `/_/` itself (its first answer to each browser carries a one-time `Clear-Site-Data` header and cookie), `/_/extensions.js` and `/_/extensions/*`, or purge them after a deploy.
- Back up the data volume before upgrading. PocketBase is pinned in `backend/go.mod` and upgraded like any Go module, its JavaScript SDK in `package.json`; keep both together and run the integration checks on upgrades.
- Character pictures need outbound HTTPS from the backend to `api-search.plaync.com`, `profileimg.plaync.com` and `fizz-download.playnccdn.com` (the portrait host redirects there; redirects are followed only to `*.plaync.com` and `*.playnccdn.com`, and an image larger than 512 KB is refused). Without it characters keep their initials. `PLAYNC_SEARCH_URL` and `PLAYNC_IMAGE_URL` override both hosts for tests.
- The Windows app download link needs outbound HTTPS from the backend to `api.github.com` (one request as it starts and then every ten minutes at most, cached in memory, conditional on the known release so an unchanged one does not count against GitHub's rate limit; redirects only within `api.github.com`). Without it the dashboard links GitHub's latest-release page without a version. `ODYLE_WINDOWS_REPOSITORY` points at a fork of the Windows app; `ODYLE_WINDOWS_RELEASE_URL` replaces the feed URL for tests.
- Discord reminders of planned runs need outbound HTTPS from the backend to `discord.com` (a test post when a room owner connects a webhook, then one post per run; the `odyle-reminders` job runs every minute and holds back a webhook while Discord asks it to wait). Without it rooms simply have no Discord reminders. `ODYLE_DISCORD_WEBHOOK_BASE` replaces `https://discord.com` for tests.
- The dashboard registers a service worker (`sw.js` next to `index.html`) that keeps the page and its built files for visits without a connection; it never caches `/api/` or `/_/`. Serve `sw.js` without a long cache lifetime at your CDN or proxy, so a deploy reaches browsers on their next visit.
- Dashboard pages and files are served with `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (`backend/odyle/register.go`). `/api/` and `/_/` are excluded because the OAuth redirect page and the PocketBase UI use inline scripts. Add HSTS at your HTTPS proxy.
- PocketBase sends email only once **Settings → Mail settings** names an SMTP server and a sender. Accounts then get an alert when they sign in from a new device (switch it off with **Send email alert for new logins** under the `users` collection's **Options**), and superusers get password resets and, with MFA or one-time passwords on, sign-in codes. The emails come in the dashboard's look (**Send test email** beside the collection's **Options → Mail templates** sends one); their buttons and links start with **Settings → Application → Application URL**, so set it to the public origin (`https://odyle.example.com`): the alert's **Open Account & data** opens `<Application URL>/#/account`, the dashboard this backend serves.
- Request/IP logs are disabled by the migration. Configure proxy logs consistently with your privacy preference.
- **Server status** offers Go profiles of the running server (CPU, heap, allocations, goroutines) as files for `go tool pprof`; from a shell: `curl -H "Authorization: <superuser token>" https://odyle.example.com/api/odyle/admin/pprof/heap -o heap.pb.gz`, then `go tool pprof -http=: heap.pb.gz`. A CPU profile takes the seconds it is asked for (`profile?seconds=30`).
- The backend writes its own log lines (failed jobs; failed PLAYNC, Discord and GitHub lookups; deleted inactive accounts) to the standard error as text with their fields (`job`, `character`, `room`, `error`, …), so `docker compose logs` shows them. Failed outbound calls name the method and host, never the address, so webhook tokens and character names stay out of logs and the Background jobs page; answers are read up to a size limit per call. When **Settings → Logs** keeps logs (the migration turns that off, request logs included), PocketBase also stores them and lists them under **Logs** with the same fields.
- Rate limits are enabled for room creation and invite joins (30 a minute each), application routes under `/api/odyle/` (600 a minute), pairing and sign-in (10 a minute) and Windows app device sign-in and unpairing (30 a minute); all per client. Configure trusted proxy IP headers only for your own proxy; do not trust arbitrary forwarded client IP headers.
- Accounts are capped at 30 characters, 20 owned rooms, 50 memberships, 40 tasks and 10 paired Windows PCs. Unused accounts are kept unless you set **Delete inactive accounts after (days)** on the Odyle page (30 days or more; a nightly job at 03:17 server time deletes up to 200 accounts per run and passes their rooms on). Deleting an account in the PocketBase dashboard passes its rooms on the same way.
- The server-wide settings (`odyle_settings`) are kept in memory and read again after every change made through PocketBase: the **Odyle** pages, **Collections → odyle_settings** or the API. A change written straight into the SQLite file applies after a restart.
- Odyle history keeps 30 days of changes per character and finished planned runs are deleted a day after their start, both by the five-minute expiry job.
- Rooms and account-owned character values persist in the data volume. Freshness uses server timestamps; client clocks affect only display, corrected using heartbeat responses. Heartbeats are written every ten seconds and when the backend stops; a crash loses at most those ten seconds of presence, which the next heartbeats restore.
- Invites can be reused during their 30-minute lifetime. Rotate them to stop new joins; remove a member to revoke existing access. Rooms allow up to 50 members, including viewers.
- Browser sign-ins are stored in localStorage, shared by all tabs and kept across browser restarts until sign-out. Account tokens last seven days and are renewed each time the dashboard opens. Sign in again with the same Discord account to recover owned rooms and characters. There is no automatic inactivity deletion of rooms.

## Upgrading from the JavaScript backend

Releases before the Go backend ran the stock PocketBase binary with `pb_hooks` and `pb_migrations`. The Go backend uses the same data directory: keep the volume (or `pb_data`), replace the image (or the `pocketbase` binary with `odyle`) and remove `pb_hooks` and `pb_migrations`. Its migrations keep the names of the JavaScript ones, so a migrated database runs none of them again, and accounts, sign-ins, paired PCs, portraits and settings carry over. Command-line flags of the stock binary that are gone: `--hooksDir`, `--hooksWatch`, `--hooksPool`, `--migrationsDir` and `--automigrate`. A stock PocketBase or PocketHost instance cannot run the backend any more; deploy the image or a release archive.
