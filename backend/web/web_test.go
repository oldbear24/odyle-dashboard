package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
)

const built = `<!doctype html><html><head><meta charset="UTF-8"/><title>Odyle — Party command</title><meta name="description" content="A private AION 2 party dashboard."/><meta property="og:type" content="website"/><meta property="og:image" content="./icon-512.png"/><meta name="twitter:card" content="summary"/><script type="module" src="./assets/index-AbC1.js"></script></head><body><div id="app"></div></body></html>`

func request(serve func(*core.RequestEvent) error, path, etag string) (*httptest.ResponseRecorder, error) {
	r := httptest.NewRequest(http.MethodGet, "/"+path, nil)
	r.SetPathValue("path", path)
	if etag != "" {
		r.Header.Set("If-None-Match", etag)
	}
	w := httptest.NewRecorder()
	return w, serve(&core.RequestEvent{Event: router.Event{Response: w, Request: r}})
}

func TestServe(t *testing.T) {
	dashboard := visible{fstest.MapFS{
		"index.html":           {Data: []byte(built)},
		"sw.js":                {Data: []byte("self.addEventListener('fetch', () => {});")},
		"assets/index-AbC1.js": {Data: []byte("console.log('odyle');")},
		".gitkeep":             {Data: []byte{}},
	}}
	serve, err := Serve(dashboard, true, func(e *core.RequestEvent, route, base string) Page {
		return Page{Missing: route == "/nowhere", Private: strings.HasPrefix(route, "/rooms/")}
	})
	if err != nil {
		t.Fatal(err)
	}
	get := func(path, etag string) *httptest.ResponseRecorder {
		w, err := request(serve, path, etag)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		return w
	}

	page := get("", "")
	tag := page.Header().Get("ETag")
	if page.Code != 200 || !strings.Contains(page.Body.String(), `<base href="./"><meta name="odyle-routes" content="paths"><title>Odyle — Party command</title>`) || tag == "" || page.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("the page: %d %q, ETag %q, Cache-Control %q", page.Code, page.Body.String(), tag, page.Header().Get("Cache-Control"))
	}
	if again := get("", tag); again.Code != http.StatusNotModified {
		t.Fatalf("a page the browser has answers %d", again.Code)
	}
	// Any other path is the page (the dashboard's own routes), with a base back to the root.
	other := get("rooms/abc", "")
	if other.Code != 200 || !strings.Contains(other.Body.String(), `<base href="../">`) || !strings.Contains(other.Body.String(), `<meta name="robots" content="noindex">`) || other.Header().Get("ETag") == tag {
		t.Fatalf("another path: %d %q, ETag %q", other.Code, other.Body.String(), other.Header().Get("ETag"))
	}
	if missing := get("nowhere", ""); missing.Code != http.StatusNotFound || !strings.Contains(missing.Body.String(), `<div id="app">`) {
		t.Fatalf("a path that is no page: %d %q", missing.Code, missing.Body.String())
	}
	asset := get("assets/index-AbC1.js", "")
	if asset.Code != 200 || asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" || asset.Header().Get("ETag") == tag {
		t.Fatalf("a build file: %d, Cache-Control %q", asset.Code, asset.Header().Get("Cache-Control"))
	}
	if worker := get("sw.js", ""); worker.Code != 200 || worker.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("the service worker: %d, Cache-Control %q", worker.Code, worker.Header().Get("Cache-Control"))
	}
	// The placeholder is not part of the dashboard.
	if hidden := get(".gitkeep", ""); hidden.Header().Get("ETag") != tag {
		t.Fatalf("the placeholder was served: %d %q", hidden.Code, hidden.Body.String())
	}
}

// A dashboard folder (--publicDir) is served as it is on disk, its page named like the
// compiled-in one.
func TestFolder(t *testing.T) {
	dir := fstest.MapFS{"index.html": {Data: []byte(built)}, "sw.js": {Data: []byte("// worker")}}
	serve := Folder(dir, true, func(e *core.RequestEvent, route, base string) Page { return Page{Title: "At " + route} })
	worker, err := request(serve, "sw.js", "")
	if err != nil || worker.Code != 200 || worker.Body.String() != "// worker" {
		t.Fatalf("a file: %v %d %q", err, worker.Code, worker.Body.String())
	}
	for path, want := range map[string]string{"": `<base href="./"><meta name="odyle-routes" content="paths"><title>At /</title>`, "index.html": `<base href="./"><meta name="odyle-routes" content="paths"><title>At /</title>`, "armory/eu/2304/abc": `<base href="../../../"><meta name="odyle-routes" content="paths"><title>At /armory/eu/2304/abc</title>`} {
		page, err := request(serve, path, "")
		if err != nil || page.Code != 200 || !strings.Contains(page.Body.String(), want) {
			t.Fatalf("%q: %v %d %q", path, err, page.Code, page.Body.String())
		}
	}
}

