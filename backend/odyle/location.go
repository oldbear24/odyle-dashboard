package odyle

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Location sharing (opt-in). An account that turns it on (users.shareLocation, POST
// /api/odyle/location-sharing) lets its Windows app send where its characters are, as the game
// says it: on each map load and arrival, about once a second while gliding or flying, and with
// some skills (the game sends nothing while a character simply walks). The latest place is characters.location, which
// rooms see with the shared character, shown with its age; every place is kept in
// character_locations as long as Game settings say (locationDays, 30 by default). Turning
// sharing off clears both. The game names maps by id only:
// superusers name them and link each to a TH.GL map (settings.Maps); the dashboard shows a
// place through TH.GL's embedded map, never with map art of its own.

// load and arrival come with a loading screen; flight is the own character's effect event while
// gliding or flying, effect any other of its effect events (some skills), which also say where.
var locationSources = []string{"load", "arrival", "flight", "effect"}

// A place is kept in the history when it is the first, on another map, a minute after the
// last one kept, or a load or arrival 100 units (a metre) or more away from it.
const locationKeepEvery, locationKeepDistance = time.Minute, 100

// acceptedLocationAdapters are the location adapters stored now: Server controls switch them
// off like reading adapters.
func acceptedLocationAdapters(app core.App) []string {
	out, disabled := []string{}, readSettings(app).Adapters.Disabled
	for _, name := range verifiedLocationAdapters {
		if !contains(disabled, name) {
			out = append(out, name)
		}
	}
	return out
}

// A game map as superusers name it (Game settings): its id from the game, a name, and the map
// of TH.GL's AION 2 site that shows it ("" for none), by its name in TH.GL's addresses (thgl.go).
type gameMap struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Thgl string `json:"thgl"`
}

// TH.GL's map names start with a letter or digit and use the punctuation of names like
// "Up! Up! Up! / Not This Tile?" or "Abyssal Forge: Ludra"; dashboards encode them in addresses.
var thglMap = regexp.MustCompile(`^(?:[\p{L}\p{N}][\p{L}\p{N} _'’.,:!?&()+/-]{0,119})?$`)

// checkMaps reads the named maps: up to 500, each id once, names up to 60 characters. What a
// superuser left out is linked from TH.GL's list (linkMap), when maps are saved and read.
func checkMaps(value any) ([]gameMap, error) {
	raw, ok := value.([]any)
	if !ok || len(raw) > 500 {
		return nil, errors.New("Maps must be a list of up to 500 maps.")
	}
	out, seen := []gameMap{}, map[int64]bool{}
	for _, item := range raw {
		entry, _ := item.(map[string]any)
		id, err := integer(entry["id"], "A map id", 1, 9999999)
		if err != nil {
			return nil, err
		}
		if seen[id] {
			return nil, errors.New("List each map id once.")
		}
		seen[id] = true
		name, _ := entry["name"].(string)
		thgl, _ := entry["thgl"].(string)
		name, thgl = collapse(trim(name)), collapse(trim(thgl))
		if length(name) > 60 {
			return nil, errors.New("Name each map in up to 60 characters.")
		}
		if !thglMap.MatchString(thgl) {
			return nil, errors.New("A TH.GL map is its name as TH.GL lists it, like Altgard, in up to 120 characters.")
		}
		out = append(out, linkMap(gameMap{ID: id, Name: name, Thgl: thgl}))
	}
	return out, nil
}

// coordinate reads one of a place's numbers: finite and at most a million units from the centre.
func coordinate(value any, name string) (float64, error) {
	f, ok := value.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > 1000000 {
		return 0, errors.New(name + " must be a number between -1000000 and 1000000.")
	}
	return math.Round(f*10) / 10, nil
}

type place struct {
	Map     int64    `json:"map"`
	X       float64  `json:"x"`
	Y       float64  `json:"y"`
	Z       float64  `json:"z"`
	Heading *float64 `json:"heading"`
	Source  string   `json:"source"`
	At      string   `json:"at"`
}

