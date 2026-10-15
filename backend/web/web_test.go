package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
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