// A page names itself for search engines and link previews: its own title, description,
// picture and text, absolute addresses under a public address, and nothing of the built
// page's own names twice.
func TestNamed(t *testing.T) {
	plain := string(Named([]byte(built), "/", "", Page{}))
	for _, want := range []string{`<meta charset="UTF-8"/><base href="./"><meta name="odyle-routes" content="paths"><title>Odyle — Party command</title><meta name="description" content="A private AION 2 party dashboard.">`, `<meta property="og:image" content="./icon-512.png"><meta property="og:image:width" content="512">`, `<div id="app"></div>`} {
		if !strings.Contains(plain, want) {
			t.Fatalf("the start page lacks %s:\n%s", want, plain)
		}
	}
	if strings.Contains(plain, "canonical") || strings.Contains(plain, "robots") || strings.Contains(plain, "ld+json") || strings.Count(plain, "og:image\"") != 1 {
		t.Fatalf("the start page without a public address:\n%s", plain)
	}

	page := string(Named([]byte(built), "/armory/eu/2304/abc", "https://odyle.example", Page{
		Title: `Ka "b" · Level 45`, Description: "A <level 45> Chanter.", Image: "api/odyle/armory-images/p.jpg", ImageAlt: "Portrait of Ka", Kind: "profile",
		Heading: "Ka<b>", Text: "Level 45 & more", Data: []any{Data{"@type": "BreadcrumbList", "name": "</script><b>"}},
	}))
	for _, want := range []string{
		`<base href="../../../">`, `<title>Ka &#34;b&#34; · Level 45</title>`, `<meta name="description" content="A &lt;level 45&gt; Chanter.">`,
		`<link rel="canonical" href="https://odyle.example/armory/eu/2304/abc">`, `<meta property="og:url" content="https://odyle.example/armory/eu/2304/abc">`,
		`<meta property="og:type" content="profile">`, `<meta property="og:title" content="Ka &#34;b&#34; · Level 45">`,
		`<meta property="og:image" content="https://odyle.example/api/odyle/armory-images/p.jpg"><meta property="og:image:alt" content="Portrait of Ka">`,
		`<script type="application/ld+json">{"@type":"BreadcrumbList","name":"\u003c/script\u003e\u003cb\u003e"}</script>`,
		`<div id="app"><div class="prerendered"><h1>Ka&lt;b&gt;</h1><p>Level 45 &amp; more</p></div></div>`,
	} {
		if !strings.Contains(page, want) {
			t.Fatalf("the profile lacks %s:\n%s", want, page)
		}
	}
	for _, gone := range []string{"Party command", "A private AION 2", "./icon-512.png", "og:image:width", "noindex"} {
		if strings.Contains(page, gone) {
			t.Fatalf("the profile still has %s:\n%s", gone, page)
		}
	}
	if strings.Count(page, `property="og:type"`) != 1 || strings.Count(page, `name="twitter:card"`) != 1 || !strings.Contains(page, `<script type="module" src="./assets/index-AbC1.js">`) {
		t.Fatalf("the profile's tags:\n%s", page)
	}
	private := string(Named([]byte(built), "/tasks", "https://odyle.example", Page{Private: true}))
	if !strings.Contains(private, `<meta name="robots" content="noindex">`) || !strings.Contains(private, `<link rel="canonical" href="https://odyle.example/tasks">`) {
		t.Fatalf("a signed-in page:\n%s", private)
	}
	if missing := string(Named([]byte(built), "/nowhere", "https://odyle.example", Page{Missing: true})); strings.Contains(missing, "canonical") || !strings.Contains(missing, "noindex") {
		t.Fatalf("no page:\n%s", missing)
	}
}

func TestPublicURL(t *testing.T) {
	for appURL, want := range map[string]string{
		"https://odyle.example/":     "https://odyle.example",
		"https://odyle.example/app":  "https://odyle.example/app",
		"http://odyle.lan:8090":      "http://odyle.lan:8090",
		"http://localhost:8090":      "",
		"http://127.0.0.1:8090":      "",
		"":                           "",
		"odyle.example":              "",
		"ftp://odyle.example":        "",
		"https://odyle.example/?a=1": "",
	} {
		if got := publicURL(appURL); got != want {
			t.Errorf("%q: %q, want %q", appURL, got, want)
		}
	}
}
