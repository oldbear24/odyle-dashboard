package odyle

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/oldbear24/odyle-dashboard/backend/admin"
)

// The Odyle pages of the superuser dashboard (backend/admin): the Windows apps
// connected right now, the requests the apps and the dashboard send as they arrive
// ("packets"), the server's status with the last hour's traffic, the background jobs and
// the server-wide settings. Only superusers reach these routes and the realtime topic.
//
// Packets are Odyle's own API requests, never game traffic. The newest 200 live in
// memory only: nothing is written to the database, and a restart clears them.
const packetTopic, packetLimit = "odyle.admin.packets", 200

// The body fields each route may show; everything else is never kept: tokens, invite and
// pairing codes, device keys, webhook URLs, run notes and task titles included. 'id:taskId'
// keeps a body field under another name: a packet's own id is its number.
var shown = map[string][]string{
	// The Windows app
	"session":         {"previousSessionId", "appVersion"},
	"report":          {"sessionId", "sequence", "characterId", "characterName", "server", "region", "value", "parserVersion"},
	"heartbeat":       {"sessionId", "characterId", "reader", "game"},
	"invalidate":      {"sessionId", "characterId"},
	"character":       {"characterName", "server", "region"},
	"pair":            {"name"},
	"desktop-sign-in": {"name"},
	"desktop-device":  {"name"},
	"unpair":          {},
	// The dashboard
	"create": {"name"}, "join": {}, "rename": {"roomId", "name"}, "leave": {"roomId"}, "close": {"roomId"}, "invites": {"roomId"}, "revoke": {"roomId", "memberId"}, "role": {"roomId", "memberId", "role"}, "transfer": {"roomId", "memberId"},
	"invite-create": {"roomId", "role", "expiresIn", "maxUses"}, "invite-revoke": {"roomId", "inviteId"}, "invite-preview": {},
	"sharing": {"roomId", "characterId", "enabled"}, "wishlist": {"roomId", "dungeon", "wanted", "everyone"}, "plan": {"roomId", "id:runId", "dungeon", "startsAt", "going", "remove"}, "discord-webhook": {"roomId", "language"},
	"task": {"id:taskId", "done", "move", "remove"}, "profile": {"displayName"}, "desktop-code": {}, "forget-device": {"deviceId"}, "sign-out-everywhere": {}, "delete-account": {}, "delete-character": {"characterId"}, "notifications": {}, "push-subscribe": {"language", "device"}, "push-unsubscribe": {}, "push-test": {}, "share-new": {"roomId", "enabled"},
}

// Requests of the Windows app (source "app"); everything else comes from the dashboard
// ("web"). Character saves come from both, and count as the app's.
var appKinds = map[string]bool{"session": true, "report": true, "heartbeat": true, "invalidate": true, "character": true, "pair": true, "desktop-sign-in": true, "desktop-device": true, "unpair": true}

func details(packet *object, kind string, b body) {
	for _, f := range shown[kind] {
		key, name, _ := strings.Cut(f, ":")
		if name == "" {
			name = key
		}
		switch v := b[key].(type) {
		case string:
			if t := trim(v); t != "" {
				packet.set(name, cut(t, 80))
			}
		case float64:
			if !math.IsInf(v, 0) && !math.IsNaN(v) {
				packet.set(name, v)
			}
		case bool:
			packet.set(name, v)
		}
	}
}

// remember numbers a packet and keeps the newest 200.
func remember(app core.App, packet *object) *object {
	s := stateOf(app)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.packetCount++
	saved := &object{keys: append([]string{"id"}, packet.keys...), values: packet.values}
	saved.values["id"] = s.packetCount
	s.packets = append(s.packets, saved)
	if len(s.packets) > packetLimit {
		s.packets = s.packets[len(s.packets)-packetLimit:]
	}
	return saved
}

func packets(app core.App) []*object {
	s := stateOf(app)
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]*object{}, s.packets...)
}

func broadcast(app core.App, packet *object) {
	message := map[string]any{"packet": packet}
	for _, client := range app.SubscriptionsBroker().Clients() {
		if client.HasSubscription(packetTopic) {
			post(client, packetTopic, message)
		}
	}
}

