package odyle

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestEveryoneHearsOfAChangedAnnouncementAndANewReleaseAtOnce(t *testing.T) {
	app := newTestApp(t)
	ann, bo := newUser(t, app, "Ann"), newUser(t, app, "Bo")
	first, second := listen(t, app, ann, userTopic+ann.Id), listen(t, app, bo, userTopic+bo.Id)

	// A changed announcement, its level and its removal; saving something else says nothing.
	// Each save loads the record afresh, as the settings route and the PocketBase dashboard do.
	save := func(fields map[string]any) {
		t.Helper()
		settings := findSettings(app)
		if settings == nil {
			t.Fatal("no settings record")
		}
		for k, v := range fields {
			settings.Set(k, v)
		}
		if err := app.Save(settings); err != nil {
			t.Fatal(err)
		}
	}
	expect := func(l *listener, want string) {
		t.Helper()
		topic, data, ok := l.next()
		if !ok || topic[:len(userTopic)] != userTopic || asJSON(t, data) != want {
			t.Fatalf("%v %s, want %s", ok, asJSON(t, data), want)
		}
	}
	save(map[string]any{"announcement": "Maintenance at 08:00 UTC", "announcementLevel": "warning"})
	expect(first, `{"announcement":{"level":"warning","text":"Maintenance at 08:00 UTC"}}`)
	expect(second, `{"announcement":{"level":"warning","text":"Maintenance at 08:00 UTC"}}`)
	save(map[string]any{"odylePerCube": 45})
	first.quiet()
	save(map[string]any{"announcement": ""})
	expect(first, `{"announcement":null}`)
	expect(second, `{"announcement":null}`)

	// A newer release is news; the first answer after a start and an unchanged one are not.
	tag := atomic.Value{}
	tag.Store("v0.6.0.15")
	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v := tag.Load().(string)
		w.Write([]byte(`{"tag_name":"` + v + `","html_url":"https://github.com/oldbear24/odyle-windows/releases/tag/` + v + `","published_at":"2026-10-16T15:19:32Z","draft":false,"prerelease":false,"assets":[]}`))
	}))
	defer feed.Close()
	t.Setenv("ODYLE_WINDOWS_RELEASE_URL", feed.URL+"/releases/latest")
	if out, err := checkRelease(app); err != nil || out.Done != 1 || version(latestRelease(app)) != "0.6.0.15" {
		t.Fatalf("first lookup: %v, %v", out, err)
	}
	first.quiet()
	if _, err := checkRelease(app); err != nil {
		t.Fatal(err)
	}
	first.quiet()
	tag.Store("v0.6.0.16")
	if _, err := checkRelease(app); err != nil {
		t.Fatal(err)
	}
	want := `{"release":{"publishedAt":"2026-10-16T15:19:32Z","url":"https://github.com/oldbear24/odyle-windows/releases/tag/v0.6.0.16","version":"0.6.0.16"}}`
	expect(first, want)
	expect(second, want)
}