func validPlace(b body) (place, error) {
	var p place
	var err error
	if p.Map, err = integer(b["map"], "The map", 1, 9999999); err != nil {
		return p, err
	}
	for _, c := range []struct {
		key    string
		target *float64
	}{{"x", &p.X}, {"y", &p.Y}, {"z", &p.Z}} {
		if *c.target, err = coordinate(b[c.key], "Coordinate "+c.key); err != nil {
			return p, err
		}
	}
	if v, ok := b["heading"]; ok && v != nil {
		h, ok := v.(float64)
		if !ok || math.IsNaN(h) || h < -360 || h > 360 {
			return p, errors.New("The heading must be degrees between -360 and 360.")
		}
		h = math.Round(math.Mod(h+720, 360)*10) / 10
		p.Heading = &h
	}
	if p.Source, _ = b.text("source"); !contains(locationSources, p.Source) {
		return p, errors.New("The source must be load, arrival, flight or effect.")
	}
	return p, nil
}

// location stores where the game says a character of the account is (POST /api/odyle/location,
// the Windows app). An account that does not share is answered shared: false and nothing is
// kept, so the app stops sending until its heartbeat says otherwise.
func location(e *core.RequestEvent) error {
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
		if adapter, _ := b.text("adapter"); !contains(acceptedLocationAdapters(app), adapter) {
			return nil, badRequest("This location adapter is not accepted.")
		}
		p, err := validPlace(b)
		if err != nil {
			return nil, err
		}
		if !user.GetBool("shareLocation") {
			return map[string]any{"shared": false}, nil
		}
		at := time.Now()
		p.At = stamp(at)
		c.Set("location", p)
		if err := app.Save(c); err != nil {
			return nil, err
		}
		last, err := app.FindRecordsByFilter("character_locations", "character = {:id}", "-created", 1, 0, dbx.Params{"id": c.Id})
		if err != nil {
			return nil, err
		}
		keep := len(last) == 0
		if !keep {
			l := last[0]
			moved := math.Hypot(l.GetFloat("x")-p.X, l.GetFloat("y")-p.Y)
			keep = l.GetInt("map") != int(p.Map) || at.Sub(l.GetDateTime("created").Time()) >= locationKeepEvery || (p.Source == "load" || p.Source == "arrival") && moved >= locationKeepDistance
		}
		if keep {
			point, err := newRecord(app, "character_locations")
			if err != nil {
				return nil, err
			}
			point.Set("character", c.Id)
			point.Set("map", p.Map)
			point.Set("x", p.X)
			point.Set("y", p.Y)
			point.Set("z", p.Z)
			point.Set("heading", p.Heading)
			point.Set("source", p.Source)
			if err := app.Save(point); err != nil {
				return nil, err
			}
		}
		// Rooms and the owner hear of the place with the character (realtime.go).
		return map[string]any{"shared": true, "serverNow": now()}, nil
	})
}

// locationSharing turns the account's location sharing on or off (POST
// /api/odyle/location-sharing). Off clears the latest place of every character of the account,
// which its rooms hear of, and deletes their history.
func locationSharing(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		enabled, ok := b.boolean("enabled")
		if !ok {
			return nil, badRequest("Location sharing must be true or false.")
		}
		account, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		account.Set("shareLocation", enabled)
		if err := app.Save(account); err != nil {
			return nil, err
		}
		if !enabled {
			if err := forgetLocations(app, user.Id); err != nil {
				return nil, err
			}
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return map[string]any{"shareLocation": enabled}, nil
	})
}