func publish(e *core.RequestEvent, kind string, failure error, ms int64) {
	b, err := requestBody(e)
	if err != nil {
		b = body{}
	}
	user, account := "", ""
	if e.Auth != nil {
		user, account = e.Auth.Id, viewOf[Account](e.Auth).DisplayName()
	}
	source := "web"
	if appKinds[kind] {
		source = "app"
	}
	packet := newObject().set("at", now()).set("kind", kind).set("source", source).set("user", user).set("account", account).set("ok", failure == nil).set("ms", ms)
	details(packet, kind, b)
	if failure != nil {
		text := message(failure)
		if text == "" {
			text = "Rejected."
		}
		packet.set("error", cut(text, 200))
	}
	// Heartbeats and invalidations name their character by id only, room routes their room.
	if id, ok := packet.values["characterId"].(string); ok {
		if _, named := packet.get("characterName"); !named {
			if c, err := findAs[Character](e.App, "characters", id); err == nil {
				packet.set("characterName", c.Name())
			}
		}
	}
	if id, ok := packet.values["roomId"].(string); ok {
		if r, err := findAs[Room](e.App, "party_rooms", id); err == nil {
			packet.set("roomName", r.Name())
		}
	}
	// A paired app signs in with its device key alone; the key names the account and is not kept.
	if key, ok := b["deviceKey"].(string); kind == "desktop-sign-in" && failure == nil && ok {
		if device := findDevice(e.App, key); device != nil {
			if owner, err := findAs[Account](e.App, "users", device.User()); err == nil {
				packet.set("user", owner.Id).set("account", owner.DisplayName())
				if name, _ := packet.values["name"].(string); name == "" {
					packet.set("name", device.Name())
				}
			}
		}
	}
	broadcast(e.App, remember(e.App, packet))
	tally(e, kind, source, ms, failure)
}

// tally counts a handled request for the Server status page, and whether the client
// address rate limits count it under is private or loopback (proxy.go).
func tally(e *core.RequestEvent, kind, source string, ms int64, failure error) {
	at, t := time.Now(), stateOf(e.App).traffic
	t.record(at, kind, source, ms, failure)
	if privateAddress(e.RealIP()) {
		t.fromPrivate(at)
	}
}

// measure runs a route's handler exactly as before and hands its outcome to done. A
// monitor failure never fails the request.
func measure(handle func(*core.RequestEvent) error, done func(e *core.RequestEvent, failure error, ms int64)) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		started := time.Now()
		err := handle(e)
		func() {
			defer func() {
				if r := recover(); r != nil {
					warn(e.App, "Odyle monitor failed", "path", e.Request.URL.Path, "error", fmt.Sprint(r))
				}
			}()
			done(e, err, time.Since(started).Milliseconds())
		}()
		return err
	}
}

// observed wraps an Odyle request (POST route): it is listed for superusers, accepted or
// rejected, and counted.
func observed(kind string, handle func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	if _, ok := shown[kind]; !ok {
		return handle
	}
	return measure(handle, func(e *core.RequestEvent, failure error, ms int64) { publish(e, kind, failure, ms) })
}

// timed wraps an Odyle read (GET route): it is only counted for the Server status page,
// never listed.
func timed(name string, handle func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return measure(handle, func(e *core.RequestEvent, failure error, ms int64) { tally(e, "GET "+name, "read", ms, failure) })
}

// apps has one row per reader session. A running Windows app keeps one and touches it
// with every heartbeat (20 s) and reading, so updated is its last contact. Sessions
// expire a day after the last contact and the expiry job deletes them. Rows keep a
// fixed order (account, then connection time): ordering by last contact made every
// heartbeat move its row.
func apps(app core.App) ([]map[string]any, error) {
	found, err := app.FindRecordsByFilter("publisher_sessions", "expiresAt > {:now}", "-updated", 200, 0, dbx.Params{"now": stamp(time.Now())})
	if err != nil || len(found) == 0 {
		return []map[string]any{}, err
	}
	sessions, reading := views[ReaderSession](found), map[string]*Character{}
	names, err := displayNames(app, pluck(sessions, (*ReaderSession).User))
	if err != nil {
		return nil, err
	}
	deviceIds := []string{}
	for _, id := range pluck(sessions, (*ReaderSession).Device) {
		if id != "" {
			deviceIds = append(deviceIds, id)
		}
	}
	devices, err := byID[Device](app, "desktop_devices", deviceIds)
	if err != nil {
		return nil, err
	}
	// The character each session read most recently.
	read, err := app.FindAllRecords("characters", dbx.In("readingSession", anys(ids(found))...))
	if err != nil {
		return nil, err
	}
	for _, c := range views[Character](read) {
		id := c.ReadingSession()
		if reading[id] == nil || reading[id].LastSeenAt() < c.LastSeenAt() {
			reading[id] = c
		}
	}
	rows := make([]map[string]any, len(sessions))
	for i, s := range sessions {
		var character any
		if c := reading[s.Id]; c != nil {
			present(app, c)
			character = map[string]any{"id": c.Id, "characterName": c.Name(), "server": c.Server(), "region": c.Region(), "value": c.Value(), "confirmed": c.Confirmed(), "valid": c.Valid(), "lastSeenAt": c.LastSeenAt(), "lastReadingAt": c.LastReadingAt(), "parserVersion": c.ParserVersion()}
		}
		device := ""
		if d := devices[s.Device()]; d != nil {
			device = d.Name()
		}
		var reader any
		if r, ok := readerOf(app, s.Id, time.Now()); ok {
			reader = map[string]any{"status": r.status, "since": stamp(r.since), "game": r.game}
		}
		rows[i] = map[string]any{"sessionId": s.Id, "user": s.User(), "account": names[s.User()], "device": device, "appVersion": s.AppVersion(), "connectedAt": s.Created(), "lastContactAt": contactAt(app, s), "readings": s.Sequence(), "character": character, "reader": reader}
	}
	key := func(row map[string]any) string {
		return strings.ToLower(row["account"].(string)) + "\u0000" + row["connectedAt"].(string) + "\u0000" + row["sessionId"].(string)
	}
	sort.SliceStable(rows, func(a, b int) bool { return key(rows[a]) < key(rows[b]) })
	return rows, nil
}

