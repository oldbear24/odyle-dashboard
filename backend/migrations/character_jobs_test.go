package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// A character's job bookkeeping moves from the character to character_jobs and back, and a
// character no job wrote gets no row.
func TestJobBookkeepingMovesOffTheCharacter(t *testing.T) {
	app := newMigratedApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("jobs@test.invalid")
	user.SetPassword("password-for-tests-only")
	user.Set("displayName", "Jobs")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	if err := characterJobsDown(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("character_jobs"); err == nil {
		t.Fatal("character_jobs is still there")
	}
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		t.Fatal(err)
	}
	busy, idle := core.NewRecord(characters), core.NewRecord(characters)
	for i, c := range []*core.Record{busy, idle} {
		c.Set("user", user.Id)
		c.Set("characterName", []string{"Busy", "Idle"}[i])
		c.Set("server", "Lumiel")
		c.Set("region", "GLOBAL_EU")
	}
	busy.Set("portraitCheckedAt", "2026-11-16 10:00:00.000Z")
	busy.Set("portraitHash", "abc123")
	busy.Set("portraitMisses", 2)
	busy.Set("capAlert", "soon")
	busy.Set("spinDay", "2026-11-16")
	if err := app.Save(busy); err != nil {
		t.Fatal(err)
	}
	if err := app.Save(idle); err != nil {
		t.Fatal(err)
	}

	if err := characterJobsUp(app); err != nil {
		t.Fatal(err)
	}
	rows := []dbx.NullStringMap{}
	if err := app.DB().NewQuery("SELECT * FROM character_jobs").All(&rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["character"].String != busy.Id || rows[0]["portraitCheckedAt"].String != "2026-11-16 10:00:00.000Z" || rows[0]["portraitHash"].String != "abc123" ||
		rows[0]["portraitMisses"].String != "2" || rows[0]["capAlert"].String != "soon" || rows[0]["spinDay"].String != "2026-11-16" {
		t.Fatalf("character_jobs holds %v", rows)
	}
	moved, err := app.FindRecordById("characters", busy.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range jobFields {
		if moved.Collection().Fields.GetByName(name) != nil {
			t.Fatalf("characters still has %s", name)
		}
	}

	// Back again: the character keeps what its row held.
	if err := characterJobsDown(app); err != nil {
		t.Fatal(err)
	}
	back, err := app.FindRecordById("characters", busy.Id)
	if err != nil {
		t.Fatal(err)
	}
	if back.GetString("portraitHash") != "abc123" || back.GetInt("portraitMisses") != 2 || back.GetString("capAlert") != "soon" || back.GetString("spinDay") != "2026-11-16" ||
		back.GetString("portraitCheckedAt") != "2026-11-16 10:00:00.000Z" {
		t.Fatalf("the character came back as %v", back.FieldsData())
	}
	if err := characterJobsUp(app); err != nil {
		t.Fatal(err)
	}
}
