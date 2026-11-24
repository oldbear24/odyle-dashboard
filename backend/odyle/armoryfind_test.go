package odyle

import (
	"strings"
	"testing"
)

// A search box's text names a character, and may name its server and region in any order and
// case; a server's or region's name alone is a character's name.
func TestSearchTextNamesTheCharacterItsServerAndRegion(t *testing.T) {
	book := staticServers()
	for text, want := range map[string]armoryQuery{
		"Kai":                {name: "Kai"},
		"Kai Lumiel":         {name: "Kai", server: "Lumiel"},
		"lumiel kai":         {name: "kai", server: "Lumiel"},
		"Kai, Lumiel (EU)":   {name: "Kai", server: "Lumiel", region: "GLOBAL_EU"},
		"Kai@Siel naw":       {name: "Kai", server: "Siel", region: "GLOBAL_NAW"},
		"Kai na":             {name: "Kai", region: "GLOBAL_NA"},
		"Lumiel":             {name: "Lumiel"},
		"Lumiel Siel":        {name: "Lumiel", server: "Siel"},
		"eu":                 {name: "eu"},
		"Ärïa":               {name: "Ärïa"},
		"  Kai  -  Lumiel  ": {name: "Kai", server: "Lumiel"},
	} {
		got, err := parseQuery(book, text)
		if err != nil || got != want {
			t.Errorf("%q: %+v %v, want %+v", text, got, err, want)
		}
	}
	for _, text := range []string{"", "K", "Kai Mira", "Kai Mira Lumiel", "a b c d e", "Averyveryverylongname1"} {
		if got, err := parseQuery(book, text); err == nil {
			t.Errorf("%q: %+v, want an error", text, got)
		}
	}
}

// Suggestions list the characters the armory knows whose name holds the text typed, in every
// region: the name itself first, then those of the region chosen, names that start with it and
// the strongest. A server or region in the text narrows them; hidden characters never show; text
// that is no search answers none. The scan reads the name index, never the builds.
func TestSuggestionsListTheCharactersTheArmoryKnows(t *testing.T) {
	app := newTestApp(t)
	rank := func(name string, serverId int, region string, power int64, hidden bool) {
		saved(t, app, "armory_ranks", map[string]any{"region": region, "serverId": serverId, "characterId": "Id" + name + strings.Repeat("A", 20), "name": name, "class": "Chanter",
			"level": 45, "combatPower": power, "itemLevel": 1600, "checkedAt": now(), "hidden": hidden})
	}
	rank("Kairos", 2304, "eu", 90000, false)
	rank("Kai", 2104, "nae", 50000, false)
	rank("Mikaila", 2304, "eu", 120000, false)
	rank("Kaiden", 2301, "eu", 80000, false)
	rank("Kaiser", 2304, "eu", 200000, true)
	rank("Okai", 1504, "as", 70000, false)
	names := func(out map[string]any) string {
		list := []string{}
		for _, r := range out["results"].([]any) {
			list = append(list, r.(map[string]any)["name"].(string))
		}
		return strings.Join(list, ",")
	}
	out := ask(t, app, "GET", "/api/odyle/armory/suggest?q=kai&region=GLOBAL_EU", nil, "", 200)
	if got := names(out); got != "Kai,Kairos,Kaiden,Mikaila,Okai" {
		t.Fatalf("suggested %s", got)
	}
	first := out["results"].([]any)[1].(map[string]any)
	if first["server"] != "Lumiel" || first["serverId"].(float64) != 2304 || first["region"] != "eu" || first["combatPower"].(float64) != 90000 || first["characterId"] != "IdKairos"+strings.Repeat("A", 20) {
		t.Fatalf("suggestion %v", first)
	}
	if got := names(ask(t, app, "GET", "/api/odyle/armory/suggest?q=kai%20lumiel", nil, "", 200)); got != "Kai,Kairos,Mikaila" {
		t.Fatalf("on Lumiel: %s", got)
	}
	if got := names(ask(t, app, "GET", "/api/odyle/armory/suggest?q=kai%20lumiel%20eu", nil, "", 200)); got != "Kairos,Mikaila" {
		t.Fatalf("on Lumiel in Europe: %s", got)
	}
	if got := names(ask(t, app, "GET", "/api/odyle/armory/suggest?q=kai%20asia", nil, "", 200)); got != "Okai" {
		t.Fatalf("in Asia: %s", got)
	}
	for _, text := range []string{"k", "kai%20mira", "100%25", ""} {
		if got := names(ask(t, app, "GET", "/api/odyle/armory/suggest?q="+text, nil, "", 200)); got != "" {
			t.Fatalf("%q: %s", text, got)
		}
	}
	// Underscores and percent signs are no wildcards.
	if got := names(ask(t, app, "GET", "/api/odyle/armory/suggest?q=k_i", nil, "", 200)); got != "" {
		t.Fatalf("wildcard: %s", got)
	}
	plan := []struct {
		Detail string `db:"detail"`
	}{}
	if err := app.DB().NewQuery("EXPLAIN QUERY PLAN SELECT name, level, class, serverId, region, characterId, combatPower, itemLevel, portrait, checkedAt FROM armory_ranks WHERE hidden = FALSE AND name LIKE '%kai%' ESCAPE '\\' ORDER BY combatPower DESC LIMIT 8").All(&plan); err != nil {
		t.Fatal(err)
	}
	if len(plan) == 0 || !strings.Contains(plan[0].Detail, "COVERING INDEX idx_armory_ranks_name") {
		t.Fatalf("plan %v", plan)
	}
}