// latestVersion is the newest Windows release, so the page can mark outdated apps.
func latestVersion(app core.App) string {
	if release := latestRelease(app); release != nil {
		version, _ := release["version"].(string)
		return version
	}
	return ""
}

func monitor(e *core.RequestEvent) error {
	rows, err := apps(e.App)
	if err != nil {
		return err
	}
	return e.JSON(200, map[string]any{"serverNow": now(), "latestVersion": latestVersion(e.App), "apps": rows, "packets": packets(e.App)})
}

// Server status: the database's size, what it holds, the Windows apps connected by
// version, the release lookup, the last hour's traffic (traffic.go), activation and
// feature use (stats.go), the backups (backups.go) and the trusted proxy (proxy.go).
func counts(app core.App) (*object, error) {
	at, failed := time.Now(), error(nil)
	since := func(d time.Duration) string { return stamp(at.Add(-d)) }
	after := func(field string, d time.Duration) dbx.Expression {
		return dbx.NewExp(field+" >= {:at}", dbx.Params{"at": since(d)})
	}
	open := dbx.NewExp("expiresAt > {:now}", dbx.Params{"now": since(0)})
	count := func(name string, exprs ...dbx.Expression) int64 {
		n, err := app.CountRecords(name, exprs...)
		if err != nil && failed == nil {
			failed = err
		}
		return n
	}
	day := 24 * time.Hour
	out := newObject().
		set("accounts", newObject().set("total", count("users")).set("active24h", count("users", after("lastActiveAt", day))).set("active7d", count("users", after("lastActiveAt", 7*day)))).
		// A reading is live while its heartbeat is less than 45 seconds old, as on the dashboard.
		set("characters", newObject().set("total", count("characters")).set("live", count("characters", dbx.HashExp{"valid": true}, after("lastSeenAt", 45*time.Second)))).
		set("rooms", newObject().set("total", count("party_rooms")).set("discordReminders", count("party_rooms", dbx.NewExp("discordWebhook != ''")))).
		set("pairedPcs", newObject().set("total", count("desktop_devices"))).
		set("readerSessions", newObject().set("open", count("publisher_sessions", open)).set("connected", count("publisher_sessions", open, after("updated", 90*time.Second)))).
		set("plannedRuns", newObject().set("total", count("room_runs")).set("upcoming", count("room_runs", after("startsAt", 0)))).
		set("historyPoints", newObject().set("total", count("character_readings"))).
		set("tasks", newObject().set("total", count("user_tasks")))
	return out, failed
}

// size is the bytes of database files with their write-ahead logs; a missing file counts 0.
func size(app core.App, names ...string) int64 {
	var total int64
	for _, name := range names {
		if info, err := os.Stat(filepath.Join(app.DataDir(), name)); err == nil {
			total += info.Size()
		}
	}
	return total
}

// versions are the Windows apps in contact within the last 90 seconds (online or late),
// by the version their session reported ("" when the app did not send one).
func versions(app core.App) ([]*object, error) {
	at := time.Now()
	sessions, err := app.FindRecordsByFilter("publisher_sessions", "expiresAt > {:now} && updated >= {:since}", "", 1000, 0, dbx.Params{"now": stamp(at), "since": stamp(at.Add(-90 * time.Second))})
	if err != nil {
		return nil, err
	}
	seen, out := map[string]*object{}, []*object{}
	for _, s := range views[ReaderSession](sessions) {
		version := s.AppVersion()
		if seen[version] == nil {
			seen[version] = newObject().set("version", version).set("apps", 0)
			out = append(out, seen[version])
		}
		seen[version].set("apps", seen[version].values["apps"].(int)+1)
	}
	return out, nil
}

