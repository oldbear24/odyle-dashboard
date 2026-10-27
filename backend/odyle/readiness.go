package odyle

import (
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Party readiness on the server (#15): the rules of src/readiness.js and src/runready.js, which
// the Windows app mirrors in Odyle.Core.PartyReadiness; all three run the shared cases in
// tests/readiness-vectors.json. Odyle cannot be pooled: each player brings one character, their
// best live one, and the party can only do as many cubes as its lowest player allows. Stale,
// offline and unread characters keep their saved values but count for nothing. A run's Discord
// post counts with them how many of those going can claim a cube (#46).

// readyEntry is one character of a room as the rules see it; an entry without a character name
// is a member without a character there.
type readyEntry struct {
	ID            string `json:"id"`
	User          string `json:"user"`
	Role          string `json:"role"`
	CharacterName string `json:"characterName"`
	Value         int64  `json:"value"`
	Confirmed     bool   `json:"confirmed"`
	Valid         *bool  `json:"valid"`
	Source        string `json:"source"`
	Sharing       bool   `json:"sharing"`
	LastSeenAt    string `json:"lastSeenAt"`
	LastReadingAt string `json:"lastReadingAt"`
	// For the Odyle clock: the game's two numbers of the last reading and what the readings showed.
	Base, Bonus                        *int64
	RegenTick, NaturalMax, AnsweredCap int64
}

// readyState is live, stale, offline or unknown (src/model.js status). Readings are sent only when
// the value changes; the reader's heartbeat keeps an unchanged value live.
func readyState(e readyEntry, now time.Time) string {
	if !e.Sharing {
		return "offline"
	}
	if !e.Confirmed || e.LastReadingAt == "" {
		return "unknown"
	}
	seen, ok := parseDate(e.LastSeenAt)
	if !ok || now.Sub(seen) >= 90*time.Second {
		return "offline"
	}
	if e.Valid != nil && !*e.Valid || e.Source == "manual" || now.Sub(seen) >= 45*time.Second {
		return "stale"
	}
	return "live"
}

// characterReady is one character at a cost: its state, whether its value is known, the cubes
// that value holds and whether it is ready (live with enough for a cube).
func characterReady(e readyEntry, now time.Time, cost int64) (state string, known bool, cubes int64, ready bool) {
	state, known = readyState(e, now), e.Confirmed && e.LastReadingAt != ""
	if known {
		cubes = e.Value / cost
	}
	return state, known, cubes, state == "live" && e.Value >= cost
}

// partyResult is a room's party at a cost (src/readiness.js party).
type partyResult struct {
	Characters, Live, Ready, Players []readyEntry
	Lowest                           *readyEntry
	Cubes                            int64
	Uncounted                        []string
}

func partyOf(entries []readyEntry, now time.Time, cost int64) partyResult {
	out := partyResult{Characters: []readyEntry{}, Live: []readyEntry{}, Ready: []readyEntry{}, Players: []readyEntry{}, Uncounted: []string{}}
	best, order := map[string]int{}, []string{}
	for _, e := range entries {
		if e.CharacterName == "" {
			continue
		}
		out.Characters = append(out.Characters, e)
		if readyState(e, now) != "live" {
			continue
		}
		out.Live = append(out.Live, e)
		if e.Value >= cost {
			out.Ready = append(out.Ready, e)
		}
		// Each player's best live character; a tie keeps the one listed first.
		if at, seen := best[e.User]; !seen {
			best[e.User] = len(out.Players)
			out.Players = append(out.Players, e)
			order = append(order, e.User)
		} else if e.Value > out.Players[at].Value {
			out.Players[at] = e
		}
	}
	for i := range out.Players {
		if out.Lowest == nil || out.Players[i].Value < out.Lowest.Value {
			out.Lowest = &out.Players[i]
		}
	}
	if out.Lowest != nil {
		out.Cubes = out.Lowest.Value / cost
	}
	counted, listed := map[string]bool{}, map[string]bool{}
	for _, user := range order {
		counted[user] = true
	}
	for _, e := range entries {
		if e.Role == "viewer" || listed[e.User] {
			continue
		}
		listed[e.User] = true
		if !counted[e.User] {
			out.Uncounted = append(out.Uncounted, e.User)
		}
	}
	return out
}

// valueAt is the value a character is expected to hold at a moment (src/runready.js valueAt):
// its value now if live and the moment is now, else the Odyle clock's projection from its last
// reading (natural regeneration only, an estimate), else its last saved value.
func valueAt(e readyEntry, at, now time.Time, rules clockRules) int64 {
	if !at.After(now) && readyState(e, now) == "live" {
		return e.Value
	}
	if rules.Paused || e.Base == nil || e.Bonus == nil {
		return e.Value
	}
	from, ok := parseDate(e.LastReadingAt)
	caps := capsFor(e.AnsweredCap, e.NaturalMax, rules.Caps)
	if !ok || len(caps) == 0 {
		return e.Value
	}
	ticks := int64(len(clockTicks(from, at, rules.TickHours, 60*8)))
	return projectBase(*e.Base, ticks, tickFor(e.RegenTick, rules), caps[0]) + *e.Bonus
}

// broughtBy is the character an attendee brings: their pick, else their best live one, else
// their best known one (src/runready.js broughtBy).
func broughtBy(user string, entries []readyEntry, now time.Time, pick string) *readyEntry {
	var live, known *readyEntry
	for i := range entries {
		e := &entries[i]
		if e.User != user || e.CharacterName == "" {
			continue
		}
		if pick != "" && e.ID == pick {
			return e
		}
		if readyState(*e, now) == "live" && (live == nil || e.Value > live.Value) {
			live = e
		}
		if e.Confirmed && e.LastReadingAt != "" && (known == nil || e.Value > known.Value) {
			known = e
		}
	}
	if live != nil {
		return live
	}
	return known
}

// runCost is what a cube of a run's dungeon costs: its catalog cost, else the server-wide Odyle
// per cube (src/main.js costOf).
func runCost(rules settings, dungeon string) int64 {
	key := strings.ToLower(strings.Join(strings.Fields(dungeon), " "))
	for _, d := range rules.Dungeons {
		if d.Cost > 0 && strings.ToLower(strings.Join(strings.Fields(d.Name), " ")) == key {
			return d.Cost
		}
	}
	if rules.OdylePerCube > 0 {
		return rules.OdylePerCube
	}
	return 40
}

// runParty splits those going to a run (#45): the first as many as its dungeon's party size in the
// catalog, in the order they answered Going, make its party; the rest wait for a place, first come
// first. Without a party size everyone going is the party (src/runs.js runParty).
func runParty(rules settings, r *Run) (party, waiting []string) {
	going, size := r.Attendees(), int64(0)
	key := strings.ToLower(strings.Join(strings.Fields(r.Dungeon()), " "))
	for _, d := range rules.Dungeons {
		if strings.ToLower(strings.Join(strings.Fields(d.Name), " ")) == key {
			size = d.PartySize
		}
	}
	if size <= 0 || int64(len(going)) <= size {
		return going, []string{}
	}
	return going[:size], going[size:]
}

// runClaims counts the members of a run's party (runParty) who can claim a cube at its start
// (now, once it has started): live with enough now, or expected to hold enough by then.
func runClaims(r *Run, party []string, entries []readyEntry, users map[string]string, now time.Time, cost int64, rules clockRules) (claim, of int) {
	start, ok := parseDate(r.StartsAt())
	if !ok || start.Before(now) {
		start = now
	}
	picks := r.Picks()
	for _, member := range party {
		user, known := users[member]
		if !known {
			continue
		}
		of++
		if c := broughtBy(user, entries, now, picks[member]); c != nil && valueAt(*c, start, now, rules) >= cost {
			claim++
		}
	}
	return claim, of
}

// roomEntries are a room's characters as the rules see them (src/main.js flattened): each
// member's characters shared in the room, with presence from the readers' heartbeats, and a
// member without one as an entry without a character; users maps memberships to accounts.
func roomEntries(app core.App, roomId string) (entries []readyEntry, users map[string]string, err error) {
	members, err := roomMembers(app, roomId)
	if err != nil {
		return nil, nil, err
	}
	users, ids := map[string]string{}, []any{}
	for _, m := range members {
		users[m.Id] = m.User()
		ids = append(ids, m.User())
	}
	owned := map[string][]*Character{}
	if len(ids) > 0 {
		found, err := app.FindAllRecords("characters", dbx.In("user", ids...))
		if err != nil {
			return nil, nil, err
		}
		for _, c := range views[Character](found) {
			owned[c.User()] = append(owned[c.User()], c)
		}
	}
	for _, m := range members {
		added := false
		for _, c := range owned[m.User()] {
			if !m.Shares(c.Id) {
				continue
			}
			present(app, c)
			valid := c.GetBool("valid")
			e := readyEntry{ID: c.Id, User: m.User(), Role: m.Role(), CharacterName: c.Name(), Value: c.Value(), Confirmed: c.Confirmed(), Valid: &valid, Source: c.GetString("source"),
				Sharing: true, LastSeenAt: c.GetString("lastSeenAt"), LastReadingAt: c.GetString("lastReadingAt"),
				RegenTick: c.GetInt64("regenTick"), NaturalMax: c.GetInt64("naturalMax"), AnsweredCap: c.GetInt64("answeredCap")}
			if base, bonus, ok := c.naturalParts(); ok {
				e.Base, e.Bonus = &base, &bonus
			}
			entries = append(entries, e)
			added = true
		}
		if !added {
			entries = append(entries, readyEntry{User: m.User(), Role: m.Role()})
		}
	}
	return entries, users, nil
}
