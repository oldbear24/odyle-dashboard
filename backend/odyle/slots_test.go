package odyle

import (
	"net/http"
	"testing"
	"time"
)

// The slot machine (#107): welcome spins once, free spins every day, a spin a day per character read, spins that win
// items (a duplicate gives a shard), equipping only what the account owns, and rooms seeing it.
func TestTheSlotMachineEarnsSpinsAndWinsCosmetics(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Spinner")
	room := saved(t, app, "party_rooms", map[string]any{"owner": player.Id, "name": "Casino", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "owner"})
	auth := tokenOf(t, player)
	post := func(action, body string, status int) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodPost, "/api/odyle/"+action, auth, body, status)
	}
	daily := defaultSlots().DailySpins
	if got := post("slots", `{}`, 200); got["spins"] != float64(welcomeSpins+daily) || got["daily"] != float64(daily) || len(got["catalog"].([]any)) != len(cosmetics) {
		t.Fatalf("first visit: %v (%v free)", got["spins"], got["daily"])
	}
	if got := post("slots", `{}`, 200); got["spins"] != float64(welcomeSpins+daily) {
		t.Fatalf("welcome or free spins twice: %v", got["spins"])
	}
	// A character read earns one spin a day, however many readings come; another character one more.
	at := time.Now()
	for _, name := range []string{"One", "One", "Two"} {
		found, err := app.FindFirstRecordByFilter("characters", "user = {:user} && characterName = {:name}", map[string]any{"user": player.Id, "name": name})
		var c *Character
		if err != nil {
			c = viewOf[Character](saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": name, "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true}))
		} else {
			c = viewOf[Character](found)
		}
		if err := grantDailySpin(app, c, at); err != nil {
			t.Fatal(err)
		}
	}
	if got := post("slots", `{}`, 200); got["spins"] != float64(welcomeSpins+daily+2) {
		t.Fatalf("two characters read today: %v", got["spins"])
	}
	// Spending every spin: the free ones first; most win nothing, a win is an item or a shard; none is left after.
	if got := post("slot-spin", `{}`, 200); got["daily"] != float64(daily-1) {
		t.Fatalf("a spin did not take a free one first: %v", got["daily"])
	}
	for i := 1; i < int(welcomeSpins+daily)+2; i++ {
		got := post("slot-spin", `{}`, 200)
		if got["lost"] == true {
			if got["won"] != nil {
				t.Fatalf("a lost spin won %v", got["won"])
			}
			continue
		}
		if won, _ := got["won"].(map[string]any); won["id"] == "" || got["duplicate"] == nil {
			t.Fatalf("spin %d: %v", i, got)
		}
	}
	left := post("slots", `{}`, 200)
	if left["spins"].(float64) > 1 || left["winChance"] != float64(slotWinChance) {
		t.Fatalf("spins left: %v, chance %v", left["spins"], left["winChance"])
	}
	if left["spins"] == float64(0) {
		post("slot-spin", `{}`, 400)
	}
	// Wearing an owned item; rooms see it next to the name. (Spins rarely win, so the test gives one.)
	if len(left["owned"].([]any)) == 0 {
		u, err := app.FindRecordById("users", player.Id)
		if err != nil {
			t.Fatal(err)
		}
		w := wardrobeOf(u)
		w.Owned = append(w.Owned, "badge-crown")
		u.Set("cosmetics", w)
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
		left = post("slots", `{}`, 200)
	}
	first := left["owned"].([]any)[0].(string)
	item, _ := cosmeticById(first)
	post("slot-equip", `{"kind":"`+item.Kind+`","id":"`+first+`"}`, 200)
	post("slot-equip", `{"kind":"badge","id":"badge-not-owned"}`, 400)
	post("slot-equip", `{"kind":"hat","id":""}`, 400)
	members := ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, auth, "", 200)["members"].([]any)
	look, _ := members[0].(map[string]any)["look"].(map[string]any)
	if look[item.Kind] != item.Value {
		t.Fatalf("look %v, want %s %s", look, item.Kind, item.Value)
	}
	// The record API never shows the hidden fields.
	if self := ask(t, app, http.MethodGet, "/api/collections/users/records/"+player.Id, auth, "", 200); self["spins"] != nil || self["cosmetics"] != nil {
		t.Fatalf("hidden fields answered: %v", self)
	}
}

func TestSpinDaysFollowTheDailyReset(t *testing.T) {
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	for _, c := range []struct{ at, want string }{{"2026-10-18T06:59:00Z", "2026-10-17"}, {"2026-10-18T07:00:00Z", "2026-10-18"}, {"2026-10-18T23:00:00Z", "2026-10-18"}} {
		if got := spinDay(at(c.at), 7); got != c.want {
			t.Errorf("spinDay(%s) = %s, want %s", c.at, got, c.want)
		}
	}
}

// The daily free spins (#107) follow the game settings: they come once a daily period, unused ones
// lapse at the next, a lowered allowance takes effect at once, and the spins per character read
// can be turned off.
func TestFreeSpinsFollowTheSettings(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Daily")
	auth := tokenOf(t, player)
	spins := func() (float64, float64) {
		t.Helper()
		got := ask(t, app, http.MethodPost, "/api/odyle/slots", auth, `{}`, 200)
		return got["spins"].(float64), got["daily"].(float64)
	}
	if _, err := writeSettings(app, body{"slots": map[string]any{"dailySpins": float64(5), "perCharacter": float64(0)}}); err != nil {
		t.Fatal(err)
	}
	if all, free := spins(); all != float64(welcomeSpins+5) || free != 5 {
		t.Fatalf("five free spins: %v (%v free)", all, free)
	}
	// Yesterday's unused free spins lapse: a new period gives the allowance again, never more.
	u, err := app.FindRecordById("users", player.Id)
	if err != nil {
		t.Fatal(err)
	}
	w := wardrobeOf(u)
	w.Day, w.Daily = "2000-01-01", 1
	u.Set("cosmetics", w)
	if err := app.Save(u); err != nil {
		t.Fatal(err)
	}
	if all, free := spins(); all != float64(welcomeSpins+5) || free != 5 {
		t.Fatalf("a new day: %v (%v free)", all, free)
	}
	if _, err := writeSettings(app, body{"slots": map[string]any{"dailySpins": float64(2), "perCharacter": float64(0)}}); err != nil {
		t.Fatal(err)
	}
	if all, free := spins(); all != float64(welcomeSpins+2) || free != 2 {
		t.Fatalf("a lowered allowance: %v (%v free)", all, free)
	}
	// No spins per character read.
	c := viewOf[Character](saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Reader", "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true}))
	if err := grantDailySpin(app, c, time.Now()); err != nil {
		t.Fatal(err)
	}
	if all, _ := spins(); all != float64(welcomeSpins+2) {
		t.Fatalf("a character read earned a spin turned off: %v", all)
	}
	for _, wrong := range []map[string]any{{"dailySpins": float64(21), "perCharacter": float64(1)}, {"dailySpins": float64(3)}, {"dailySpins": float64(-1), "perCharacter": float64(1)}} {
		if _, err := writeSettings(app, body{"slots": wrong}); err == nil {
			t.Fatalf("slot rules %v saved", wrong)
		}
	}
	if got := readSettings(app).Slots; got.DailySpins != 2 || got.PerCharacter != 0 {
		t.Fatalf("slot rules: %+v", got)
	}
}