func status(e *core.RequestEvent) error {
	s := stateOf(e.App)
	s.mu.Lock()
	startedAt := s.startedAt
	s.mu.Unlock()
	out := newObject().set("serverNow", now()).set("startedAt", startedAt).set("build", build()).set("runtime", runtimeStatus(e.App)).
		set("database", newObject().set("dataBytes", size(e.App, "data.db", "data.db-wal")).set("logsBytes", size(e.App, "auxiliary.db", "auxiliary.db-wal")))
	stored, err := counts(e.App)
	if err != nil {
		return err
	}
	out.set("counts", stored).set("release", releaseLookup(e.App))
	connected, err := versions(e.App)
	if err != nil {
		return err
	}
	out.set("versions", connected).set("traffic", s.traffic.summary(time.Now()))
	reached, err := activation(e.App)
	if err != nil {
		return err
	}
	readers, _ := readerHealth(e.App, time.Now())
	return e.JSON(200, out.set("activation", reached).set("backups", backupStatus(e.App)).set("proxy", proxyStatus(e.App)).set("readers", readers))
}

// retentionRoute answers how many accounts the inactive-account clean-up would delete on
// its next run with the given period (?days=), before a superuser saves it.
func retentionRoute(e *core.RequestEvent) error {
	raw, err := strconv.ParseFloat(e.Request.URL.Query().Get("days"), 64)
	var value any = raw
	if err != nil {
		value = nil
	}
	days, err := inactiveDays(value)
	if err != nil {
		return badRequest(message(err))
	}
	preview, err := retentionPreview(e.App, days, time.Now())
	if err != nil {
		return err
	}
	return e.JSON(200, preview)
}

func jobsJSON(app core.App, extra map[string]any) map[string]any {
	s := stateOf(app)
	s.mu.Lock()
	startedAt := s.startedAt
	s.mu.Unlock()
	out := map[string]any{"serverNow": now(), "startedAt": startedAt, "jobs": jobList(app)}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func jobsRoute(e *core.RequestEvent) error { return e.JSON(200, jobsJSON(e.App, nil)) }

func runJobRoute(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	j, ok := jobs[name]
	if !ok {
		return notFound("There is no such job.")
	}
	if !j.manual {
		return badRequest("This job only runs on its schedule.")
	}
	out := runJob(e.App, name, true)
	if out.Skipped == "running" {
		return badRequest("This job is running right now. Try again in a moment.")
	}
	return e.JSON(200, jobsJSON(e.App, map[string]any{"result": out}))
}

// seenAdapters are the adapter names the latest readings carried, so a new decoder
// shows up here before it can be accepted under Server controls.
func seenAdapters(app core.App) []any {
	seen, order := map[string]*object{}, []any{}
	for _, p := range packets(app) {
		kind, _ := p.values["kind"].(string)
		adapter, _ := p.values["parserVersion"].(string)
		if kind != "report" || adapter == "" {
			continue
		}
		entry := seen[adapter]
		if entry == nil {
			entry = newObject().set("name", adapter).set("accepted", 0).set("rejected", 0).set("lastAt", "")
			seen[adapter] = entry
			order = append(order, entry)
		}
		which := "rejected"
		if ok, _ := p.values["ok"].(bool); ok {
			which = "accepted"
		}
		entry.set(which, entry.values[which].(int)+1)
		entry.set("lastAt", p.values["at"])
	}
	return order
}

func settingsJSON(app core.App, current settings) map[string]any {
	return map[string]any{"settings": current, "defaults": defaultSettings(), "builtInAdapters": verifiedAdapters, "acceptedAdapters": acceptedAdapters(app), "seenAdapters": seenAdapters(app)}
}

func settingsRoute(e *core.RequestEvent) error {
	return e.JSON(200, settingsJSON(e.App, readSettings(e.App)))
}

func saveSettingsRoute(e *core.RequestEvent) error {
	b, err := requestBody(e)
	if err == nil {
		var saved settings
		if saved, err = writeSettings(e.App, b); err == nil {
			return e.JSON(200, settingsJSON(e.App, saved))
		}
	}
	text := message(err)
	if text == "" {
		text = "Settings could not be saved."
	}
	return badRequest(text)
}

// uiVersion answers the content hash under which main.js imports the page.
func uiVersion(e *core.RequestEvent) error {
	return e.JSON(200, map[string]any{"version": admin.Version()})
}
