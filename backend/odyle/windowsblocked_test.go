package odyle

import (
	"net/http"
	"testing"
)

// Held-back Windows versions (odyle-windows#19): superusers keep the list under Server controls;
// GET /api/odyle/windows-release answers it to every app.
func TestHeldBackWindowsVersionsReachTheApps(t *testing.T) {
	app := newTestApp(t)
	if got := ask(t, app, http.MethodGet, "/api/odyle/windows-release", nil, "", 200)["blocked"].([]any); len(got) != 0 {
		t.Fatalf("none held back yet: %v", got)
	}
	if _, err := writeSettings(app, body{"windowsBlocked": []any{" v0.18.0 ", "0.18.0", "0.17.2"}}); err != nil {
		t.Fatal(err)
	}
	got := ask(t, app, http.MethodGet, "/api/odyle/windows-release", nil, "", 200)["blocked"].([]any)
	if len(got) != 2 || got[0] != "0.18.0" || got[1] != "0.17.2" {
		t.Fatalf("held back %v", got)
	}
	for _, wrong := range []any{"0.18", []any{"0.18"}, []any{"latest"}, []any{1}} {
		if _, err := writeSettings(app, body{"windowsBlocked": wrong}); err == nil {
			t.Fatalf("%v was taken", wrong)
		}
	}
	if readSettings(app).WindowsBlocked[0] != "0.18.0" {
		t.Fatalf("a refused change kept %v", readSettings(app).WindowsBlocked)
	}
}
