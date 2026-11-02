package odyle

import (
	"encoding/json"
	"strconv"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Achievements (/achievements, src/achievements.js): milestones each account reaches on its
// own, from what the readings of its own characters show and from what it does in Odyle:
// pairing the reader, the first reading, a room, sharing, the Odyle its characters spend on
// cubes, the days the reader reads, friends who join with its invite links, runs it plans and
// a week without a tick lost at the cap. Each one gives slot machine spins (slots.go), some an
// item for the account's name the slot machine never gives. Never ranked or compared: nobody
// else sees an account's achievements, only the items it wears next to its name. The counts come
// from the game's readings and the account's own actions only; nothing can be typed in.

type achievement struct {
	Id      string `json:"id"`
	Group   string `json:"group"`            // start, odyle, habit, party or secret
	Counter string `json:"counter"`          // the count it needs
	Goal    int64  `json:"goal"`             // how much of it
	Spins   int64  `json:"spins"`            // the spins it gives
	Reward  string `json:"reward,omitempty"` // the item it gives (an achievement item of cosmetics)
	Secret  bool   `json:"secret,omitempty"` // hidden until reached
}

// The counts achievements read. What the account keeps now is counted again whenever it looks
// (stateCounts); the rest add up as it happens, since the server deletes what they count from
// (history after 30 days, runs a day after they start, invite links three days after they end).
//
//	paired     PCs paired with the account
//	read       its characters the reader has read
//	rooms      rooms it is in
//	shared     rooms it shares a character in
//	tasks      tasks on its checklists
//	push       devices with push notifications on
//	card       its characters with a player card design chosen
//	discord    rooms it leads that post runs to Discord
//	slots      1 once it found the slot machine
//	legendary  legendary items it won on the slot machine
//	spends     spends of Odyle the reader saw
//	spent      Odyle the reader saw spent
//	items      Odyle items the reader saw used
//	days       daily periods (the game's daily reset) the reader read one of its characters
//	streak     those days in a row, up to the last one
//	best       the most days in a row
//	invited    players who joined a room with an invite link it made
//	planned    runs it planned
//	weeks      reset weeks the reader read on at least five days without a tick lost at the cap
var achievements = []achievement{
	{Id: "paired", Group: "start", Counter: "paired", Goal: 1, Spins: 2},
	{Id: "first-reading", Group: "start", Counter: "read", Goal: 1, Spins: 2},
	{Id: "party-up", Group: "start", Counter: "rooms", Goal: 1, Spins: 1},
	{Id: "open-book", Group: "start", Counter: "shared", Goal: 1, Spins: 1},
	{Id: "checklist", Group: "start", Counter: "tasks", Goal: 1, Spins: 1},
	{Id: "in-the-loop", Group: "start", Counter: "push", Goal: 1, Spins: 1},
	{Id: "show-off", Group: "start", Counter: "card", Goal: 1, Spins: 1},
	{Id: "first-cube", Group: "odyle", Counter: "spends", Goal: 1, Spins: 1},
	{Id: "cube-hunter", Group: "odyle", Counter: "spent", Goal: 1000, Spins: 2, Reward: "badge-crate"},
	{Id: "cube-master", Group: "odyle", Counter: "spent", Goal: 5000, Spins: 3, Reward: "frame-runic"},
	{Id: "odyle-legend", Group: "odyle", Counter: "spent", Goal: 20000, Spins: 5, Reward: "color-legend"},
	{Id: "topped-up", Group: "odyle", Counter: "items", Goal: 1, Spins: 1},
	{Id: "no-waste", Group: "odyle", Counter: "weeks", Goal: 1, Spins: 3, Reward: "badge-droplet"},
	{Id: "regular", Group: "habit", Counter: "days", Goal: 7, Spins: 2},
	{Id: "devoted", Group: "habit", Counter: "days", Goal: 30, Spins: 3, Reward: "badge-candle"},
	{Id: "veteran", Group: "habit", Counter: "days", Goal: 100, Spins: 5, Reward: "frame-laurel"},
	{Id: "on-a-roll", Group: "habit", Counter: "best", Goal: 7, Spins: 3},
	{Id: "recruiter", Group: "party", Counter: "invited", Goal: 1, Spins: 2},
	{Id: "rallying-cry", Group: "party", Counter: "invited", Goal: 5, Spins: 3, Reward: "badge-horn"},
	{Id: "legion-builder", Group: "party", Counter: "invited", Goal: 15, Spins: 5, Reward: "color-banner"},
	{Id: "planner", Group: "party", Counter: "planned", Goal: 1, Spins: 1},
	{Id: "raid-leader", Group: "party", Counter: "planned", Goal: 10, Spins: 3, Reward: "badge-map"},
	{Id: "town-crier", Group: "party", Counter: "discord", Goal: 1, Spins: 1},
	{Id: "lucky-find", Group: "secret", Counter: "slots", Goal: 1, Reward: "badge-key", Secret: true},
	{Id: "jackpot", Group: "secret", Counter: "legendary", Goal: 1, Reward: "badge-jackpot", Secret: true},
}

// The items only achievements give, in the slot machine's collection (cosmetics) but never rolled
// there: worn like the others, next to the account's name in its rooms.
var achievementItems = []cosmetic{
	{"badge-crate", "badge", "rare", "Cube crate", "📦"},
	{"frame-runic", "frame", "epic", "Runic", "runic"},
	{"color-legend", "color", "legendary", "Odyle legend", "linear-gradient(90deg,#b5f2cd,#f3c94a,#fff4c2)"},
	{"badge-droplet", "badge", "epic", "Not a drop", "💧"},
	{"badge-candle", "badge", "rare", "Candle", "🕯️"},
	{"frame-laurel", "frame", "legendary", "Laurel", "laurel"},
	{"badge-horn", "badge", "epic", "Horn", "📯"},
	{"color-banner", "color", "legendary", "Banner", "linear-gradient(90deg,#9fd3ff,#c3a6ff,#ff9a5c)"},
	{"badge-map", "badge", "epic", "Map", "🗺️"},
	{"badge-jackpot", "badge", "legendary", "Jackpot", "🎰"},
	{"badge-key", "badge", "rare", "Secret key", "🗝️"},
}

func init() { cosmetics = append(cosmetics, achievementItems...) }

// achievementItem says whether only an achievement gives the item.
func achievementItem(id string) bool {
	for _, c := range achievementItems {
		if c.Id == id {
			return true
		}
	}
	return false
}

func achievementItemIds() []string {
	out := make([]string, len(achievementItems))
	for i, c := range achievementItems {
		out[i] = c.Id
	}
	return out
}

// A week without waste needs readings on this many of its days, so a week the reader hardly
// ran does not count.
const noWasteDays = 5

// progress is what an account keeps of its achievements (users.achievements, hidden).
type progress struct {
	Counts   map[string]int64  `json:"counts"`
	Day      string            `json:"day,omitempty"`    // the last daily period a reading counted (days, streak)
	Week     string            `json:"week,omitempty"`   // the last reset week checked for a week without waste
	Unlocked map[string]string `json:"unlocked"`         // when each achievement was reached
	Seen     string            `json:"seen,omitempty"`   // when the account last opened its achievements
	Seeded   bool              `json:"seeded,omitempty"` // the counts started from what the server kept
}

func progressOf(user *core.Record) progress {
	p := progress{}
	_ = json.Unmarshal([]byte(user.GetString("achievements")), &p)
	if p.Counts == nil {
		p.Counts = map[string]int64{}
	}
	if p.Unlocked == nil {
		p.Unlocked = map[string]string{}
	}
	return p
}

// unseen is how many achievements the account reached since it last looked.
func (p progress) unseen() int {
	n := 0
	for _, at := range p.Unlocked {
		if at > p.Seen {
			n++
		}
	}
	return n
}

// achievementNotice tells the account's open dashboards of an achievement it reached.
type achievementNotice struct {
	Id     string `json:"id"`
	Spins  int64  `json:"spins"`
	Reward string `json:"reward,omitempty"`
}

// progressEdit edits an account's progress before achieve reaches what it can.
type progressEdit func(p *progress)

// achieve brings an account's achievements up to date inside the caller's transaction. The first
// time it starts the counts from what the server kept (seedProgress); then it applies the edit,
// and with full set counts what the account keeps now and checks the last reset week for one
// without waste. It reaches every achievement whose goal is met: its spins and item go to the
// account and its open dashboards hear of it. Only these fields are written, so a save of the
// account elsewhere in the request must come before.
func achieve(app core.App, userId string, at time.Time, edit progressEdit, full bool) (progress, []achievement, error) {
	user, err := app.FindRecordById("users", userId)
	if err != nil {
		return progress{}, nil, err
	}
	p := progressOf(user)
	if !p.Seeded {
		if err := seedProgress(app, userId, &p, at); err != nil {
			return p, nil, err
		}
		p.Seeded = true
	}
	if edit != nil {
		edit(&p)
	}
	if full {
		counts, err := stateCounts(app, user)
		if err != nil {
			return p, nil, err
		}
		for k, v := range counts {
			p.Counts[k] = max(p.Counts[k], v)
		}
		if err := checkWeek(app, userId, &p, at); err != nil {
			return p, nil, err
		}
	}
	reached := []achievement{}
	for _, a := range achievements {
		if _, done := p.Unlocked[a.Id]; !done && p.Counts[a.Counter] >= a.Goal {
			p.Unlocked[a.Id] = stamp(at)
			reached = append(reached, a)
		}
	}
	if err := grant(app, user, reached); err != nil {
		return p, nil, err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return p, nil, err
	}
	if string(raw) != user.GetString("achievements") {
		if _, err := app.DB().NewQuery("UPDATE users SET achievements = {:p} WHERE id = {:id}").Bind(dbx.Params{"p": string(raw), "id": userId}).Execute(); err != nil {
			return p, nil, err
		}
	}
	if len(reached) > 0 {
		notices := make([]achievementNotice, len(reached))
		for i, a := range reached {
			notices[i] = achievementNotice{Id: a.Id, Spins: a.Spins, Reward: a.Reward}
		}
		changes(app).user(app, userId, func(n *userNews) { n.achievements = append(n.achievements, notices...) })
	}
	return p, reached, nil
}

// grant gives the account the spins and items of the achievements it reached.
func grant(app core.App, user *core.Record, reached []achievement) error {
	spins, items := int64(0), []string{}
	for _, a := range reached {
		spins += a.Spins
		if a.Reward != "" {
			items = append(items, a.Reward)
		}
	}
	if spins > 0 {
		if _, err := app.DB().NewQuery("UPDATE users SET spins = spins + {:spins} WHERE id = {:id}").Bind(dbx.Params{"spins": spins, "id": user.Id}).Execute(); err != nil {
			return err
		}
	}
	if len(items) == 0 {
		return nil
	}
	w := wardrobeOf(user)
	for _, id := range items {
		if !contains(w.Owned, id) {
			w.Owned = append(w.Owned, id)
		}
	}
	raw, err := json.Marshal(w)
	if err != nil {
		return err
	}
	_, err = app.DB().NewQuery("UPDATE users SET cosmetics = {:c} WHERE id = {:id}").Bind(dbx.Params{"c": string(raw), "id": user.Id}).Execute()
	return err
}

// achieved is achieve for the routes whose own work comes first: a failure is logged and leaves
// that work as it is. It answers the achievements reached now.
func achieved(app core.App, userId string, edit progressEdit, full bool) []achievement {
	if userId == "" {
		return nil
	}
	_, reached, err := achieve(app, userId, time.Now(), edit, full)
	if err != nil {
		warn(app, "Odyle achievements failed", "user", userId, "error", err.Error())
	}
	return reached
}

// adding adds to counts of the progress.
func adding(add map[string]int64) progressEdit {
	return func(p *progress) {
		for k, v := range add {
			p.Counts[k] += v
		}
	}
}

// stateCounts counts what the account keeps now.
func stateCounts(app core.App, user *core.Record) (map[string]int64, error) {
	out := map[string]int64{}
	params := dbx.Params{"user": user.Id}
	for name, query := range map[string]string{
		"paired":  "SELECT COUNT(*) FROM desktop_devices WHERE user = {:user}",
		"read":    "SELECT COUNT(*) FROM characters WHERE user = {:user} AND lastReadingAt != ''",
		"rooms":   "SELECT COUNT(*) FROM room_members WHERE user = {:user}",
		"tasks":   "SELECT COUNT(*) FROM user_tasks WHERE user = {:user}",
		"push":    "SELECT COUNT(*) FROM push_subscriptions WHERE user = {:user}",
		"card":    "SELECT COUNT(*) FROM characters WHERE user = {:user} AND cardDesign != ''",
		"discord": "SELECT COUNT(*) FROM party_rooms WHERE owner = {:user} AND discordWebhook != ''",
	} {
		var n int64
		if err := app.DB().NewQuery(query).Bind(params).Row(&n); err != nil {
			return nil, err
		}
		out[name] = n
	}
	memberships, err := allAs[Member](app, "room_members", "user = {:user}", params)
	if err != nil {
		return nil, err
	}
	for _, m := range memberships {
		if len(m.Shared()) > 0 {
			out["shared"]++
		}
	}
	w := wardrobeOf(user)
	if w.Started {
		out["slots"] = 1
	}
	for _, id := range w.Owned {
		if c, ok := cosmeticById(id); ok && !achievementItem(id) && c.Rarity == "legendary" {
			out["legendary"]++
		}
	}
	return out, nil
}

// spentBy is the Odyle a change spent, as the room's week counts it (weekly.go): a spend the app
// named, else a drop from the reading before for a change without its kind (older apps) or a
// login reading.
func spentBy(kind string, delta, before, after int64) int64 {
	switch {
	case kind == "spend":
		return max(delta, -delta)
	case kind == "regen" || kind == "item":
		return 0
	case before > after:
		return before - after
	}
	return 0
}

// countReading counts a reading of one of the account's characters: the daily period the reader
// read (days, streak), what the change spent or an item added, and a character read for the
// first time (a full check: first-reading). Most readings change none of it; those that come on
// a day already counted, spend nothing and add no item cost no query.
func countReading(app core.App, userId, kind string, delta, before, after int64, first bool, at time.Time) {
	day := spinDay(at, readSettings(app).DailyResetHour)
	spent, item := spentBy(kind, delta, before, after), kind == "item" && delta > 0
	if counted, _ := stateOf(app).achievementDays.Load(userId); counted == day && spent == 0 && !item && !first {
		return
	}
	_, _, err := achieve(app, userId, at, func(p *progress) {
		if p.Day != day {
			if p.Day == previousDay(day) {
				p.Counts["streak"]++
			} else {
				p.Counts["streak"] = 1
			}
			p.Counts["days"]++
			p.Counts["best"] = max(p.Counts["best"], p.Counts["streak"])
			p.Day = day
		}
		if spent > 0 {
			p.Counts["spends"]++
			p.Counts["spent"] += spent
		}
		if item {
			p.Counts["items"]++
		}
	}, first)
	if err != nil {
		warn(app, "Odyle achievements failed", "user", userId, "error", err.Error())
		return
	}
	afterCommit(app, func(app core.App) { stateOf(app).achievementDays.Store(userId, day) })
}

// previousDay is the daily period before day (both as spinDay names them).
func previousDay(day string) string {
	at, err := time.Parse("2006-01-02", day)
	if err != nil {
		return ""
	}
	return at.AddDate(0, 0, -1).Format("2006-01-02")
}

// seedProgress starts an account's counts from what the server still keeps: the Odyle history of
// its characters (spends, items and the days they were read), the invite links it made and the
// runs it planned that are still kept.
func seedProgress(app core.App, userId string, p *progress, at time.Time) error {
	rules := readSettings(app)
	params := dbx.Params{"user": userId}
	var totals struct {
		Spends int64 `db:"spends"`
		Spent  int64 `db:"spent"`
		Items  int64 `db:"items"`
	}
	query := "SELECT COALESCE(SUM(CASE WHEN spent > 0 THEN 1 ELSE 0 END), 0) AS spends, COALESCE(SUM(spent), 0) AS spent, COALESCE(SUM(CASE WHEN kind = 'item' AND delta > 0 THEN 1 ELSE 0 END), 0) AS items FROM (" +
		"SELECT kind, delta, CASE WHEN kind = 'spend' THEN ABS(delta) WHEN kind IN ('regen', 'item') THEN 0 WHEN previous > value THEN previous - value ELSE 0 END AS spent FROM (" +
		"SELECT kind, delta, value, LAG(value) OVER (PARTITION BY character ORDER BY created) AS previous FROM character_readings WHERE character IN (SELECT id FROM characters WHERE user = {:user})))"
	if err := app.DB().NewQuery(query).Bind(params).One(&totals); err != nil {
		return err
	}
	p.Counts["spends"] += totals.Spends
	p.Counts["spent"] += totals.Spent
	p.Counts["items"] += totals.Items
	// The days the reader read, as daily periods of the game's reset hour.
	var days []struct {
		Day string `db:"day"`
	}
	params["shift"] = "-" + strconv.FormatInt(rules.DailyResetHour, 10) + " hours"
	if err := app.DB().NewQuery("SELECT DISTINCT date(created, {:shift}) AS day FROM character_readings WHERE character IN (SELECT id FROM characters WHERE user = {:user}) ORDER BY day").Bind(params).All(&days); err != nil {
		return err
	}
	run := int64(0)
	for i, d := range days {
		if i > 0 && previousDay(d.Day) == days[i-1].Day {
			run++
		} else {
			run = 1
		}
		p.Counts["best"] = max(p.Counts["best"], run)
	}
	if len(days) > 0 && days[len(days)-1].Day > p.Day {
		p.Counts["days"] += int64(len(days))
		p.Counts["streak"], p.Day = run, days[len(days)-1].Day
	}
	var invited, planned int64
	if err := app.DB().NewQuery("SELECT COALESCE(SUM(uses), 0) FROM room_invites WHERE createdBy = {:user}").Bind(params).Row(&invited); err != nil {
		return err
	}
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM room_runs WHERE plannedBy IN (SELECT id FROM room_members WHERE user = {:user})").Bind(params).Row(&planned); err != nil {
		return err
	}
	p.Counts["invited"] += invited
	p.Counts["planned"] += planned
	return nil
}

