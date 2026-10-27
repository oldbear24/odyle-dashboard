// Package web is the dashboard compiled into the backend, so one binary serves the API
// and the dashboard. Before go build, scripts/build-backend.mjs, the Dockerfile and the
// release workflow copy the Vite build (npm run build, dist) into web/dist. A build
// without it (a plain go build in a fresh checkout) holds only the placeholder
// dist/.gitkeep and serves the dashboard from --publicDir instead.
//
// Every page of the dashboard has its own path (/armory/eu/2304/…, /tasks). The backend
// answers each with the dashboard's page, named for what it shows (pages.go): its title,
// description and picture for search engines and link previews, which run no JavaScript or
// read only the page as served. The page also gets a base that leads back to the dashboard's
// root, since the build names its files relative to itself, and a mark that tells the
// dashboard to use paths; served anywhere else (a static host, the development server) it
// keeps hash routes (#/armory/eu/…).
package web

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

//go:embed all:dist
var files embed.FS

// Dashboard is the dashboard compiled in, or nil when this build holds none.
func Dashboard() fs.FS {
	dist, err := fs.Sub(files, "dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return nil
	}
	return visible{dist}
}

// visible leaves out dot files: the placeholder is not part of the dashboard.
type visible struct{ fs.FS }

func (v visible) Open(name string) (fs.File, error) {
	if strings.HasPrefix(path.Base(name), ".") && name != "." {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return v.FS.Open(name)
}

// Serve answers with the files of a dashboard compiled in (apis.Static). They have no
// modification time to revalidate with, so every answer carries the file's content hash
// as its ETag: the pages and the files with fixed names (sw.js, the manifest, the icons)
// are revalidated on each load, and the build's content-hashed files under assets/ are
// kept for a year. describe names each page (nil leaves the pages as built).
func Serve(dashboard fs.FS, indexFallback bool, describe Describe) (func(*core.RequestEvent) error, error) {
	tags := map[string]string{}
	err := fs.WalkDir(dashboard, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			return err
		}
		content, err := fs.ReadFile(dashboard, name)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		tags[name] = `"` + hex.EncodeToString(sum[:12]) + `"`
		return nil
	})
	if err != nil {
		return nil, err
	}
	static := apis.Static(dashboard, indexFallback)
	page, _ := fs.ReadFile(dashboard, "index.html")
	return func(e *core.RequestEvent) error {
		// The file apis.Static answers with: the one asked for, a folder's index.html or,
		// for any other path, the page.
		name := requested(e)
		if _, ok := tags[name]; !ok {
			if _, ok := tags[path.Join(name, "index.html")]; ok {
				name = path.Join(name, "index.html")
			} else if indexFallback {
				return servePage(e, page, describe)
			}
		}
		if name == "index.html" {
			return servePage(e, page, describe)
		}
		if tag, ok := tags[name]; ok {
			header := e.Response.Header()
			header.Set("ETag", tag)
			if strings.HasPrefix(name, "assets/") {
				header.Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				header.Set("Cache-Control", "no-cache")
			}
		}
		return static(e)
	}, nil
}

// Folder answers with the files of a dashboard folder (--publicDir) as apis.Static does,
// and with its page, read at each request (the folder may be built again meanwhile),
// named as Serve names it.
func Folder(dir fs.FS, indexFallback bool, describe Describe) func(*core.RequestEvent) error {
	static := apis.Static(dir, indexFallback)
	return func(e *core.RequestEvent) error {
		name := requested(e)
		if info, err := fs.Stat(dir, name); err == nil && !info.IsDir() && name != "index.html" {
			return static(e)
		}
		if _, err := fs.Stat(dir, path.Join(name, "index.html")); err != nil && !indexFallback && name != "index.html" {
			return static(e)
		}
		page, err := fs.ReadFile(dir, "index.html")
		if err != nil {
			return static(e)
		}
		return servePage(e, page, describe)
	}
}

// requested is the file a request asks for, under the dashboard ("." for its root).
func requested(e *core.RequestEvent) string {
	return path.Clean(strings.TrimPrefix(e.Request.PathValue(apis.StaticWildcardParam), "/"))
}

// servePage answers with the page as named for the path asked for, revalidated by its
// content hash like the files apis.Static serves. A path that is no page of the dashboard
// still gets it (it opens the start), with 404.
func servePage(e *core.RequestEvent, page []byte, describe Describe) error {
	route := "/" + strings.TrimSuffix(strings.TrimPrefix(e.Request.URL.EscapedPath(), "/"), "index.html")
	base := ""
	about := Page{}
	if e.App != nil {
		base = publicURL(e.App.Settings().Meta.AppURL)
	}
	if describe != nil {
		about = describe(e, route, base)
	}
	named := Named(page, route, base, about)
	sum := sha256.Sum256(named)
	tag := `"` + hex.EncodeToString(sum[:12]) + `"`
	header := e.Response.Header()
	header.Set("ETag", tag)
	header.Set("Cache-Control", "no-cache")
	if strings.Contains(e.Request.Header.Get("If-None-Match"), tag) {
		return e.NoContent(http.StatusNotModified)
	}
	status := http.StatusOK
	if about.Missing {
		status = http.StatusNotFound
	}
	return e.Blob(status, "text/html; charset=utf-8", named)
}

// publicURL is the Application URL set in the superuser dashboard (Settings → Application)
// without its trailing slash, or "" while it is unset, PocketBase's default (localhost) or
// not a web address. Link previews and search engines want absolute addresses, which only
// a public address gives.
func publicURL(appURL string) string {
	u, err := url.Parse(strings.TrimRight(appURL, "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return ""
	}
	return u.String()
}

// PublicURL is the dashboard's public address as Serve names pages under it ("" without one).
func PublicURL(app core.App) string { return publicURL(app.Settings().Meta.AppURL) }
