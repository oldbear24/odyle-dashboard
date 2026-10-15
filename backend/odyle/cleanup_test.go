package odyle

import (
	"testing"
	"time"

	"github.com/pocketbase/dbx"
)

func TestCleanupPurgesWhatExpired(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Keeper")
	room := saved(t, app, "party_rooms", map[string]any{"owner": user.Id, "name": "Kept room", "cost": 40})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": user.Id, "role": "owner"})
	character := saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": "Keeper", "server": "Lumiel", "region": "GLOBAL_EU"})
	at := time.Now()
	// The given created or startsAt time, written the way the test build ages records.
	age := func(collection, field, id string, when time.Time) {
		if _, err := app.DB().NewQuery("UPDATE {{" + collection + "}} SET [[" + field + "]] = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": stamp(when), "id": id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 7 {
		point := saved(t, app, "character_readings", map[string]any{"character": character.Id, "value": i})
		if i < 5 {
			age("character_readings", "created", point.Id, at.Add(-31*24*time.Hour))
		}
	}
	for i := range 4 {
		starts := at.Add(-48 * time.Hour)
		if i == 3 {
			starts = at.Add(24 * time.Hour)
		}
		saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(starts), "plannedBy": member.Id, "attendees": []string{member.Id}})
	}
	for i, expires := range []time.Time{at.Add(-time.Minute), at.Add(-time.Hour), at.Add(time.Hour)} {
		saved(t, app, "room_invites", map[string]any{"room": room.Id, "digest": "invite" + string(rune('a'+i)), "role": "reporter", "expiresAt": stamp(expires)})
		saved(t, app, "desktop_codes", map[string]any{"user": user.Id, "digest": "code" + string(rune('a'+i)), "expiresAt": stamp(expires)})
	}
	// Two rows a statement and two statements a run: a backlog takes more than one run.
	purgeBatch, purgeBatches = 2, 2
	t.Cleanup(func() { purgeBatch, purgeBatches = 1000, 50 })
	first, err := cleanup(app)
	if err != nil {
		t.Fatal(err)
	}
	// 2 invites + 2 codes + 4 of the 5 old readings + 3 old runs.
	if first["done"] != 11 {
		t.Fatalf("first run did %v", first["done"])
	}
	if n := countOf(t, app, "character_readings"); n != 3 {
		t.Fatalf("%d readings after the first run", n)
	}
	second, err := cleanup(app)
	if err != nil {
		t.Fatal(err)
	}
	if second["done"] != 1 {
		t.Fatalf("second run did %v", second["done"])
	}
	for collection, kept := range map[string]int64{"character_readings": 2, "room_runs": 1, "room_invites": 1, "desktop_codes": 1, "characters": 1, "room_members": 1} {
		if n := countOf(t, app, collection); n != kept {
			t.Errorf("%s: %d kept, want %d", collection, n, kept)
		}
	}
}