// checkWeek checks the last whole reset week once: it counts as a week without waste when the
// reader read the account's characters on at least noWasteDays of its days and the Odyle clock
// saw none of their natural pools lose a tick at the cap (lostAtCap).
func checkWeek(app core.App, userId string, p *progress, at time.Time) error {
	rules := readSettings(app)
	start := weekStart(at, rules.DailyResetHour, rules.WeeklyResetDay).AddDate(0, 0, -7)
	key := start.Format("2006-01-02")
	if p.Week >= key {
		return nil
	}
	p.Week = key
	if rules.Clock.Paused {
		return nil
	}
	clean, err := weekWithoutWaste(app, userId, rules, start, start.AddDate(0, 0, 7))
	if err != nil {
		return err
	}
	if clean {
		p.Counts["weeks"]++
	}
	return nil
}

// weekWithoutWaste says whether the account's characters were read on at least noWasteDays days
// of the week [from, until) and none of their natural pools lost a tick at the cap in it, as the
// clock projects from their readings. A character whose cap is not settled, or whose readings
// do not carry the natural pool, cannot tell, so the week does not count while it was read then.
func weekWithoutWaste(app core.App, userId string, rules settings, from, until time.Time) (bool, error) {
	owned, err := charactersWhere(app, "user = {:user}", dbx.Params{"user": userId})
	if err != nil {
		return false, err
	}
	days, told := map[string]bool{}, false
	for _, c := range owned {
		points, err := weekReadings(app, c.Id, from, until)
		if err != nil {
			return false, err
		}
		inWeek := false
		for _, r := range points {
			if !r.at.Before(from) {
				inWeek = true
				days[spinDay(r.at, rules.DailyResetHour)] = true
			}
		}
		if !inWeek {
			continue
		}
		caps := capsFor(c.GetInt64("answeredCap"), c.GetInt64("naturalMax"), rules.Clock.Caps)
		if len(caps) != 1 {
			return false, nil
		}
		lost, ok := lostAtCap(points, from, until, caps[0], tickFor(c.GetInt64("regenTick"), rules.Clock), rules.Clock.TickHours)
		if !ok || lost > 0 {
			return false, nil
		}
		told = true
	}
	return told && len(days) >= noWasteDays, nil
}

