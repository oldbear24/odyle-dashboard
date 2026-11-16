package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Saved characters take their server's id from their region and server name, with the servers
// PLAYNC listed past the lists; a name nobody knows keeps 0. Back again, the old identity holds.
func TestCharactersTakeTheirServerId(t *testing.T) {
	app := newMigratedApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("ids@test.invalid")
	user.SetPassword("password-for-tests-only")
	user.Set("displayName", "Ids")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	if err := characterServerIdsDown(app); err != nil {
		t.Fatal(err)
	}
	servers, err := app.FindCollectionByNameOrId("game_servers")
	if err != nil {
		t.Fatal(err)
	}
	listed := core.NewRecord(servers)
	listed.Set("serverId", 2124)
	listed.Set("name", "Newcastle")
	listed.Set("open", true)
	if err := app.Save(listed); err != nil {
		t.Fatal(err)
	}
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{}
	for _, c := range []struct {
		server, region string
		id             int
	}{{"Lumiel", "GLOBAL_EU", 2304}, {"Siel", "GLOBAL_NA", 1101}, {"Siel", "GLOBAL_NAW", 1201}, {"Nathara", "GLOBAL_ASIA", 1523}, {"Newcastle", "GLOBAL_NA", 2124}, {"Nowhere", "GLOBAL_EU", 0}} {
		r := core.NewRecord(characters)
		r.Set("user", user.Id)
		r.Set("characterName", "Kael")
		r.Set("server", c.server)
		r.Set("region", c.region)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		want[r.Id] = c.id
	}
	if err := characterServerIdsUp(app); err != nil {
		t.Fatal(err)
	}
	for id, serverId := range want {
		c, err := app.FindRecordById("characters", id)
		if err != nil || c.GetInt("serverId") != serverId {
			t.Fatalf("%s on %s: id %d, want %d (%v)", c.GetString("characterName"), c.GetString("server"), c.GetInt("serverId"), serverId, err)
		}
	}
	if err := characterServerIdsDown(app); err != nil {
		t.Fatal(err)
	}
	if err := characterServerIdsUp(app); err != nil {
		t.Fatal(err)
	}
}
