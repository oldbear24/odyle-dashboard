package odyle

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tests"
)

// NA-East and NA-West have servers of the same names (odyle-windows#4): characters are kept apart
// as GLOBAL_NA and GLOBAL_NAW, and one saved as NA before the split moves to NA-West once PLAYNC's
// search finds it there.
func TestNAWestKeepsCharactersOfTheSameServerNameApart(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player := newUser(t, app, "Westerner")
	character := func(name, region string) *Character {
		t.Helper()
		c, err := findAs[Character](app, "characters", saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": name, "server": "Siel", "region": region}).Id)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	west := officialHit{id: "west-id", region: "naw", serverId: 1201, level: 30}
	moved := character("Ayla", "GLOBAL_NA")
	setOfficial(app, moved, west)
	if moved.GetString("region") != "GLOBAL_NAW" || moved.GetString("officialRegion") != "naw" {
		t.Fatalf("a West hit moves an NA character: %s", moved.GetString("region"))
	}
	east := character("Bram", "GLOBAL_NA")
	setOfficial(app, east, officialHit{id: "east-id", region: "nae", serverId: 1101, level: 30})
	if east.GetString("region") != "GLOBAL_NA" {
		t.Fatal("an East hit leaves the character in NA")
	}
	character("Twin", "GLOBAL_NAW")
	twin := character("Twin", "GLOBAL_NA")
	setOfficial(app, twin, west)
	if twin.GetString("region") != "GLOBAL_NA" {
		t.Fatal("a character the account also has under NA-West stays")
	}
	// The searches: NA-West asks only the West; NA asks the East first, then the West.
	if got := searches("Siel", "GLOBAL_NAW"); len(got) != 1 || got[0] != (search{serverId: 1201, region: "naw"}) {
		t.Fatalf("NA-West searches %v", got)
	}
	if got := searches("Lumiel", "GLOBAL_NA"); len(got) != 2 || got[0] != (search{serverId: 2104, region: "nae"}) || got[1] != (search{serverId: 2204, region: "naw"}) {
		t.Fatalf("NA searches %v", got)
	}
	// The app saves the same name on Siel East and Siel West as two characters.
	raw, err := player.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth, reuse := map[string]string{"Authorization": raw}, func(testing.TB) *tests.TestApp { return app }
	for _, s := range []tests.ApiScenario{
		{Name: "NA-East", Method: http.MethodPost, URL: "/api/odyle/character", Headers: auth, Body: strings.NewReader(`{"characterName":"Same","server":"Siel","region":"GLOBAL_NA"}`), ExpectedStatus: 200, ExpectedContent: []string{`"region":"GLOBAL_NA"`}},
		{Name: "NA-West", Method: http.MethodPost, URL: "/api/odyle/character", Headers: auth, Body: strings.NewReader(`{"characterName":"Same","server":"Siel","region":"GLOBAL_NAW"}`), ExpectedStatus: 200, ExpectedContent: []string{`"region":"GLOBAL_NAW"`}},
		{Name: "another region", Method: http.MethodPost, URL: "/api/odyle/character", Headers: auth, Body: strings.NewReader(`{"characterName":"Same","server":"Siel","region":"GLOBAL_XX"}`), ExpectedStatus: 400, ExpectedContent: []string{"Select a Global region."}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
	if same, err := app.CountRecords("characters", dbx.HashExp{"user": player.Id, "characterName": "Same"}); err != nil || same != 2 {
		t.Fatalf("characters named Same: %d, %v", same, err)
	}
}