// Without a server, PLAYNC's search is asked for the whole region, and each hit names its server;
// hits the armory knows carry their combat power. The text may name the server and region itself.
func TestArmorySearchFindsCharactersOnEveryServerOfARegion(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	saved(t, app, "armory_ranks", map[string]any{"region": "eu", "serverId": 2304, "characterId": "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=", "name": "Ka", "class": "Chanter",
		"level": 45, "combatPower": 107458, "itemLevel": 1671, "portrait": "portrait-ka.jpg", "checkedAt": now()})
	out := ask(t, app, "GET", "/api/odyle/armory/search?q=Ka&region=GLOBAL_EU", nil, "", 200)
	results, _ := out["results"].([]any)
	if len(results) != 2 || stand.searches.Load() != 1 {
		t.Fatalf("results %v after %d searches", out, stand.searches.Load())
	}
	exact := results[0].(map[string]any)
	if exact["name"] != "Ka" || exact["server"] != "Lumiel" || exact["serverId"].(float64) != 2304 || exact["combatPower"].(float64) != 107458 || exact["portrait"] != "portrait-ka.jpg" {
		t.Fatalf("exact %v", exact)
	}
	if other := results[1].(map[string]any); other["combatPower"].(float64) != 0 || other["server"] != "Lumiel" {
		t.Fatalf("other %v", other)
	}
	// The text's server and region win over the region chosen.
	out = ask(t, app, "GET", "/api/odyle/armory/search?q=Ka%20Lumiel%20eu&region=GLOBAL_ASIA", nil, "", 200)
	if q := out["query"].(map[string]any); q["server"] != "Lumiel" || q["region"] != "GLOBAL_EU" || stand.searches.Load() != 2 {
		t.Fatalf("query %v after %d searches", q, stand.searches.Load())
	}
	ask(t, app, "GET", "/api/odyle/armory/search?q=Ka", nil, "", 400)
	ask(t, app, "GET", "/api/odyle/armory/search?q=Ka%20Mira&region=GLOBAL_EU", nil, "", 400)
	// The cache keeps the region's answer.
	ask(t, app, "GET", "/api/odyle/armory/search?name=ka&region=GLOBAL_EU", nil, "", 200)
	if stand.searches.Load() != 2 {
		t.Fatalf("%d searches", stand.searches.Load())
	}
}
