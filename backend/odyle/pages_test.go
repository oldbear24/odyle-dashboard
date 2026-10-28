package odyle

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
)

const pageId = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="

// keepProfile keeps a profile in the armory as a lookup would.
func keepProfile(t *testing.T, app core.App, characterId string, hidden bool) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("armory_profiles")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	record.Load(map[string]any{"region": "eu", "serverId": 2304, "characterId": characterId, "name": "Kai", "fetchedAt": time.Date(2026, 10, 27, 9, 0, 0, 0, time.UTC), "viewedAt": time.Now(), "hidden": hidden,
		"profile": armoryProfile{Version: armoryVersion, Name: "Kai", Level: 45, Class: "Gladiator", Race: "Elyos", Server: "Lumiel", CombatPower: 107458, ItemLevel: 1671, Portrait: "portrait-kai.jpg",
			Skills: []armorySkill{{Name: "Bolt", Acquired: true}, {Name: "Rend"}}, Boards: []armoryBoard{{Open: 12, Total: 40}}, Titles: armoryTitles{Owned: 94, Total: 304}}})
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
}

func pageEvent(app core.App, path string) (*core.RequestEvent, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	return &core.RequestEvent{App: app, Event: router.Event{Response: w, Request: httptest.NewRequest(http.MethodGet, path, nil)}}, w
}

func TestPagesAreNamedForWhatTheyShow(t *testing.T) {
	app := newTestApp(t)
	keepProfile(t, app, pageId, false)
	keepProfile(t, app, "SGlkZGVuSGlkZGVuSGlkZGVu", true)
	describe := func(route string) (title, description string, private, missing bool, image string) {
		e, _ := pageEvent(app, route)
		p := DescribePage(e, route, "https://odyle.example")
		return p.Title, p.Description, p.Private, p.Missing, p.Image
	}
	profile := "/armory/eu/2304/" + pageId
	title, description, private, missing, image := describe(profile)
	if title != "Kai · Level 45 Gladiator on Lumiel · Odyle Armory" || private || missing || image != "api/odyle/armory-images/portrait-kai.jpg" ||
		description != "Kai is a level 45 Elyo Gladiator on Lumiel (Europe) with 107,458 combat power, item level 1,671. See the gear with every item's stats and stones, the stats, skills, Daevanion boards, titles and skins, as PLAYNC lists them." {
		t.Fatalf("the profile: %q %q %v %v %q", title, description, private, missing, image)
	}
	for tab, want := range map[string][2]string{
		"skills":     {"Kai's skills · Lumiel · Odyle Armory", "The skills (1 of 2 learned"},
		"daevanion":  {"Kai's Daevanion boards · Lumiel · Odyle Armory", "The Daevanion boards (12 of 40 nodes open"},
		"titles":     {"Kai's titles · Lumiel · Odyle Armory", "The titles (94 of 304 owned"},
		"appearance": {"Kai's appearance · Lumiel · Odyle Armory", "The look (the skins"},
		"card":       {"Kai's player card · Lumiel · Odyle Armory", "The player card of Kai, a level 45 Elyo Gladiator on Lumiel (Europe)"},
	} {
		if title, description, _, _, _ := describe(profile + "/" + tab); title != want[0] || !strings.HasPrefix(description, want[1]) {
			t.Errorf("%s: %q %q", tab, title, description)
		}
	}
	// A profile not kept yet waits for PLAYNC and stays out of search engines; a hidden one,
	// a server of another region, an unknown tab or path is no page.
	if title, _, private, missing, _ := describe("/armory/eu/2304/Tm90S2VwdFlldE5vdEtlcHQ="); title != "A character on Lumiel · Odyle Armory" || !private || missing {
		t.Fatalf("a profile not kept: %q %v %v", title, private, missing)
	}
	for _, route := range []string{"/armory/eu/2304/SGlkZGVuSGlkZGVuSGlkZGVu", "/armory/nae/2304/" + pageId, profile + "/gear", "/rooms", "/armory/eu"} {
		if _, _, _, missing, _ := describe(route); !missing {
			t.Errorf("%s is a page", route)
		}
	}
	for _, route := range []string{"/tasks", "/account", "/slots", "/room/abc123", "/armory/find/GLOBAL_EU/Lumiel/Kai"} {
		if _, _, private, missing, _ := describe(route); !private || missing {
			t.Errorf("%s: private %v, missing %v", route, private, missing)
		}
	}
	for _, route := range []string{"/", "/armory", "/changelog", "/privacy", "/demo"} {
		if _, _, private, missing, _ := describe(route); private || missing {
			t.Errorf("%s: private %v, missing %v", route, private, missing)
		}
	}
}

func TestRobotsAndSitemapListThePublicPages(t *testing.T) {
	app := newTestApp(t)
	keepProfile(t, app, pageId, false)
	keepProfile(t, app, "SGlkZGVuSGlkZGVuSGlkZGVu", true)
	// Without a public address there is no sitemap to name.
	e, w := pageEvent(app, "/robots.txt")
	if err := robotsRoute(e); err != nil || strings.Contains(w.Body.String(), "Sitemap") || !strings.Contains(w.Body.String(), "Allow: /api/odyle/armory/\n") || !strings.Contains(w.Body.String(), "Disallow: /api/\n") {
		t.Fatalf("robots.txt: %v %q", err, w.Body.String())
	}
	if e, _ := pageEvent(app, "/sitemap.xml"); sitemapRoute(e) == nil {
		t.Fatal("a sitemap without a public address")
	}
	app.Settings().Meta.AppURL = "https://odyle.example/app/"
	e, w = pageEvent(app, "/robots.txt")
	if err := robotsRoute(e); err != nil || !strings.Contains(w.Body.String(), "Disallow: /app/_/\n\nSitemap: https://odyle.example/app/sitemap.xml\n") {
		t.Fatalf("robots.txt: %v %q", err, w.Body.String())
	}
	e, w = pageEvent(app, "/sitemap.xml")
	if err := sitemapRoute(e); err != nil {
		t.Fatal(err)
	}
	body := w.Body.String()
	for _, want := range []string{`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, "<url><loc>https://odyle.example/app/armory</loc></url>", "<url><loc>https://odyle.example/app/armory/eu/2304/" + pageId + "</loc><lastmod>2026-10-27</lastmod></url>"} {
		if !strings.Contains(body, want) {
			t.Fatalf("the sitemap lacks %s:\n%s", want, body)
		}
	}
	if strings.Contains(body, "SGlkZGVu") || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/xml") {
		t.Fatalf("the sitemap: %v\n%s", w.Header(), body)
	}
}
