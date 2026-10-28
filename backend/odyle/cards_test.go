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
	ask(t, app, "POST", "/api/odyle/membership", ownerAuth, `{"membership":"no"}`, 200)
	if card := cardFor(nil); card["design"] != "elysea" || card["finish"] != "" {
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
