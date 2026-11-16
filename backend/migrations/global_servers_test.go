package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Characters and PvP players saved under an older app's server names move to the Global server
// their id belongs to, Agnita to Tassin before Ishalgen to Agnita, and back again.
func TestOlderServerNamesMoveToTheGlobalServer(t *testing.T) {
	app := newMigratedApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		t.Fatal(err)
	}
	pvp, err := app.FindCollectionByNameOrId("character_pvp")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("daeva@test.invalid")
	user.SetPassword("password-for-tests-only")
	user.Set("displayName", "Daeva")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	saved := map[string]*core.Record{}
	for _, server := range []string{"Agnita", "Ishalgen", "Altgard", "Poeta", "Verteron", "Tahabata", "Kasika", "Lumiel"} {
		c := core.NewRecord(characters)
		c.Set("user", user.Id)
		c.Set("characterName", "Twin")
		c.Set("server", server)
		c.Set("region", "GLOBAL_EU")
		if err := app.Save(c); err != nil {
			t.Fatal(err)
		}
		saved[server] = c
	}
	event := core.NewRecord(pvp)
	event.Set("character", saved["Lumiel"].Id)
	event.Set("event", "0123456789abcdef0123456789abcdef")
	event.Set("kind", "assist")
	event.Set("name", "Vexa")
	event.Set("server", "Poeta")
	event.Set("region", "GLOBAL_EU")
	event.Set("killer", "Kael")
	event.Set("killerServer", "Agnita")
	event.Set("killerRegion", "GLOBAL_EU")
	event.Set("at", "2026-11-16 10:00:00.000Z")
	if err := app.Save(event); err != nil {
		t.Fatal(err)
	}
	check := func(step string, want map[string]string, victim, killer string) {
		t.Helper()
		for old, server := range want {
			c, err := app.FindRecordById("characters", saved[old].Id)
			if err != nil || c.GetString("server") != server {
				t.Fatalf("%s: the character saved on %s is on %q, want %s (%v)", step, old, c.GetString("server"), server, err)
			}
		}
		e, err := app.FindRecordById("character_pvp", event.Id)
		if err != nil || e.GetString("server") != victim || e.GetString("killerServer") != killer {
			t.Fatalf("%s: PvP players on %q and %q, want %s and %s (%v)", step, e.GetString("server"), e.GetString("killerServer"), victim, killer, err)
		}
	}
	if err := renameServers(app, globalServerSteps, false); err != nil {
		t.Fatal(err)
	}
	check("up", map[string]string{"Agnita": "Tassin", "Ishalgen": "Agnita", "Altgard": "Atiel", "Poeta": "Gauss", "Verteron": "Lamuatan", "Tahabata": "Tahavatha", "Kasika": "Kasaka", "Lumiel": "Lumiel"}, "Gauss", "Tassin")
	if err := renameServers(app, [][][2]string{globalServerSteps[1], globalServerSteps[0]}, true); err != nil {
		t.Fatal(err)
	}
	check("down", map[string]string{"Agnita": "Agnita", "Ishalgen": "Ishalgen", "Altgard": "Altgard", "Poeta": "Poeta", "Verteron": "Verteron", "Tahabata": "Tahabata", "Kasika": "Kasika", "Lumiel": "Lumiel"}, "Poeta", "Agnita")
}
