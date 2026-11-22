package odyle

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// The headers of the dashboard's pages are written out here, not read from the constant: a
// change to the policy shows as a failing test someone has to read and approve.
const wantedPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src https://aion2.th.gl; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"

// pageHeaders asks the router of the test app, with a stand-in for the dashboard's catch-all route (main.go
// adds the real one), and returns the response's headers.
func pageHeaders(t *testing.T, app *tests.TestApp, path string, headers map[string]string, status int) http.Header {
	t.Helper()
	var got http.Header
	(&tests.ApiScenario{Name: "GET " + path, Method: http.MethodGet, URL: path, Headers: headers, ExpectedStatus: status, ExpectedContent: []string{""},
		TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
		BeforeTestFunc: func(_ testing.TB, _ *tests.TestApp, e *core.ServeEvent) {
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", func(e *core.RequestEvent) error { return e.String(200, "page") })
			}
		},
		AfterTestFunc: func(_ testing.TB, _ *tests.TestApp, res *http.Response) { got = res.Header }}).Test(t)
	return got
}

// Every page and file of the dashboard carries the content security policy and the headers
// that keep it out of frames, from sniffing and from leaking its address; the API and the
// superuser dashboard, which need inline scripts, do not.
func TestTheDashboardPagesCarryTheHardeningHeaders(t *testing.T) {
	app := newTestApp(t)
	if contentSecurityPolicy != wantedPolicy {
		t.Fatalf("the content security policy changed:\n%s\nwant\n%s", contentSecurityPolicy, wantedPolicy)
	}
	for _, path := range []string{"/", "/index.html", "/armory/eu/2304/x", "/assets/app.js", "/sw.js", "/robots.txt"} {
		h := pageHeaders(t, app, path, nil, 200)
		if h.Get("Content-Security-Policy") != wantedPolicy || h.Get("X-Frame-Options") != "DENY" || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Referrer-Policy") != "no-referrer" {
			t.Errorf("%s: headers %v", path, h)
		}
	}
	// The policy's parts that matter most: no inline or remote scripts, no framing, one frame source.
	for _, must := range []string{"script-src 'self';", "frame-ancestors 'none'", "frame-src https://aion2.th.gl;", "object-src 'none'", "base-uri 'self'"} {
		if !strings.Contains(wantedPolicy, must) {
			t.Errorf("the policy lacks %q", must)
		}
	}
	if strings.Contains(wantedPolicy, "script-src 'self' 'unsafe") || strings.Contains(wantedPolicy, "*") {
		t.Error("the policy allows inline or any scripts")
	}
	// PocketBase sets a few headers of its own on these (SAMEORIGIN, nosniff, the superuser
	// dashboard's policy with its inline scripts); Odyle's must not replace them.
	for _, path := range []string{"/api/odyle/game", "/api/odyle/announcement", "/api/health", "/_/extensions.js"} {
		h := pageHeaders(t, app, path, nil, 200)
		if h.Get("Content-Security-Policy") == wantedPolicy || h.Get("X-Frame-Options") == "DENY" || h.Get("Referrer-Policy") != "" {
			t.Errorf("%s carries the dashboard's headers: %v", path, h)
		}
	}
}

// The superuser dashboard's extension is never kept by browsers, and the browsers that kept the
// old one drop their cache once, on their first visit to /_/, which the cookie then marks.
func TestTheSuperuserDashboardsEntryIsRefetched(t *testing.T) {
	app := newTestApp(t)
	if h := pageHeaders(t, app, "/_/extensions.js", nil, 200); h.Get("Cache-Control") != "no-cache" {
		t.Fatalf("extensions.js: %v", h)
	}
	h := pageHeaders(t, app, "/_/", nil, 200)
	if h.Get("Clear-Site-Data") != `"cache"` || !strings.Contains(strings.Join(h.Values("Set-Cookie"), ";"), "odyle_entry=1") {
		t.Fatalf("the first visit: %v", h)
	}
	if h := pageHeaders(t, app, "/_/", map[string]string{"Cookie": "a=b; odyle_entry=1"}, 200); h.Get("Clear-Site-Data") != "" || len(h.Values("Set-Cookie")) != 0 {
		t.Fatalf("a repeat visit: %v", h)
	}
	if h := pageHeaders(t, app, "/_/", map[string]string{"Cookie": "odyle_entry=10"}, 200); h.Get("Clear-Site-Data") == "" {
		t.Fatalf("a cookie of another value counted: %v", h)
	}
}

