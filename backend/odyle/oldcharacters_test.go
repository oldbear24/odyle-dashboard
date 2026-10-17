package odyle

import (
	"testing"
	"time"

	"github.com/pocketbase/dbx"
)

// Characters no reader has read or seen for a year are deleted with their history; any sign of
// life within the year keeps a character.
func TestCharactersUnreadForAYearAreDeleted(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player := newUser(t, app, "Returning")
	old, year := ago(400*24*time.Hour), ago(100*24*time.Hour)
	character := func(name string, created, seen, read string) string {
		t.Helper()
		c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": name, "server": "Lumiel", "region": "GLOBAL_EU", "lastSeenAt": seen, "lastReadingAt": read})
		if _, err := app.DB().NewQuery("UPDATE characters SET created = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": created, "id": c.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
		return c.Id
	}
	gone := character("Forgotten", old, old, old)
	never := character("Never", old, "", "")
	seen := character("Seen", old, year, old)
	read := character("Read", old, "", year)
	fresh := character("Fresh", year, "", "")
	saved(t, app, "character_readings", map[string]any{"character": gone, "value": 40, "source": "packet", "confirmed": true})
	out, err := oldCharacters(app)
	if err != nil || out.Done != 2 {
		t.Fatalf("done %d, %v", out.Done, err)
	}
	for id, kept := range map[string]bool{gone: false, never: false, seen: true, read: true, fresh: true} {
		if _, err := app.FindRecordById("characters", id); (err == nil) != kept {
			t.Fatalf("character %s kept %v, want %v", id, err == nil, kept)
		}
	}
	if left, err := app.CountRecords("character_readings", dbx.HashExp{"character": gone}); err != nil || left != 0 {
		t.Fatalf("history of a deleted character: %d, %v", left, err)
	}
}
