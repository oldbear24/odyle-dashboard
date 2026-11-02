package odyle

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// acceptFixtures lets the test adapter's readings in, as a superuser would accept an adapter.
func acceptFixtures(t *testing.T, app core.App) {
	t.Helper()
	if _, err := writeSettings(app, body{"portraitsPaused": true, "adapters": map[string]any{"extra": []any{"test-fixture-v1"}, "disabled": []any{}}}); err != nil {
		t.Fatal(err)
	}
}

func progressNow(t *testing.T, app core.App, userId string) (progress, *core.Record) {
	t.Helper()
	user, err := app.FindRecordById("users", userId)
	if err != nil {
		t.Fatal(err)
	}
	return progressOf(user), user
}

// Readings count what the reader saw: the first reading, a spend, an item; each achievement
// reached gives its spins once, and its item goes to the account's collection.
func TestReadingsReachAchievementsWithTheirSpinsAndItems(t *testing.T) {
	app := newTestApp(t)
	acceptFixtures(t, app)
	player := newUser(t, app, "Daeva")
	auth := tokenOf(t, player)
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	sequence := 0
	read := func(value int64, kind string, delta, base int64) {
		t.Helper()
		sequence++
		ask(t, app, http.MethodPost, "/api/odyle/report", auth, fmt.Sprintf(`{"sessionId":%q,"sequence":%d,"source":"packet","parserVersion":"test-fixture-v1","confirmed":true,"region":"GLOBAL_EU","server":"EU","characterName":"Daeva","value":%d,"kind":%q,"delta":%d,"base":%d,"bonus":%d}`,
			session.Id, sequence, value, kind, delta, base, value-base), 200)
	}
	read(500, "snapshot", 0, 100)
	read(460, "spend", -40, 60)
	read(475, "regen", 15, 75)
	read(515, "item", 40, 75)
	read(515, "update", 0, 75) // the same value again: nothing counts twice
	p, user := progressNow(t, app, player.Id)
	for _, id := range []string{"first-reading", "first-cube", "topped-up"} {
		if p.Unlocked[id] == "" {
			t.Errorf("%s not reached: %+v", id, p)
		}
	}
	if p.Counts["spends"] != 1 || p.Counts["spent"] != 40 || p.Counts["items"] != 1 || p.Counts["days"] != 1 || p.Counts["streak"] != 1 || p.Counts["read"] != 1 {
		t.Fatalf("counts: %v", p.Counts)
	}
	// 2 for the first reading, 1 for the cube, 1 for the item, and the slot machine's spin of the day.
	if user.GetInt("spins") != 5 {
		t.Fatalf("spins: %d", user.GetInt("spins"))
	}
	// A snapshot that dropped (spent on a PC without the reader) counts too; 1,000 spent gives the crate.
	read(15, "snapshot", 0, 15)
	for i := 0; i < 12; i++ {
		read(int64(15+(i+1)*80), "regen", 80, 15)
		read(15, "spend", -80, 15)
	}
	p, user = progressNow(t, app, player.Id)
	if p.Counts["spent"] != 40+500+960 || p.Unlocked["cube-hunter"] == "" || !contains(wardrobeOf(user).Owned, "badge-crate") {
		t.Fatalf("after spending 1,500: %v, owned %v", p.Counts, wardrobeOf(user).Owned)
	}
	// The page: the catalog, the counts, what was reached since the last look, then nothing new.
	got := ask(t, app, http.MethodPost, "/api/odyle/achievements", auth, `{}`, 200)
	if got["seen"] != "" || len(got["unlocked"].(map[string]any)) < 4 || len(got["catalog"].([]any)) != len(achievements) || !contains(anyStrings(got["owned"]), "badge-crate") {
		t.Fatalf("the page: %v", got)
	}
	if again := ask(t, app, http.MethodPost, "/api/odyle/achievements", auth, `{}`, 200); again["seen"] == "" {
		t.Fatalf("not marked seen: %v", again["seen"])
	}
	if p, _ := progressNow(t, app, player.Id); p.unseen() != 0 {
		t.Fatalf("unseen after looking: %d", p.unseen())
	}
	// Rooms carry how many are new; nobody else sees the achievements, only worn items.
	rooms := ask(t, app, http.MethodGet, "/api/odyle/rooms", auth, "", 200)
	if rooms["achievements"].(map[string]any)["new"] != float64(0) {
		t.Fatalf("rooms: %v", rooms["achievements"])
	}
	// The item is worn like a slot machine item; the export lists the progress.
	ask(t, app, http.MethodPost, "/api/odyle/slot-equip", auth, `{"kind":"badge","id":"badge-crate"}`, 200)
	export := ask(t, app, http.MethodGet, "/api/odyle/export", auth, "", 200)
	if export["achievements"].(map[string]any)["counts"].(map[string]any)["spent"] != float64(1500) {
		t.Fatalf("export: %v", export["achievements"])
	}
	// The catalog is open to anyone.
	if public := ask(t, app, http.MethodGet, "/api/odyle/achievements", nil, "", 200); len(public["catalog"].([]any)) != len(achievements) || public["counts"] != nil {
		t.Fatalf("the public catalog: %v", public)
	}
}

