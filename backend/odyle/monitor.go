package odyle

import (
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/subscriptions"

	"github.com/oldbear24/odyle-dashboard/backend/admin"
)

// The Odyle pages of the superuser dashboard (backend/admin): the Windows apps
// connected right now, the requests the apps and the dashboard send as they arrive
// ("packets"), the background jobs and the server-wide settings. Only superusers reach
// these routes and the realtime topic.
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
	"heartbeat":       {"sessionId", "characterId"},
	"invalidate":      {"sessionId", "characterId"},
	"character":       {"characterName", "server", "region"},
	"pair":            {"name"},
	"desktop-sign-in": {"name"},
	"desktop-device":  {"name"},
	"unpair":          {},
	// The dashboard
	"create": {"name"}, "join": {}, "rename": {"roomId", "name"}, "leave": {"roomId"}, "close": {"roomId"}, "invites": {"roomId"}, "revoke": {"roomId", "memberId"}, "role": {"roomId", "memberId", "role"}, "transfer": {"roomId", "memberId"},
	"sharing": {"roomId", "characterId", "enabled"}, "wishlist": {"roomId", "dungeon", "wanted", "everyone"}, "plan": {"roomId", "id:runId", "dungeon", "startsAt", "going", "remove"}, "discord-webhook": {"roomId", "language"},
	"task": {"id:taskId", "done", "move", "remove"}, "profile": {"displayName"}, "desktop-code": {}, "forget-device": {"deviceId"}, "sign-out-everywhere": {}, "delete-account": {}, "delete-character": {"characterId"},
}

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
	data, err := json.Marshal(map[string]any{"packet": packet})
	if err != nil {
		return
	}
	message := subscriptions.Message{Name: packetTopic, Data: data}
	for _, client := range app.SubscriptionsBroker().Clients() {
		if client.HasSubscription(packetTopic) {
			client.Send(message)
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
		user, account = e.Auth.Id, e.Auth.GetString("displayName")
	}
	packet := newObject().set("at", now()).set("kind", kind).set("user", user).set("account", account).set("ok", failure == nil).set("ms", ms)
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
			if c, err := e.App.FindRecordById("characters", id); err == nil {
				packet.set("characterName", c.GetString("characterName"))
			}
		}
	}
	if id, ok := packet.values["roomId"].(string); ok {
		if r, err := e.App.FindRecordById("party_rooms", id); err == nil {
			packet.set("roomName", r.GetString("name"))
		}
	}
	// A paired app signs in with its device key alone; the key names the account and is not kept.
	if key, ok := b["deviceKey"].(string); kind == "desktop-sign-in" && failure == nil && ok {
		if device, err := e.App.FindFirstRecordByData("desktop_devices", "digest", security.SHA256(key)); err == nil {
			if owner, err := e.App.FindRecordById("users", device.GetString("user")); err == nil {
				packet.set("user", owner.Id).set("account", owner.GetString("displayName"))
				if name, _ := packet.values["name"].(string); name == "" {
					packet.set("name", device.GetString("name"))
				}
			}
		}
	}
	broadcast(e.App, remember(e.App, packet))
}

// observed wraps an Odyle route: the request is answered exactly as before, then listed,
// accepted or rejected, for superusers. A monitor failure never fails the request.
func observed(kind string, handle func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	if _, ok := shown[kind]; !ok {
		return handle
	}
	return func(e *core.RequestEvent) error {
		started := time.Now()
		err := handle(e)
		func() {
			defer func() {
				if r := recover(); r != nil {
					logf("Odyle packet monitor failed: %v", r)
				}
			}()
			publish(e, kind, err, time.Since(started).Milliseconds())
		}()
		return err
	}
}

// apps has one row per reader session. A running Windows app keeps one and touches it
// with every heartbeat (20 s) and reading, so updated is its last contact. Sessions
// expire a day after the last contact and the expiry job deletes them. Rows keep a
// fixed order (account, then connection time): ordering by last contact made every
// heartbeat move its row.
func apps(app core.App) ([]map[string]any, error) {
	sessions, err := app.FindRecordsByFilter("publisher_sessions", "expiresAt > {:now}", "-updated", 200, 0, dbx.Params{"now": stamp(time.Now())})
	if err != nil || len(sessions) == 0 {
		return []map[string]any{}, err
	}
	names, devices, reading := map[string]string{}, map[string]string{}, map[string]*core.Record{}
	users, err := app.FindRecordsByIds("users", unique(field(sessions, "user")))
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		names[u.Id] = u.GetString("displayName")
	}
	deviceIds := []string{}
	for _, id := range unique(field(sessions, "device")) {
		if id != "" {
			deviceIds = append(deviceIds, id)
		}
	}
	if len(deviceIds) > 0 {
		found, err := app.FindRecordsByIds("desktop_devices", deviceIds)
		if err != nil {
			return nil, err
		}
		for _, d := range found {
			devices[d.Id] = d.GetString("name")
		}
	}
	// The character each session read most recently.
	read, err := app.FindAllRecords("characters", dbx.In("readingSession", anys(ids(sessions))...))
	if err != nil {
		return nil, err
	}
	for _, c := range read {
		id := c.GetString("readingSession")
		if reading[id] == nil || reading[id].GetString("lastSeenAt") < c.GetString("lastSeenAt") {
			reading[id] = c
		}
	}
	rows := make([]map[string]any, len(sessions))
	for i, s := range sessions {
		var character any
		if c := reading[s.Id]; c != nil {
			character = map[string]any{"id": c.Id, "characterName": c.GetString("characterName"), "server": c.GetString("server"), "region": c.GetString("region"), "value": c.GetInt64("value"), "confirmed": c.GetBool("confirmed"), "valid": c.GetBool("valid"), "lastSeenAt": c.GetString("lastSeenAt"), "lastReadingAt": c.GetString("lastReadingAt"), "parserVersion": c.GetString("parserVersion")}
		}
		rows[i] = map[string]any{"sessionId": s.Id, "user": s.GetString("user"), "account": names[s.GetString("user")], "device": devices[s.GetString("device")], "appVersion": s.GetString("appVersion"), "connectedAt": s.GetString("created"), "lastContactAt": s.GetString("updated"), "readings": s.GetInt64("sequence"), "character": character}
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
	if out["skipped"] == "running" {
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
