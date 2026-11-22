package odyle

import (
	"net/http"
	"testing"
)

// Every answer that signs a Windows app in (pair, desktop-sign-in, session) and its heartbeat
// name the release the backend was built as, so the app knows which server it talks to; a build
// without a version leaves the field out.
func TestAppsHearTheServerVersion(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Versioned")
	browser := tokenOf(t, player)
	answers := func() []map[string]any {
		t.Helper()
		desk := pairWith(t, app, browser, "DESK")
		code := ask(t, app, http.MethodPost, "/api/odyle/desktop-code", browser, `{}`, 200)["code"].(string)
		paired := ask(t, app, http.MethodPost, "/api/odyle/pair", nil, `{"code":"`+code+`"}`, 200)
		signedIn := ask(t, app, http.MethodPost, "/api/odyle/desktop-sign-in", nil, `{"deviceKey":"`+desk.key+`"}`, 200)
		session := ask(t, app, http.MethodPost, "/api/odyle/session", desk.auth, `{"deviceKey":"`+desk.key+`"}`, 200)
		beat := ask(t, app, http.MethodPost, "/api/odyle/heartbeat", desk.auth, `{"sessionId":"`+session["sessionId"].(string)+`"}`, 200)
		return []map[string]any{paired, signedIn, session, beat}
	}
	before := Version
	t.Cleanup(func() { Version = before })
	Version = "1.0.0"
	for i, answer := range answers() {
		if answer["serverVersion"] != "1.0.0" {
			t.Fatalf("answer %d: serverVersion %v", i, answer["serverVersion"])
		}
	}
	Version = ""
	for i, answer := range answers() {
		if _, ok := answer["serverVersion"]; ok {
			t.Fatalf("answer %d of a build without a version: %v", i, answer["serverVersion"])
		}
	}
}
