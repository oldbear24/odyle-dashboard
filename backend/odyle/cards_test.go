package odyle

import (
	"testing"
)

func TestPlayerCardsAreChosenByTheCharactersPlayer(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true, "armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	keepProfile(t, app, pageId, false)
	owner, stranger := newUser(t, app, "Owner"), newUser(t, app, "Stranger")
	// The daily lookup found the owner's character as this profile.
	mine, err := app.FindRecordById("characters", newGameCharacter(t, app, owner.Id, "Kai"))
	if err != nil {
		t.Fatal(err)
	}
	mine.Load(map[string]any{"officialId": pageId, "officialRegion": "eu", "officialServerId": 2304})
	if err := app.Save(mine); err != nil {
		t.Fatal(err)
	}
	newGameCharacter(t, app, stranger.Id, "Other")
	ownerAuth, strangerAuth := tokenOf(t, owner), tokenOf(t, stranger)
	profile := "/api/odyle/armory/eu/2304/" + pageId
	cardFor := func(auth map[string]string) map[string]any {
		t.Helper()
		card, _ := ask(t, app, "GET", profile, auth, "", 200)["card"].(map[string]any)
		return card
	}
	choose := func(auth map[string]string, design, finish string, status int) map[string]any {
		t.Helper()
		return ask(t, app, "POST", "/api/odyle/card", auth, `{"region":"eu","serverId":2304,"characterId":"`+pageId+`","design":"`+design+`","finish":"`+finish+`"}`, status)
	}

	// Nobody chose a look yet: the dashboard draws it after the race. Only its player may change it,
	// and holo needs the membership, which a new account says it has not.
	if card := cardFor(nil); card["design"] != "" || card["finish"] != "" || card["mine"] != false || card["holo"] != false {
		t.Fatalf("signed out: %v", card)
	}
	if card := cardFor(strangerAuth); card["mine"] != false {
		t.Fatalf("a stranger: %v", card)
	}
	if card := cardFor(ownerAuth); card["mine"] != true || card["holo"] != false {
		t.Fatalf("its player: %v", card)
	}
	choose(strangerAuth, "abyss", "", 403)
	choose(ownerAuth, "gilded", "", 400)
	choose(ownerAuth, "abyss", "prism", 403)
	if saved := choose(ownerAuth, "abyss", "", 200); saved["design"] != "abyss" || saved["finish"] != "" || saved["mine"] != true {
		t.Fatalf("saved: %v", saved)
	}
	if card := cardFor(nil); card["design"] != "abyss" || card["mine"] != false {
		t.Fatalf("everyone sees the design: %v", card)
	}
	// With the membership a holo finish, seen by everyone while the answer stays yes.
	ask(t, app, "POST", "/api/odyle/membership", ownerAuth, `{"membership":"yes"}`, 200)
	if card := cardFor(ownerAuth); card["holo"] != true {
		t.Fatalf("a member: %v", card)
	}
	if saved := choose(ownerAuth, "elysea", "starfall", 200); saved["design"] != "elysea" || saved["finish"] != "starfall" {
		t.Fatalf("holo: %v", saved)
	}
	if card := cardFor(nil); card["design"] != "elysea" || card["finish"] != "starfall" {
		t.Fatalf("everyone sees the holo: %v", card)
	}
	for _, finish := range []string{"sunburst", "ice", "scales", "aether", "opal", "galaxy", "lenticular", "brushed", "stained", "shield"} {
		if saved := choose(ownerAuth, "heiron", finish, 200); saved["finish"] != finish {
			t.Fatalf("holo %s: %v", finish, saved)
		}
	}
	// The designs of 0.53.0.
	for _, design := range []string{"sanctum", "pandaemonium", "eltnen", "inggison", "dredgion", "tiamaranta"} {
		if saved := choose(ownerAuth, design, "", 200); saved["design"] != design {
			t.Fatalf("design %s: %v", design, saved)
		}
	}
	choose(ownerAuth, "heiron", "chrome", 400)
	// Its options pick from what PLAYNC lists: a learned skill, nothing typed in.
	withOptions := func(options string, status int) map[string]any {
		t.Helper()
		return ask(t, app, "POST", "/api/odyle/card", ownerAuth, `{"region":"eu","serverId":2304,"characterId":"`+pageId+`","design":"balaur","finish":"starfall","options":`+options+`}`, status)
	}
	saved := withOptions(`{"layout":"full","back":"abyss","stats":"deity","line":"legion","skills":["Bolt"]}`, 200)
	if options, _ := saved["options"].(map[string]any); saved["design"] != "balaur" || options["layout"] != "full" || options["back"] != "abyss" || options["stats"] != "deity" || options["line"] != "legion" || len(options["skills"].([]any)) != 1 {
		t.Fatalf("options: %v", saved)
	}
	if card := cardFor(nil); card["options"].(map[string]any)["layout"] != "full" {
		t.Fatalf("everyone sees the options: %v", card)
	}
	// The effect around it, the accent colour, frame and name style (0.52.0).
	styled := withOptions(`{"aura":"runes","accent":"jade","frame":"radiant","nameStyle":"gold"}`, 200)
	if options, _ := styled["options"].(map[string]any); options["aura"] != "runes" || options["accent"] != "jade" || options["frame"] != "radiant" || options["nameStyle"] != "gold" {
		t.Fatalf("styled: %v", styled)
	}
	if options := cardFor(nil)["options"].(map[string]any); options["aura"] != "runes" || options["accent"] != "jade" {
		t.Fatalf("everyone sees the style: %v", options)
	}
	// The effects of 0.53.0.
	for _, aura := range []string{"wings", "orbit", "feathers", "shards", "rift"} {
		if saved := withOptions(`{"aura":"`+aura+`"}`, 200); saved["options"].(map[string]any)["aura"] != aura {
			t.Fatalf("effect %s: %v", aura, saved)
		}
	}
	for _, refused := range []string{`{"layout":"wide"}`, `{"back":"gilded"}`, `{"stats":"all"}`, `{"line":"motto"}`, `{"skills":["Rend"]}`, `{"skills":["Bolt","Bolt","Bolt"]}`, `{"skills":["Typed in"]}`, `"full"`,
		`{"aura":"fireworks"}`, `{"accent":"#ff0000"}`, `{"frame":"diamond"}`, `{"nameStyle":"comic"}`} {
		withOptions(refused, 400)
	}
	// Options left out keep their defaults.
	if saved := withOptions(`{"line":"none"}`, 200); saved["options"].(map[string]any)["layout"] != "classic" || saved["options"].(map[string]any)["line"] != "none" {
		t.Fatalf("defaults: %v", saved)
	}
	ask(t, app, "POST", "/api/odyle/membership", ownerAuth, `{"membership":"no"}`, 200)
	if card := cardFor(nil); card["design"] != "balaur" || card["finish"] != "" {
		t.Fatalf("without the membership the holo is gone: %v", card)
	}
	// A profile no Odyle account read has nobody to choose.
	keepProfile(t, app, "Tm9ib2R5c0NoYXJhY3Rlcg==", false)
	if card, _ := ask(t, app, "GET", "/api/odyle/armory/eu/2304/Tm9ib2R5c0NoYXJhY3Rlcg==", ownerAuth, "", 200)["card"].(map[string]any); card["mine"] != false || card["design"] != "" {
		t.Fatalf("nobody's: %v", card)
	}
	if out := ask(t, app, "POST", "/api/odyle/card", ownerAuth, `{"region":"eu","serverId":2304,"characterId":"Tm9ib2R5c0NoYXJhY3Rlcg==","design":"abyss","finish":""}`, 403); out == nil {
		t.Fatal("chose another player's card")
	}
}
