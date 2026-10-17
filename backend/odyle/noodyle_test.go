package odyle

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// A character the Windows app read without its Odyle record is marked until it is read with one.
func TestACharacterWithoutOdyleIsMarkedUntilItsFirstReading(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, other := newUser(t, app, "Newcomer"), newUser(t, app, "Other")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	fresh := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Sprout", "server": "Lumiel", "region": "GLOBAL_EU"})
	read := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Veteran", "server": "Lumiel", "region": "GLOBAL_EU", "value": 90, "confirmed": true, "lastReadingAt": "2026-10-17 10:00:00.000Z"})
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
	reading := `{"sessionId":"` + session.Id + `","sequence":1,"characterId":"` + fresh.Id + `","characterName":"Sprout","server":"Lumiel","region":"GLOBAL_EU","value":15,"source":"packet","parserVersion":"global-reference-v2","confirmed":true}`
	for _, s := range []tests.ApiScenario{
		{Name: "only the owner marks it", Method: http.MethodPost, URL: "/api/odyle/no-odyle", Headers: theirs, Body: strings.NewReader(`{"characterId":"` + fresh.Id + `"}`), ExpectedStatus: 403, ExpectedContent: []string{"This character belongs to another account."}},
		{Name: "a character not read yet is marked", Method: http.MethodPost, URL: "/api/odyle/no-odyle", Headers: auth, Body: strings.NewReader(`{"characterId":"` + fresh.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"odyleLocked":true`}},
		{Name: "a character with a reading has Odyle", Method: http.MethodPost, URL: "/api/odyle/no-odyle", Headers: auth, Body: strings.NewReader(`{"characterId":"` + read.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"odyleLocked":false`}},
		{Name: "an unknown character", Method: http.MethodPost, URL: "/api/odyle/no-odyle", Headers: auth, Body: strings.NewReader(`{"characterId":"missingchar0000"}`), ExpectedStatus: 404, ExpectedContent: []string{"This character no longer exists."}},
		{Name: "its first reading clears the mark", Method: http.MethodPost, URL: "/api/odyle/report", Headers: auth, Body: strings.NewReader(reading), ExpectedStatus: 200, ExpectedContent: []string{`"odyleLocked":false`, `"value":15`}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
}
