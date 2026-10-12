# Deployment

The simplest deployment serves both UI and API from one PocketBase instance. Keep one instance per SQLite data volume.

## Docker

```sh
docker compose up --build -d
```

Open `http://127.0.0.1:8090` for a local installation. The image verifies the PocketBase release checksum, runs as a non-root user and stores the database in a named volume.

For internet access, put an HTTPS reverse proxy in front of port 8090 and change the Compose command to:

```yaml
command: ["--origins=https://odyle.example.com"]
```

Replace the example with your actual origin. Keep the port bound to loopback when the proxy runs on the host. Forward HTTP/1.1 connections and disable response buffering for `/api/realtime` so SSE arrives immediately. PocketBase checks collection permissions on realtime subscriptions; the additional message hook rechecks revoked/expired membership before delivery.

If you use a separate static host, provide `VITE_POCKETBASE_URL` as a Docker build argument or Vite build environment variable, and allow that exact frontend origin. Static hosting alone cannot run PocketBase.

## Operations

- Bootstrap the first PocketBase operator account locally. Restrict the management path `/_/` at your proxy to operator access.
- Application clients use the `members` auth collection, never superusers.
- Back up the data volume before upgrading PocketBase or migrations. Keep the pinned binary and SDK versions together and run integration checks on upgrades.
- Request/IP logs are disabled by the migration. Configure proxy logs consistently with your privacy preference.
- Rate limits are enabled for room creation, invite joins and application routes. Configure trusted proxy IP headers only for your own proxy; do not trust arbitrary forwarded client IP headers.
- Room expiry uses server timestamps; client clocks affect only display, corrected using heartbeat responses.
- Invites can be reused during their 30-minute lifetime. Rotate them to stop new joins; remove a member to revoke existing access. Rooms allow up to 50 credentials, including viewers.
- Leader sessions are tab-scoped and last up to 24 hours. Losing a leader token cannot be recovered through another member's invite. Create a new room if that happens; inactive old rooms expire.

Docker configuration is included but was not executed during the initial Windows development run. The Windows PocketBase binary, app API and static build were verified locally.
