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

func TestServe(t *testing.T) {
	built := visible{fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>Odyle</title>")},
		"sw.js":                {Data: []byte("self.addEventListener('fetch', () => {});")},
		"assets/index-AbC1.js": {Data: []byte("console.log('odyle');")},
		".gitkeep":             {Data: []byte{}},
	}}
	serve, err := Serve(built, true)
	if err != nil {
		t.Fatal(err)
	}
	get := func(path, etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/"+path, nil)
		r.SetPathValue("path", path)
		if etag != "" {
			r.Header.Set("If-None-Match", etag)
		}
		w := httptest.NewRecorder()
		if err := serve(&core.RequestEvent{Event: router.Event{Response: w, Request: r}}); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		return w
	}

	page := get("", "")
	tag := page.Header().Get("ETag")
	if page.Code != 200 || page.Body.String() != "<!doctype html><title>Odyle</title>" || tag == "" || page.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("the page: %d %q, ETag %q, Cache-Control %q", page.Code, page.Body.String(), tag, page.Header().Get("Cache-Control"))
	}
	if again := get("", tag); again.Code != http.StatusNotModified {
		t.Fatalf("a page the browser has answers %d", again.Code)
	}
	// Any other path is the page (the dashboard's own routes), with the page's ETag.
	if other := get("rooms/abc", ""); other.Code != 200 || other.Header().Get("ETag") != tag {
		t.Fatalf("another path: %d, ETag %q", other.Code, other.Header().Get("ETag"))
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

// Link previews get the page's picture as an absolute address under a public
// Application URL; without one the page keeps it relative, as built.
func TestThePageNamesItsPreviewPictureUnderThePublicAddress(t *testing.T) {
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
	page := []byte(`<head><meta property="og:image" content="./icon-512.png"/></head>`)
	if withPreviewImage(page, "") != nil || withPreviewImage([]byte("<head></head>"), "https://odyle.example") != nil {
		t.Fatal("a page was changed without a public address or a picture")
	}
	named := withPreviewImage(page, `https://odyle.example/a"b`)
	if string(named) != `<head><meta property="og:image" content="https://odyle.example/a&#34;b/icon-512.png"/></head>` {
		t.Fatalf("named %s", named)
	}
	get := func(etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		if etag != "" {
			r.Header.Set("If-None-Match", etag)
		}
		w := httptest.NewRecorder()
		if err := servePage(&core.RequestEvent{Event: router.Event{Response: w, Request: r}}, named); err != nil {
			t.Fatal(err)
		}
		return w
	}
	served := get("")
	tag := served.Header().Get("ETag")
	if served.Code != 200 || served.Body.String() != string(named) || tag == "" || served.Header().Get("Cache-Control") != "no-cache" || !strings.HasPrefix(served.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("served %d %q, ETag %q, %v", served.Code, served.Body.String(), tag, served.Header())
	}
	if again := get(tag); again.Code != http.StatusNotModified {
		t.Fatalf("a page the browser has answers %d", again.Code)
	}
}