func anyStrings(v any) []string {
	out := []string{}
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

// Days the reader read count once each, in a row or not.
func TestReadingDaysCountOnceAndInARow(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Daily")
	day := func(text string) time.Time {
		at, err := time.Parse(time.RFC3339, text)
		if err != nil {
			t.Fatal(err)
		}
		return at
	}
	for _, at := range []string{"2026-10-20T08:00:00Z", "2026-10-20T20:00:00Z", "2026-10-21T06:59:00Z", "2026-10-21T07:00:00Z", "2026-10-22T09:00:00Z", "2026-10-24T09:00:00Z"} {
		countReading(app, player.Id, "", 0, 0, 0, false, day(at))
	}
	// 20th and the 21st before 07:00 are one daily period; then the 21st, the 22nd, a gap, the 24th.
	p, _ := progressNow(t, app, player.Id)
	if p.Counts["days"] != 4 || p.Counts["best"] != 3 || p.Counts["streak"] != 1 || p.Day != "2026-10-24" {
		t.Fatalf("days: %v, day %s", p.Counts, p.Day)
	}
	for _, at := range []string{"2026-10-25T09:00:00Z", "2026-10-26T09:00:00Z", "2026-10-27T09:00:00Z", "2026-10-28T09:00:00Z", "2026-10-29T09:00:00Z", "2026-10-30T09:00:00Z"} {
		countReading(app, player.Id, "", 0, 0, 0, false, day(at))
	}
	if p, _ := progressNow(t, app, player.Id); p.Counts["days"] != 10 || p.Counts["best"] != 7 || p.Unlocked["regular"] == "" || p.Unlocked["on-a-roll"] == "" {
		t.Fatalf("a week in a row: %v %v", p.Counts, p.Unlocked)
	}
}

// Friends who join with an account's link count for it; runs it plans count; what it keeps
// (a PC, a room, a task, push) counts when it looks.
func TestInvitesRunsAndWhatTheAccountKeepsCount(t *testing.T) {
	app := newTestApp(t)
	lead, friend := newUser(t, app, "Lead"), newUser(t, app, "Friend")
	leadAuth, friendAuth := tokenOf(t, lead), tokenOf(t, friend)
	created := ask(t, app, http.MethodPost, "/api/odyle/create", leadAuth, `{"name":"Raid"}`, 200)
	roomId := created["room"].(map[string]any)["id"].(string)
	code := created["invites"].([]any)[0].(map[string]any)["code"].(string)
	ask(t, app, http.MethodPost, "/api/odyle/join", friendAuth, fmt.Sprintf(`{"code":%q}`, code), 200)
	// Opening the link again is no new friend.
	ask(t, app, http.MethodPost, "/api/odyle/join", friendAuth, fmt.Sprintf(`{"code":%q}`, code), 200)
	p, _ := progressNow(t, app, lead.Id)
	if p.Counts["invited"] != 1 || p.Unlocked["recruiter"] == "" || p.Unlocked["party-up"] == "" {
		t.Fatalf("the lead: %v %v", p.Counts, p.Unlocked)
	}
	if p, _ := progressNow(t, app, friend.Id); p.Unlocked["party-up"] == "" || p.Counts["invited"] != 0 {
		t.Fatalf("the friend: %v %v", p.Counts, p.Unlocked)
	}
	ask(t, app, http.MethodPost, "/api/odyle/plan", leadAuth, fmt.Sprintf(`{"roomId":%q,"dungeon":"Fire Temple","startsAt":%q}`, roomId, time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339)), 200)
	if p, _ := progressNow(t, app, lead.Id); p.Counts["planned"] != 1 || p.Unlocked["planner"] == "" {
		t.Fatalf("a planned run: %v", p.Counts)
	}
	saved(t, app, "desktop_devices", map[string]any{"user": friend.Id, "digest": "x", "name": "PC"})
	saved(t, app, "user_tasks", map[string]any{"user": friend.Id, "title": "Daily quests", "cadence": "daily"})
	got := ask(t, app, http.MethodPost, "/api/odyle/achievements", friendAuth, `{}`, 200)
	unlocked := got["unlocked"].(map[string]any)
	for _, id := range []string{"paired", "checklist", "party-up"} {
		if unlocked[id] == nil {
			t.Errorf("%s not reached: %v", id, unlocked)
		}
	}
	if unlocked["open-book"] != nil || unlocked["lucky-find"] != nil {
		t.Fatalf("reached without doing it: %v", unlocked)
	}
	// Finding the slot machine is a secret one: its key comes with the machine's answer, beside
	// the spins of the PC (2), the room (1) and the task (1).
	slots := ask(t, app, http.MethodPost, "/api/odyle/slots", friendAuth, `{}`, 200)
	if p, _ := progressNow(t, app, friend.Id); p.Unlocked["lucky-find"] == "" {
		t.Fatalf("the machine found: %v", p.Unlocked)
	}
	if slots["spins"] != float64(welcomeSpins+defaultSlots().DailySpins+2+1+1) || !contains(anyStrings(slots["owned"]), "badge-key") {
		t.Fatalf("the machine's answer: %v spins, owned %v", slots["spins"], slots["owned"])
	}
}

