package odyle

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestTrustedProxyHeadersComeFromTheEnvironment(t *testing.T) {
	app := newTestApp(t)
	proxy := func() core.TrustedProxyConfig { return app.Settings().TrustedProxy }
	// Unset: the setting stays as superusers saved it.
	if problem := configureProxy(app); problem != "" || len(proxy().Headers) != 0 {
		t.Fatalf("unset: %q, %+v", problem, proxy())
	}
	t.Setenv("ODYLE_TRUSTED_PROXY_HEADERS", " X-Real-IP, x-real-ip ,,X-Forwarded-For ")
	if problem := configureProxy(app); problem != "" {
		t.Fatal(problem)
	}
	if got := proxy(); strings.Join(got.Headers, "|") != "X-Real-IP|X-Forwarded-For" || got.UseLeftmostIP {
		t.Fatalf("headers = %+v", got)
	}
	t.Setenv("ODYLE_TRUSTED_PROXY_IP", "Leftmost")
	if problem := configureProxy(app); problem != "" || !proxy().UseLeftmostIP {
		t.Fatalf("leftmost: %q, %+v", problem, proxy())
	}
	// A wrong value changes nothing and says why.
	t.Setenv("ODYLE_TRUSTED_PROXY_IP", "middle")
	if problem := configureProxy(app); !strings.Contains(problem, "rightmost or leftmost") || !proxy().UseLeftmostIP {
		t.Fatalf("wrong choice: %q, %+v", problem, proxy())
	}
	t.Setenv("ODYLE_TRUSTED_PROXY_IP", "")
	t.Setenv("ODYLE_TRUSTED_PROXY_HEADERS", "X-Real-IP, Bad Header")
	if problem := configureProxy(app); !strings.Contains(problem, `"Bad Header"`) || len(proxy().Headers) != 2 {
		t.Fatalf("wrong header: %q, %+v", problem, proxy())
	}
	// Set but empty, it stops trusting any header.
	t.Setenv("ODYLE_TRUSTED_PROXY_HEADERS", "")
	if problem := configureProxy(app); problem != "" || len(proxy().Headers) != 0 || proxy().UseLeftmostIP {
		t.Fatalf("cleared: %q, %+v", problem, proxy())
	}
	if got := asJSON(t, proxyStatus(app)); got != `{"headers":[],"leftmost":false,"setup":""}` {
		t.Errorf("status = %s", got)
	}
}

func TestPrivateAddressesAreTheProxysOrAContainerNetworks(t *testing.T) {
	for address, private := range map[string]bool{
		"127.0.0.1": true, "::1": true, "10.1.2.3": true, "172.17.0.1": true, "192.168.1.20": true, "fd00::5": true, "169.254.10.1": true, "fe80::1": true, "100.100.1.1": true, "::ffff:192.168.0.1": true,
		"203.0.113.9": false, "8.8.8.8": false, "2001:db8::1": false, "": false, "proxy": false,
	} {
		if got := privateAddress(address); got != private {
			t.Errorf("%q: private %v", address, got)
		}
	}
}

// The Server status page counts requests by the address rate limits count them under:
// the trusted proxy header when there is one.
func TestRequestsCountByTheirClientAddress(t *testing.T) {
	app := newTestApp(t)
	t.Setenv("ODYLE_TRUSTED_PROXY_HEADERS", "X-Real-IP")
	if problem := configureProxy(app); problem != "" {
		t.Fatal(problem)
	}
	reuse := func(testing.TB) *tests.TestApp { return app }
	for _, from := range []string{"10.0.0.5", "127.0.0.1", "203.0.113.9"} {
		s := tests.ApiScenario{Name: "from " + from, Method: http.MethodGet, URL: "/api/odyle/announcement", Headers: map[string]string{"X-Real-IP": from}, ExpectedStatus: 200, ExpectedContent: []string{`"announcement":null`}}
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
	summary := stateOf(app).traffic.summary(time.Now())
	if total, private := summary.values["total"].(*object).values["count"], summary.values["private"]; total != 3 || private != 2 {
		t.Fatalf("%v requests, %v private", total, private)
	}
}
