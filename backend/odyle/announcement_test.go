package odyle

import (
	"net/http"
	"testing"
)

// The announcement also names the release the backend was built as, so open dashboards of an
// older release notice a new one (#197); a build without a release name leaves it out.
func TestTheAnnouncementNamesTheRelease(t *testing.T) {
	app := newTestApp(t)
	saved := Version
	t.Cleanup(func() { Version = saved })
	Version = ""
	if got, has := ask(t, app, http.MethodGet, "/api/odyle/announcement", nil, "", 200)["dashboard"]; has {
		t.Fatalf("an unnamed build answered dashboard %v", got)
	}
	Version = "1.2.3"
	answer := ask(t, app, http.MethodGet, "/api/odyle/announcement", nil, "", 200)
	if answer["dashboard"] != "1.2.3" {
		t.Fatalf("dashboard %v", answer["dashboard"])
	}
	if got, has := answer["announcement"]; !has || got != nil {
		t.Fatalf("announcement %v", got)
	}
}