// weekPoint is one reading for the week's projections: when, and its natural pool (-1 without).
type weekPoint struct {
	at   time.Time
	base int64
}

// weekReadings are a character's readings of the week [from, until) after the last one before it.
func weekReadings(app core.App, characterId string, from, until time.Time) ([]weekPoint, error) {
	var rows []struct {
		Parts   string `db:"parts"`
		Created string `db:"created"`
	}
	params := dbx.Params{"id": characterId, "from": stamp(from), "until": stamp(until)}
	query := "SELECT COALESCE(parts, '') AS parts, created FROM character_readings WHERE character = {:id} AND created >= (SELECT COALESCE(MAX(created), '') FROM character_readings WHERE character = {:id} AND created < {:from}) AND created < {:until} ORDER BY created"
	if err := app.DB().NewQuery(query).Bind(params).All(&rows); err != nil {
		return nil, err
	}
	out := make([]weekPoint, 0, len(rows))
	for _, r := range rows {
		at, err := time.Parse(stampLayout, r.Created)
		if err != nil {
			continue
		}
		var parts storedParts
		base := int64(-1)
		if json.Unmarshal([]byte(r.Parts), &parts) == nil && parts.Base != nil {
			base = *parts.Base
		}
		out = append(out, weekPoint{at, base})
	}
	return out, nil
}

