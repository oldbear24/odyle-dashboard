package odyle

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// An account marks one character as its main; marking another moves the mark.
func TestAnAccountHasOneMainCharacter(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, other := newUser(t, app, "Main"), newUser(t, app, "Other")
	first := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Firstborn", "server": "Lumiel", "region": "GLOBAL_EU"})
	second := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Secondary", "server": "Lumiel", "region": "GLOBAL_EU"})
	raw, err := player.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	stranger, err := other.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth, theirs := map[string]string{"Authorization": raw}, map[string]string{"Authorization": stranger}
	reuse := func(testing.TB) *tests.TestApp { return app }
	mark := func(id string, main string) *strings.Reader {
		return strings.NewReader(`{"characterId":"` + id + `","main":` + main + `}`)
	}
	for _, s := range []tests.ApiScenario{
		{Name: "only the owner marks it", Method: http.MethodPost, URL: "/api/odyle/main-character", Headers: theirs, Body: mark(first.Id, "true"), ExpectedStatus: 403, ExpectedContent: []string{"This character belongs to another account."}},
		{Name: "main must be a boolean", Method: http.MethodPost, URL: "/api/odyle/main-character", Headers: auth, Body: mark(first.Id, `"yes"`), ExpectedStatus: 400, ExpectedContent: []string{"Main must be true or false."}},
		{Name: "an unknown character", Method: http.MethodPost, URL: "/api/odyle/main-character", Headers: auth, Body: mark("missingchar0000", "true"), ExpectedStatus: 404, ExpectedContent: []string{"This character no longer exists."}},
		{Name: "the first becomes the main", Method: http.MethodPost, URL: "/api/odyle/main-character", Headers: auth, Body: mark(first.Id, "true"), ExpectedStatus: 200, ExpectedContent: []string{`"main":true`, `"characterName":"Firstborn"`}},
		{Name: "the second takes the mark over", Method: http.MethodPost, URL: "/api/odyle/main-character", Headers: auth, Body: mark(second.Id, "true"), ExpectedStatus: 200, ExpectedContent: []string{`"main":true`, `"characterName":"Secondary"`}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
	isMain := func(id string) bool {
		c, err := app.FindRecordById("characters", id)
		if err != nil {
			t.Fatal(err)
		}
		return c.GetBool("main")
	}
	if isMain(first.Id) || !isMain(second.Id) {
		t.Fatalf("after moving the mark: first %v, second %v", isMain(first.Id), isMain(second.Id))
	}
	(&tests.ApiScenario{Name: "the mark is cleared", Method: http.MethodPost, URL: "/api/odyle/main-character", Headers: auth, Body: mark(second.Id, "false"), ExpectedStatus: 200, ExpectedContent: []string{`"main":false`}, TestAppFactory: reuse, DisableTestAppCleanup: true}).Test(t)
	if isMain(first.Id) || isMain(second.Id) {
		t.Fatal("a cleared mark left a main character")
	}
}