// forgetLocations clears the places of an account's characters and deletes their history.
func forgetLocations(app core.App, userId string) error {
	characters, err := app.FindAllRecords("characters", dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	for _, c := range characters {
		if raw := c.GetString("location"); raw != "" && raw != "null" {
			c.Set("location", nil)
			if err := app.Save(c); err != nil {
				return err
			}
		}
	}
	_, err = app.DB().NewQuery("DELETE FROM character_locations WHERE character IN (SELECT id FROM characters WHERE user = {:user})").Bind(dbx.Params{"user": userId}).Execute()
	return err
}

// seenBy is nil when the account owns the character or shares a room the character is shared in.
func seenBy(app core.App, c *Character, userId string) error {
	if c.User() == userId {
		return nil
	}
	sharedIn, err := membershipsWhere(app, "user = {:owner} && sharedCharacters ~ {:id}", dbx.Params{"owner": c.User(), "id": c.Id})
	if err != nil {
		return err
	}
	for _, room := range pluck(sharedIn, (*Member).Room) {
		member, err := list(app, "room_members", "room = {:room} && user = {:user}", dbx.Params{"room": room, "user": userId})
		if err != nil {
			return err
		}
		if len(member) > 0 {
			return nil
		}
	}
	return forbidden("This character is not shared with you.")
}

// placesOf is a character's kept places, newest first: limit of them from offset.
func placesOf(app core.App, id string, limit, offset int) ([]any, error) {
	found, err := app.FindRecordsByFilter("character_locations", "character = {:id} && created >= {:since}", "-created", limit, offset, placesKept(app, id))
	if err != nil {
		return nil, err
	}
	out := make([]any, len(found))
	for i, r := range found {
		var heading any
		if h, err := strconv.ParseFloat(r.GetString("heading"), 64); err == nil {
			heading = h
		}
		out[i] = map[string]any{"map": r.GetInt("map"), "x": r.GetFloat("x"), "y": r.GetFloat("y"), "z": r.GetFloat("z"), "heading": heading, "source": r.GetString("source"), "at": r.GetString("created")}
	}
	return out, nil
}

// placesKept are the query parameters of a character's places that are still kept.
func placesKept(app core.App, id string) dbx.Params {
	return dbx.Params{"id": id, "since": ago(daysOf(readSettings(app).LocationDays))}
}

// locationHistoryLimit bounds an answer without a page: a minute apart, 2,000 places are a day
// and a half of flight.
const locationHistoryLimit = 2000

// locations answers a character's kept places (GET /api/odyle/locations/{id}) to its owner and
// the members of the rooms it is shared in, while its owner shares: with ?page= (from 1) one
// page of perPage (?perPage=, 20 by default) and how many there are, else the newest 2,000.
func locations(e *core.RequestEvent) error {
	return run(e, func() error {
		c, err := findAs[Character](e.App, "characters", e.Request.PathValue("id"))
		if err != nil {
			return notFound("This character no longer exists.")
		}
		if err := seenBy(e.App, c, e.Auth.Id); err != nil {
			return err
		}
		owner, err := e.App.FindRecordById("users", c.User())
		if err != nil {
			return err
		}
		rules := readSettings(e.App)
		answer := map[string]any{"character": map[string]any{"id": c.Id, "characterName": c.Name()}, "shared": owner.GetBool("shareLocation"), "location": nil, "locations": []any{}, "maps": rules.Maps, "keepDays": rules.LocationDays, "serverNow": now()}
		paged := e.Request.URL.Query().Has("page")
		page, perPage := pageOf(e, 20)
		if paged {
			answer["page"], answer["perPage"], answer["total"], answer["pages"] = page, perPage, 0, 1
		}
		if !owner.GetBool("shareLocation") {
			return e.JSON(200, answer)
		}
		// The latest place too: the history keeps a flight's places a minute apart.
		if raw := c.GetString("location"); raw != "" && raw != "null" {
			answer["location"] = c.Get("location")
		}
		limit, offset := locationHistoryLimit, 0
		if paged {
			total, err := e.App.CountRecords("character_locations", dbx.NewExp("character = {:id} AND created >= {:since}", placesKept(e.App, c.Id)))
			if err != nil {
				return err
			}
			answer["total"], answer["pages"] = total, pages(int(total), perPage)
			limit, offset = perPage, (page-1)*perPage
		}
		if answer["locations"], err = placesOf(e.App, c.Id, limit, offset); err != nil {
			return err
		}
		return e.JSON(200, answer)
	})
}

// unnamedMaps are the map ids of the last 30 days' places that Game settings do not name yet,
// with how many characters were there and when last, for superusers to name.
func unnamedMaps(app core.App, named []gameMap) []any {
	var rows []struct {
		Map        int64  `db:"map"`
		Characters int64  `db:"characters"`
		Last       string `db:"last"`
	}
	if err := app.DB().NewQuery("SELECT map, COUNT(DISTINCT character) AS characters, MAX(created) AS last FROM character_locations WHERE created >= {:since} GROUP BY map ORDER BY last DESC LIMIT 200").Bind(dbx.Params{"since": ago(30 * 24 * time.Hour)}).All(&rows); err != nil {
		warn(app, "Odyle could not list the maps seen", "error", err.Error())
	}
	known := map[int64]bool{}
	for _, m := range named {
		if m.Name != "" {
			known[m.ID] = true
		}
	}
	out := []any{}
	for _, r := range rows {
		if !known[r.Map] {
			out = append(out, map[string]any{"id": r.Map, "label": "Map " + strconv.FormatInt(r.Map, 10), "characters": r.Characters, "lastAt": r.Last})
		}
	}
	return out
}