// lostAtCap is the Odyle the natural pool lost at the cap within [from, until), projected from
// each reading to the next as the clock does (src/history.js capWeeks): it grows by tick at the
// tick hours up to cap, and each tick that does not fit is lost. ok is false when a reading of
// the week carries no natural pool.
func lostAtCap(points []weekPoint, from, until time.Time, cap, tick int64, hours []int64) (int64, bool) {
	lost := int64(0)
	for i, r := range points {
		if r.base < 0 {
			if !r.at.Before(from) {
				return 0, false
			}
			continue
		}
		end := until
		if i+1 < len(points) && points[i+1].at.Before(until) {
			end = points[i+1].at
		}
		if !end.After(from) {
			continue
		}
		pool := r.base
		for _, at := range clockTicks(r.at, end, hours, 1<<20) {
			if pool+tick > cap && !at.Before(from) && at.Before(until) {
				lost += pool + tick - max(pool, cap)
			}
			pool = max(pool, min(cap, pool+tick))
		}
	}
	return lost, true
}

// achievementsAnswer is what the achievements page shows: the catalog with the items it gives,
// the account's counts, what it reached and when it last looked, and its collection for wearing
// what it got.
func achievementsAnswer(app core.App, user *core.Record, p progress, seen string) map[string]any {
	w := wardrobeOf(user)
	return map[string]any{"catalog": achievements, "items": achievementItems, "counts": p.Counts, "unlocked": p.Unlocked, "seen": seen, "owned": w.Owned, "equipped": w.Equipped, "found": w.Started, "noWasteDays": noWasteDays}
}

// GET /api/odyle/achievements: the catalog with the items it gives, for anyone.
func achievementsCatalog(e *core.RequestEvent) error {
	return e.JSON(200, map[string]any{"catalog": achievements, "items": achievementItems, "noWasteDays": noWasteDays})
}

// POST /api/odyle/achievements: the account's achievements, brought up to date and marked seen;
// `seen` says when the account looked before, so the page marks what it reached since.
func achievementsRoute(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, _ body, _ *[]string) (any, error) {
		at, seen := time.Now(), ""
		p, _, err := achieve(app, user.Id, at, func(p *progress) { seen, p.Seen = p.Seen, stamp(at) }, true)
		if err != nil {
			return nil, err
		}
		fresh, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		return achievementsAnswer(app, fresh, p, seen), nil
	})
}