// An account from before achievements starts with what the server kept.
func TestAchievementsStartFromWhatTheServerKept(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Old")
	c, err := findAs[Character](app, "characters", id)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	addChanges(t, app, id, []int64{800, 760, 680, 700}, []time.Time{now.Add(-50 * time.Hour), now.Add(-49 * time.Hour), now.Add(-26 * time.Hour), now.Add(-time.Hour)})
	if _, err := app.DB().NewQuery("UPDATE character_readings SET kind = 'spend', delta = -80 WHERE character = {:id} AND value = 680").Bind(dbx.Params{"id": id}).Execute(); err != nil {
		t.Fatal(err)
	}
	p, reached, err := achieve(app, c.User(), now, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	// 40 dropped without a kind, 80 spent; three days read.
	if p.Counts["spent"] != 120 || p.Counts["spends"] != 2 || p.Counts["days"] < 2 || !p.Seeded || len(reached) == 0 {
		t.Fatalf("seeded: %v, reached %v", p.Counts, reached)
	}
	// Seeding happens once.
	if again, _, err := achieve(app, c.User(), now, nil, true); err != nil || again.Counts["spent"] != 120 {
		t.Fatalf("seeded again: %v %v", again.Counts, err)
	}
}

// Spins never win the items only achievements give.
func TestTheSlotMachineNeverRollsAchievementItems(t *testing.T) {
	for _, o := range slotOdds {
		pool := slotPool(o.rarity)
		if len(pool) == 0 {
			t.Fatalf("no %s items", o.rarity)
		}
		for _, c := range pool {
			if achievementItem(c.Id) {
				t.Fatalf("%s can be won", c.Id)
			}
		}
	}
	for _, a := range achievements {
		if a.Reward != "" && !achievementItem(a.Reward) {
			t.Fatalf("%s gives %s, which is no achievement item", a.Id, a.Reward)
		}
		if a.Goal < 1 {
			t.Fatalf("%s has no goal", a.Id)
		}
	}
	for _, c := range achievementItems {
		if found, ok := cosmeticById(c.Id); !ok || found != c {
			t.Fatalf("%s is not in the collection", c.Id)
		}
	}
}

// The Odyle the natural pool lost at the cap within a week, from each reading to the next.
func TestLostAtTheCapWithinAWeek(t *testing.T) {
	at := func(text string) time.Time { return mustTime(t, text) }
	from, until, hours := at("2026-10-28T07:00:00Z"), at("2026-11-04T07:00:00Z"), defaultClock().TickHours
	points := []weekPoint{{at("2026-10-28T06:30:00Z"), 800}, {at("2026-10-29T12:00:00Z"), 200}}
	// 800 fills at 13:00 (5 lost), then 7 full ticks; from 200 the 43rd tick fills it (5 lost) and three more are lost.
	if lost, ok := lostAtCap(points, from, until, 840, 15, hours); !ok || lost != 5+7*15+5+3*15 {
		t.Fatalf("lost %d %v", lost, ok)
	}
	// A reading of the week without the natural pool cannot tell.
	if _, ok := lostAtCap(append(points, weekPoint{at("2026-10-30T12:00:00Z"), -1}), from, until, 840, 15, hours); ok {
		t.Fatal("a reading without the pool told")
	}
	// Ticks before the week do not count: of a pool full since the day before, only the tick at the
	// week's start; from empty, the pool does not fill again within the week.
	if lost, _ := lostAtCap([]weekPoint{{at("2026-10-27T06:00:00Z"), 840}, {at("2026-10-28T07:30:00Z"), 0}}, from, until, 840, 15, hours); lost != 15 {
		t.Fatalf("lost before the week: %d", lost)
	}
}

// A week without waste: read on five days, no natural pool at the cap.
func TestAWeekWithoutWaste(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Careful")
	c, err := findAs[Character](app, "characters", id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB().NewQuery("UPDATE characters SET answeredCap = 840 WHERE id = {:id}").Bind(dbx.Params{"id": id}).Execute(); err != nil {
		t.Fatal(err)
	}
	rules := readSettings(app)
	from := mustTime(t, "2026-10-28T07:00:00Z")
	until := from.AddDate(0, 0, 7)
	read := func(days int, base int64) {
		t.Helper()
		if _, err := app.DB().NewQuery("DELETE FROM character_readings WHERE character = {:id}").Bind(dbx.Params{"id": id}).Execute(); err != nil {
			t.Fatal(err)
		}
		for d := 0; d < days; d++ {
			if _, err := app.DB().NewQuery("INSERT INTO character_readings (id, character, value, adapter, parts, created) VALUES ({:id}, {:character}, {:value}, 'test-fixture-v1', {:parts}, {:created})").
				Bind(dbx.Params{"id": core.GenerateDefaultRandomId(), "character": id, "value": base, "parts": fmt.Sprintf(`{"base":%d,"bonus":0}`, base), "created": stamp(from.Add(time.Duration(d)*24*time.Hour + time.Hour))}).Execute(); err != nil {
				t.Fatal(err)
			}
		}
	}
	read(5, 100)
	if clean, err := weekWithoutWaste(app, c.User(), rules, from, until); err != nil || !clean {
		t.Fatalf("five careful days: %v %v", clean, err)
	}
	read(4, 100)
	if clean, _ := weekWithoutWaste(app, c.User(), rules, from, until); clean {
		t.Fatal("four days counted")
	}
	read(5, 830)
	if clean, _ := weekWithoutWaste(app, c.User(), rules, from, until); clean {
		t.Fatal("a full pool counted")
	}
}