// staleTokenIgnored: public actions answer a request whose token signs nobody in, as they did
// before PocketBase refused such requests on every route; a token that does sign in stays for
// the routes that need one, and the routes that need an account still refuse a stale one.
func TestStaleTokensOnlyHurtTheRoutesThatNeedAnAccount(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Holder")
	old := tokenOf(t, user)
	user.RefreshTokenKey()
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	fresh := tokenOf(t, user)
	for _, path := range []string{"/api/odyle/pair", "/api/odyle/desktop-sign-in", "/api/odyle/unpair", "/api/odyle/invite-preview"} {
		// Whatever the action answers to an empty body (a preview names no room), not a 401.
		for _, auth := range []map[string]string{old, {"Authorization": "x.y.z"}} {
			status := 400
			if path == "/api/odyle/invite-preview" {
				status = 200
			}
			ask(t, app, "POST", path, auth, `{}`, status)
		}
	}
	ask(t, app, "GET", "/api/odyle/rooms", old, "", 401)
	ask(t, app, "POST", "/api/odyle/desktop-code", old, `{}`, 401)
	ask(t, app, "GET", "/api/odyle/rooms", fresh, "", 200)
	ask(t, app, "POST", "/api/odyle/desktop-code", fresh, `{}`, 200)
	// Only the public actions are let through: any other route refuses the stale token, open or not.
	pageHeaders(t, app, "/api/odyle/game", old, 401)
}

// The rate limits as the migrations leave them, rule by rule and in order (PocketBase takes the
// first rule that matches): a change to one, or a rule that lands before another, shows here.
// migrations/api_rate_limits_test.go checks which rule each request is given.
func TestTheFinalRateLimitRuleSet(t *testing.T) {
	app := newTestApp(t)
	limits := app.Settings().RateLimits
	if !limits.Enabled {
		t.Fatal("rate limits are off")
	}
	want := []core.RateLimitRule{
		{Label: "/api/odyle/armory/search", MaxRequests: 20, Duration: 60},
		{Label: "/api/odyle/armory/", MaxRequests: 60, Duration: 60},
		{Label: "/api/odyle/create", MaxRequests: 30, Duration: 60},
		{Label: "/api/odyle/join", MaxRequests: 30, Duration: 60},
		{Label: "/api/odyle/", MaxRequests: 600, Duration: 60},
		{Label: "/api/odyle/pair", MaxRequests: 10, Duration: 60},
		{Label: "users:auth", MaxRequests: 10, Duration: 60},
		{Label: "/api/odyle/desktop-sign-in", MaxRequests: 30, Duration: 60},
		{Label: "/api/odyle/unpair", MaxRequests: 30, Duration: 60},
		{Label: "/api/odyle/invite-preview", MaxRequests: 30, Duration: 60},
		{Label: "*:auth", MaxRequests: 10, Duration: 60},
		{Label: "*:requestPasswordReset", MaxRequests: 5, Duration: 60},
		{Label: "*:requestOTP", MaxRequests: 5, Duration: 60},
		{Label: "*:requestVerification", MaxRequests: 5, Duration: 60},
		{Label: "*:requestEmailChange", MaxRequests: 5, Duration: 60},
		{Label: "/api/", MaxRequests: 300, Duration: 10},
	}
	if len(limits.Rules) != len(want) {
		t.Fatalf("%d rules, want %d: %+v", len(limits.Rules), len(want), limits.Rules)
	}
	for i, rule := range want {
		if got := limits.Rules[i]; got != rule {
			t.Errorf("rule %d is %+v, want %+v", i, got, rule)
		}
	}
	// The public actions that try keys and codes each have a rule of their own, before the
	// general one that would let them through at 600 a minute.
	for _, path := range []string{"pair", "desktop-sign-in", "unpair", "invite-preview"} {
		rule, ok := limits.FindRateLimitRule([]string{"POST /api/odyle/" + path, "/api/odyle/" + path})
		if !ok || rule.Label != "/api/odyle/"+path || rule.MaxRequests > 30 {
			t.Errorf("%s: rule %+v", path, rule)
		}
	}
}
