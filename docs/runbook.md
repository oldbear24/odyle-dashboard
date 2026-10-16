# Runbook

What an operator of an Odyle server does in the common situations, step by step. Background and every setting are in [Deployment](deployment.md); the server's own pages are the PocketBase dashboard's **Odyle** pages (`/_/#/odyle`): **Apps & packets**, **Server status**, **Background jobs**, **Game settings** and **Server controls**.

Self-hosting works with these documents, but it is not supported: the project runs one server, and questions go to the [issues](https://github.com/oldbear24/odyle-dashboard/issues).

## Deploy a new version

Every push to `main` publishes the image `ghcr.io/oldbear24/odyle-dashboard` tagged `latest`, its version (for example `0.16.0`) and `sha-<commit>`, and a GitHub release with the server ZIPs ([Releases](deployment.md#releases)).

1. Back up: **Settings → Backups → Backup now** (or let the nightly backup be the one; see [Backups and restore](deployment.md#backups-and-restore)).
2. Read the release notes of every version since the running one (the GitHub releases, or the dashboard's **What's new**): a release that needs anything from operators says so.
3. Pull and restart: `docker compose pull && docker compose up -d`. With a pinned tag (below), change the tag first.
4. Check: **Server status** shows the new version and the image's commit; `docker compose ps` shows the container healthy; `docker compose logs --since 10m odyle` shows no failed migrations or jobs.

Migrations run as the server starts, all pending ones in one transaction: a failing one leaves the database as it was and the server does not start, so step 4 shows it at once.

## Pin a version

Run a known version instead of `latest`, so a push to `main` does not reach the server before you deploy it:

```yaml
services:
  odyle:
    image: ghcr.io/oldbear24/odyle-dashboard:0.16.0
```

## Roll back

Prefer rolling forward: a fixed version is usually a push away. When the running version has to go:

1. **Without new migrations** in the bad version (its release notes and pull request name them; they are the files `backend/migrations/<number>_*.go` it added): pin the previous tag and `docker compose up -d`.
2. **With new migrations**, undo them with the bad version first, which knows them, then pin the previous tag:

   ```sh
   docker compose stop odyle
   # One migration back per count; repeat or raise the count for each migration the bad version added.
   docker compose run --rm --entrypoint /pb/odyle odyle migrate down 1 --dir=/pb/pb_data
   ```

   Then set the previous tag in `compose.yaml` and `docker compose up -d`. A migration's down step drops what it added: the fields and collections of that version and their data.
3. **When the data is damaged**, restore the backup made before the upgrade instead ([Restore](deployment.md#restore-in-the-superuser-dashboard)); changes made since are lost.

## A game patch broke reading

After the game's Wednesday maintenance the decoder may stop matching the game's packets.

1. **Server status → Readers** warns when apps connected to the game read no Odyle for 10 minutes; **Apps & packets** shows what the apps send.
2. If wrong values are being saved, switch the adapter off: **Server controls → Packet adapters → Built-in adapters** (its readings are refused from then on), or turn on **Pause packet readers** under **Switches**: the apps stop reading and say so, and resume by themselves when you switch it off.
3. Tell players: **Server controls → Announcement** (one line, *info* or *warning*): dashboards show it at once and the Windows app on its next contact.
4. Once a fixed Windows release is out, players' apps update themselves; switch readers back on and clear the announcement.

## Pause a feature

**Server controls → Switches** pauses each outbound feature without a deploy: **Pause portrait refresh** (PLAYNC portrait, class and level lookups), **Pause the armory** (new PLAYNC profile reads; kept profiles still show), **Pause Discord reminders**, **Pause new pairings** (paired apps keep working) and **Pause packet readers**. Each job's last result is on **Background jobs**.

## Post an announcement

**Server controls → Announcement**: up to 300 characters of plain text, *info* or *warning*. Players can hide it until a new one is posted. Empty text removes it.

## Restore a backup

See [Backups and restore](deployment.md#backups-and-restore): restore in the superuser dashboard, or by hand from a downloaded backup, and test a restore on a copy before relying on it.

## While the maintainer is away

- The server keeps running the version it has. With `latest` and no automatic pulls nothing changes until someone deploys; pin a version (above) to be sure.
- Players' Windows apps keep their pairing and update only from published releases.
- Another superuser can do everything in this runbook: post announcements, pause readers or features, switch adapters off, and back up or restore. Give that access deliberately: a superuser sees every account.
