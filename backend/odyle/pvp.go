package odyle

import (
	"cmp"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// PvP stats (opt-in). An account that turns them on (users.pvpStats, POST /api/odyle/pvp-stats)
// lets its Windows app read and send its characters' PvP kills, assists and deaths, each with
// the name of the other player as the game says it (POST /api/odyle/pvp): who was killed, who
// made the kill the character assisted, who killed the character. Without the opt-in the app
// reads none of it and the server keeps none of it. Each event is a row of character_pvp, kept
// as long as Game settings say (pvpDays, 90 by default); characters.pvp counts them since PvP
// stats were turned on, which rooms see with the shared character. The character's owner and
// the members of the rooms it is shared in read its stats (GET /api/odyle/pvp/{id}): the
// counts of a period, the players it met and the latest events. Turning PvP stats off clears
// the counts and deletes the events.

var pvpKinds = []string{"kill", "assist", "death"}

// An event's id is the app's: 32 lowercase hexadecimal digits.
var pvpEventId = regexp.MustCompile(`^[0-9a-f]{32}$`)

// A player's name as the game allows it: letters and digits of any script.
var pvpName = regexp.MustCompile(`^[\p{L}\p{N}\p{M}]{1,40}$`)

// A server's name as the app knows the game's servers: letters only, like the armory's.
var pvpServer = regexp.MustCompile(`^[A-Za-z]{2,20}$`)

// pvpBatch is how many events one request carries, pvpLate how long ago one may have happened
// (the app keeps an event it could not send for an hour).
const pvpBatch, pvpLate = 20, 24 * time.Hour

// pvpOpponents bounds the players an answer lists.
const pvpOpponents = 500

// acceptedPvpAdapters are the PvP adapters stored now: Server controls switch them off like
// reading adapters.
func acceptedPvpAdapters(app core.App) []string {
	out, disabled := []string{}, readSettings(app).Adapters.Disabled
	for _, name := range verifiedPvpAdapters {
		if !contains(disabled, name) {
			out = append(out, name)
		}
	}
	return out
}

// pvpCounts is characters.pvp: the character's events since its owner turned PvP stats on.
type pvpCounts struct {
	Kills   int64  `json:"kills"`
	Assists int64  `json:"assists"`
	Deaths  int64  `json:"deaths"`
	At      string `json:"at,omitempty"`
}

func (c *pvpCounts) add(kind string, n int64) {
	switch kind {
	case "kill":
		c.Kills += n
	case "assist":
		c.Assists += n
	case "death":
		c.Deaths += n
	}
}

func pvpCountsOf(c *Character) pvpCounts {
	var counts pvpCounts
	_ = c.UnmarshalJSONField("pvp", &counts)
	return counts
}

type pvpEvent struct {
	id, kind               string
	name, server, region   string
	by, byServer, byRegion string
	at                     time.Time
}

// pvpPlayer reads a player of an event: the name, and the server with its region or neither
// (the game does not always say where a player is from).
func pvpPlayer(entry map[string]any, nameKey, serverKey, regionKey string) (name, server, region string, err error) {
	name, _ = entry[nameKey].(string)
	if !pvpName.MatchString(name) {
		return "", "", "", errors.New("A player's name is 1 to 40 letters or digits.")
	}
	server, _ = entry[serverKey].(string)
	region, _ = entry[regionKey].(string)
	if server == "" && region == "" {
		return name, "", "", nil
	}
	if !pvpServer.MatchString(server) || !contains(regions, region) {
		return "", "", "", errors.New("A player's server comes with its Global region, or both are left out.")
	}
	return name, server, region, nil
}

// validPvpEvents reads the events of a request: 1 to 20, each with the app's id, its kind, the
// other player and how many seconds ago it happened.
func validPvpEvents(b body, at time.Time) ([]pvpEvent, error) {
	raw, ok := b["events"].([]any)
	if !ok || len(raw) == 0 || len(raw) > pvpBatch {
		return nil, errors.New("Send 1 to 20 PvP events.")
	}
	out, seen := make([]pvpEvent, 0, len(raw)), map[string]bool{}
	for _, item := range raw {
		entry, _ := item.(map[string]any)
		var e pvpEvent
		var err error
		if e.id, _ = entry["id"].(string); !pvpEventId.MatchString(e.id) || seen[e.id] {
			return nil, errors.New("A PvP event's id is 32 hexadecimal digits, each once.")
		}
		seen[e.id] = true
		if e.kind, _ = entry["kind"].(string); !contains(pvpKinds, e.kind) {
			return nil, errors.New("A PvP event is a kill, an assist or a death.")
		}
		if e.name, e.server, e.region, err = pvpPlayer(entry, "name", "server", "region"); err != nil {
			return nil, err
		}
		// Who made the kill, for an assist; the game may not have said.
		if by, _ := entry["by"].(string); e.kind == "assist" && by != "" {
			if e.by, e.byServer, e.byRegion, err = pvpPlayer(entry, "by", "byServer", "byRegion"); err != nil {
				return nil, err
			}
		}
		ago, err := integer(entry["ago"], "A PvP event's age in seconds", 0, int64(pvpLate/time.Second))
		if err != nil {
			return nil, err
		}
		e.at = at.Add(-time.Duration(ago) * time.Second)
		out = append(out, e)
	}
	return out, nil
}

// pvp stores PvP events of a character of the account (POST /api/odyle/pvp, the Windows app).
// An account without PvP stats is answered enabled: false and nothing is kept, so the app
// stops reading until its heartbeat says otherwise. An event already stored is not stored again.
func pvp(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if readSettings(app).ReaderPaused {
			return nil, unavailable("Packet readers are paused by the server operators.")
		}
		if _, err := ownSession(app, user.Id, b.str("sessionId")); err != nil {
			return nil, err
		}
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		if adapter, _ := b.text("adapter"); !contains(acceptedPvpAdapters(app), adapter) {
			return nil, badRequest("This PvP adapter is not accepted.")
		}
		events, err := validPvpEvents(b, time.Now())
		if err != nil {
			return nil, err
		}
		if !user.GetBool("pvpStats") {
			return map[string]any{"enabled": false}, nil
		}
		counts, stored, latest := pvpCountsOf(c), 0, time.Time{}
		for _, ev := range events {
			known, err := app.CountRecords("character_pvp", dbx.HashExp{"character": c.Id, "event": ev.id})
			if err != nil {
				return nil, err
			}
			if known > 0 {
				continue
			}
			row, err := newRecord(app, "character_pvp")
			if err != nil {
				return nil, err
			}
			for key, value := range map[string]any{"character": c.Id, "event": ev.id, "kind": ev.kind, "name": ev.name, "server": ev.server, "region": ev.region, "killer": ev.by, "killerServer": ev.byServer, "killerRegion": ev.byRegion, "at": stamp(ev.at)} {
				row.Set(key, value)
			}
			if err := app.Save(row); err != nil {
				return nil, err
			}
			counts.add(ev.kind, 1)
			stored++
			if ev.at.After(latest) {
				latest = ev.at
			}
		}
		if stored > 0 {
			if at := stamp(latest); at > counts.At {
				counts.At = at
			}
			// Rooms and the owner hear of the counts with the character (realtime.go).
			c.Set("pvp", counts)
			if err := app.Save(c); err != nil {
				return nil, err
			}
		}
		return map[string]any{"enabled": true, "stored": stored, "serverNow": now()}, nil
	})
}

