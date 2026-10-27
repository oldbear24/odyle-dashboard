// Package web is the dashboard compiled into the backend, so one binary serves the API
// and the dashboard. Before go build, scripts/build-backend.mjs, the Dockerfile and the
// release workflow copy the Vite build (npm run build, dist) into web/dist. A build
// without it (a plain go build in a fresh checkout) holds only the placeholder
// dist/.gitkeep and serves the dashboard from --publicDir instead.
package web

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"html"
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
// as its ETag: the page and the files with fixed names (sw.js, the manifest, the icons)
// are revalidated on each load, and the build's content-hashed files under assets/ are
// kept for a year.
func Serve(dashboard fs.FS, indexFallback bool) (func(*core.RequestEvent) error, error) {
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
		name := path.Clean(strings.TrimPrefix(e.Request.PathValue(apis.StaticWildcardParam), "/"))
		if _, ok := tags[name]; !ok {
			name = path.Join(name, "index.html")
			if _, ok := tags[name]; !ok && indexFallback {
				name = "index.html"
			}
		}
		if name == "index.html" && e.App != nil {
			if named := withPreviewImage(page, publicURL(e.App.Settings().Meta.AppURL)); named != nil {
				return servePage(e, named)
			}
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

// The page names its link-preview picture (og:image) relative to itself, as a page
// served from any address must. Link previews (Discord, chat apps) want an absolute
// address, so the page served here names it under the Application URL set in the
// superuser dashboard (Settings → Application) when that is a public address.
var previewImage = []byte(`property="og:image" content="./icon-512.png"`)

// publicURL is the Application URL without its trailing slash, or "" while it is unset,
// PocketBase's default (localhost) or not a web address.
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

// withPreviewImage is the page with its preview picture under base, or nil when there is
// no base or the page names no relative picture.
func withPreviewImage(page []byte, base string) []byte {
	if base == "" || !bytes.Contains(page, previewImage) {
		return nil
	}
	absolute := `property="og:image" content="` + html.EscapeString(base+"/icon-512.png") + `"`
	return bytes.Replace(page, previewImage, []byte(absolute), 1)
}

// servePage answers with a page built here, revalidated by its content hash like the
// files apis.Static serves.
func servePage(e *core.RequestEvent, page []byte) error {
	sum := sha256.Sum256(page)
	tag := `"` + hex.EncodeToString(sum[:12]) + `"`
	header := e.Response.Header()
	header.Set("ETag", tag)
	header.Set("Cache-Control", "no-cache")
	if strings.Contains(e.Request.Header.Get("If-None-Match"), tag) {
		return e.NoContent(http.StatusNotModified)
	}
	return e.Blob(http.StatusOK, "text/html; charset=utf-8", page)
}