// pvpSetting turns the account's PvP stats on or off (POST /api/odyle/pvp-stats). On starts the
// counts of its characters at zero; off clears them, which its rooms hear of, and deletes the
// events.
func pvpSetting(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		enabled, ok := b.boolean("enabled")
		if !ok {
			return nil, badRequest("PvP stats must be true or false.")
		}
		account, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		account.Set("pvpStats", enabled)
		if err := app.Save(account); err != nil {
			return nil, err
		}
		if enabled {
			err = countPvp(app, user.Id)
		} else {
			err = forgetPvp(app, user.Id)
		}
		if err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return map[string]any{"pvpStats": enabled}, nil
	})
}

// countPvp starts the PvP counts of an account's characters at zero, so its rooms see that
// they are counted now; a character that already counts keeps its counts.
func countPvp(app core.App, userId string) error {
	characters, err := app.FindAllRecords("characters", dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	for _, c := range characters {
		if raw := c.GetString("pvp"); raw == "" || raw == "null" {
			c.Set("pvp", pvpCounts{})
			if err := app.Save(c); err != nil {
				return err
			}
		}
	}
	return nil
}

// forgetPvp clears the PvP counts of an account's characters and deletes their events.
func forgetPvp(app core.App, userId string) error {
	characters, err := app.FindAllRecords("characters", dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	for _, c := range characters {
		if raw := c.GetString("pvp"); raw != "" && raw != "null" {
			c.Set("pvp", nil)
			if err := app.Save(c); err != nil {
				return err
			}
		}
	}
	_, err = app.DB().NewQuery("DELETE FROM character_pvp WHERE character IN (SELECT id FROM characters WHERE user = {:user})").Bind(dbx.Params{"user": userId}).Execute()
	return err
}

// pvpEventsOf is a character's kept events since a time, newest first: limit of them from offset
// (limit 0: all).
func pvpEventsOf(app core.App, id, since string, limit, offset int) ([]any, error) {
	found, err := app.FindRecordsByFilter("character_pvp", "character = {:id} && at >= {:since}", "-at,-created", limit, offset, dbx.Params{"id": id, "since": since})
	if err != nil {
		return nil, err
	}
	out := make([]any, len(found))
	for i, r := range found {
		event := map[string]any{"kind": r.GetString("kind"), "name": r.GetString("name"), "server": r.GetString("server"), "region": r.GetString("region"), "at": r.GetString("at")}
		if by := r.GetString("killer"); by != "" {
			event["by"], event["byServer"], event["byRegion"] = by, r.GetString("killerServer"), r.GetString("killerRegion")
		}
		out[i] = event
	}
	return out, nil
}

// pvpPlayerRow is a player a character met in the period: how often the character killed
// them, helped kill them and was killed by them (an opponent), or how many of their kills the
// character assisted (an ally), and when last.
type pvpPlayerRow struct {
	Name    string `db:"name" json:"name"`
	Server  string `db:"server" json:"server"`
	Region  string `db:"region" json:"region"`
	Kills   int64  `db:"kills" json:"kills"`
	Assists int64  `db:"assists" json:"assists"`
	Deaths  int64  `db:"deaths" json:"deaths"`
	Last    string `db:"latest" json:"lastAt"`
}

func (p pvpPlayerRow) total() int64 { return p.Kills + p.Assists + p.Deaths }

// mergePlayers folds the rows the game named without a server into the row of the same name
// that has one, when exactly one has: the game says a killer's server but not always a
// victim's, so one player would else show twice. The busiest come first, then the latest.
func mergePlayers(rows []pvpPlayerRow) []pvpPlayerRow {
	servers := map[string]int{}
	for _, r := range rows {
		if r.Server != "" {
			servers[r.Name]++
		}
	}
	out, at := []pvpPlayerRow{}, map[string]int{}
	for _, r := range rows {
		if r.Server != "" && servers[r.Name] == 1 {
			at[r.Name] = len(out)
		}
		if r.Server != "" || servers[r.Name] != 1 {
			out = append(out, r)
		}
	}
	for _, r := range rows {
		if r.Server != "" || servers[r.Name] != 1 {
			continue
		}
		known := &out[at[r.Name]]
		known.Kills, known.Assists, known.Deaths = known.Kills+r.Kills, known.Assists+r.Assists, known.Deaths+r.Deaths
		known.Last = max(known.Last, r.Last)
	}
	slices.SortStableFunc(out, func(a, b pvpPlayerRow) int {
		return cmp.Or(cmp.Compare(b.total(), a.total()), cmp.Compare(b.Last, a.Last), cmp.Compare(a.Name, b.Name))
	})
	return out
}

// pvpDays is the period a stats request asks for: ?days=, 1 up to as long as events are kept,
// which it is without one.
func pvpDays(e *core.RequestEvent, kept int64) int64 {
	if n, err := strconv.ParseInt(e.Request.URL.Query().Get("days"), 10, 64); err == nil && n >= 1 && n < kept {
		return n
	}
	return kept
}

// pvpStats answers a character's PvP stats (GET /api/odyle/pvp/{id}) to its owner and the
// members of the rooms it is shared in, while its owner has PvP stats on: the counts of the
// period (?days=, as long as events are kept unless asked), the counts since PvP stats were
// turned on, the players it met and the allies whose kills it assisted (up to 500 each, the
// busiest first), and a page of the events, newest first (?page=, ?perPage=, 15 by default).
// ?only=events answers the page alone.
func pvpStats(e *core.RequestEvent) error {
	return run(e, func() error {
		c, err := readableCharacter(e)
		if err != nil {
			return err
		}
		owner, err := e.App.FindRecordById("users", c.User())
		if err != nil {
			return err
		}
		rules := readSettings(e.App)
		days := pvpDays(e, rules.PvpDays)
		page, perPage := pageOf(e, 15)
		answer := map[string]any{"character": map[string]any{"id": c.Id, "characterName": c.Name()}, "enabled": owner.GetBool("pvpStats"), "days": days, "keepDays": rules.PvpDays,
			"events": []any{}, "page": page, "perPage": perPage, "total": 0, "pages": 1, "serverNow": now()}
		eventsOnly := e.Request.URL.Query().Get("only") == "events"
		if !eventsOnly {
			answer["totals"], answer["allTime"], answer["opponents"], answer["opponentCount"], answer["allies"] = pvpCounts{}, nil, []any{}, 0, []any{}
		}
		if !owner.GetBool("pvpStats") {
			return e.JSON(200, answer)
		}
		since := ago(daysOf(days))
		params := dbx.Params{"id": c.Id, "since": since}
		total, err := e.App.CountRecords("character_pvp", dbx.NewExp("character = {:id} AND at >= {:since}", params))
		if err != nil {
			return err
		}
		answer["total"], answer["pages"] = total, pages(int(total), perPage)
		if answer["events"], err = pvpEventsOf(e.App, c.Id, since, perPage, (page-1)*perPage); err != nil {
			return err
		}
		if eventsOnly {
			return e.JSON(200, answer)
		}
		if raw := c.GetString("pvp"); raw != "" && raw != "null" {
			answer["allTime"] = pvpCountsOf(c)
		}
		var met []pvpPlayerRow
		if err := e.App.DB().NewQuery("SELECT name, server, region, SUM(kind = 'kill') AS kills, SUM(kind = 'assist') AS assists, SUM(kind = 'death') AS deaths, MAX(at) AS latest FROM character_pvp WHERE character = {:id} AND at >= {:since} GROUP BY name, server, region").Bind(params).All(&met); err != nil {
			return err
		}
		var totals pvpCounts
		for _, r := range met {
			totals.Kills, totals.Assists, totals.Deaths = totals.Kills+r.Kills, totals.Assists+r.Assists, totals.Deaths+r.Deaths
		}
		opponents := mergePlayers(met)
		answer["totals"], answer["opponentCount"] = totals, len(opponents)
		answer["opponents"] = opponents[:min(len(opponents), pvpOpponents)]
		var helped []pvpPlayerRow
		if err := e.App.DB().NewQuery("SELECT killer AS name, killerServer AS server, killerRegion AS region, 0 AS kills, COUNT(*) AS assists, 0 AS deaths, MAX(at) AS latest FROM character_pvp WHERE character = {:id} AND at >= {:since} AND kind = 'assist' AND killer != '' GROUP BY killer, killerServer, killerRegion").Bind(params).All(&helped); err != nil {
			return err
		}
		allies := mergePlayers(helped)
		answer["allies"] = allies[:min(len(allies), pvpOpponents)]
		return e.JSON(200, answer)
	})
}
