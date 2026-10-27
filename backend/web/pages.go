package web

import (
	"bytes"
	"encoding/json"
	"html"
	"regexp"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Page is what a page of the dashboard says about itself before the dashboard runs: its
// title and description, its picture, whether search engines may list it, and a heading
// and text for readers that run no JavaScript. The dashboard draws the page over that
// text once it runs, and keeps the title in step (src/routes.js).
type Page struct {
	Title       string // the whole title; "" keeps the built page's
	Description string // "" keeps the built page's
	Image       string // the picture's path under the dashboard; "" for the icon
	ImageAlt    string
	Kind        string // og:type; "" for website
	Private     bool   // not for search engines (noindex): signed-in pages, searches, profiles not kept yet
	Missing     bool   // no page of the dashboard: answered 404
	Heading     string
	Text        string
	Data        []any // structured data (schema.org JSON-LD), only with a public address
}

// Data is a schema.org object (JSON-LD).
type Data = map[string]any

// Describe tells what the page at route ("/", "/armory/eu/2304/…", as the request named
// it) shows, with base the dashboard's public address ("" without one).
type Describe func(e *core.RequestEvent, route, base string) Page

// The tags of the built page that Named writes anew.
var (
	namedTags  = regexp.MustCompile(`<title>[^<]*</title>|<meta (?:name|property)="(?:description|robots|og:[a-z:_]+|twitter:[a-z:]+)"[^>]*>`)
	builtTitle = regexp.MustCompile(`<title>([^<]*)</title>`)
	builtText  = regexp.MustCompile(`<meta name="description" content="([^"]*)"`)
	charset    = regexp.MustCompile(`<meta charset="[^"]*"\s*/?>`)
)

const defaultImage = "icon-512.png"

// Named is the built page as served at route: with a base back to the dashboard's root
// (the build names its files relative to itself), the mark for paths, and the page's
// title, description, picture and text, under base when there is one.
func Named(page []byte, route, base string, p Page) []byte {
	title, description := p.Title, p.Description
	if m := builtTitle.FindSubmatch(page); m != nil && title == "" {
		title = html.UnescapeString(string(m[1]))
	}
	if m := builtText.FindSubmatch(page); m != nil && description == "" {
		description = html.UnescapeString(string(m[1]))
	}
	image, size := p.Image, `<meta property="og:image:width" content="512"><meta property="og:image:height" content="512">`
	if image == "" {
		image = defaultImage
	} else {
		size = ""
	}
	alt := p.ImageAlt
	if alt == "" {
		alt = "Odyle"
	}
	kind := p.Kind
	if kind == "" {
		kind = "website"
	}
	// "/" and "/tasks" are at the root, "/armory/eu/2304/x" three folders below it.
	depth := strings.Count(strings.TrimPrefix(route, "/"), "/")
	root := "./"
	if depth > 0 {
		root = strings.Repeat("../", depth)
	}
	attr := html.EscapeString
	var head strings.Builder
	head.WriteString(`<base href="` + root + `"><meta name="odyle-routes" content="paths"><title>` + attr(title) + `</title><meta name="description" content="` + attr(description) + `">`)
	if p.Private || p.Missing {
		head.WriteString(`<meta name="robots" content="noindex">`)
	}
	address := ""
	if base != "" && !p.Missing {
		address = base + route
		if route == "/" {
			address = base + "/"
		}
		head.WriteString(`<link rel="canonical" href="` + attr(address) + `">`)
	}
	picture := root + image
	if base != "" {
		picture = base + "/" + image
	}
	head.WriteString(`<meta property="og:type" content="` + attr(kind) + `"><meta property="og:site_name" content="Odyle"><meta property="og:title" content="` + attr(title) + `"><meta property="og:description" content="` + attr(description) + `">`)
	if address != "" {
		head.WriteString(`<meta property="og:url" content="` + attr(address) + `">`)
	}
	head.WriteString(`<meta property="og:image" content="` + attr(picture) + `">` + size + `<meta property="og:image:alt" content="` + attr(alt) + `"><meta name="twitter:card" content="summary">`)
	if base != "" {
		for _, data := range p.Data {
			// json.Marshal escapes <, > and &, so the data cannot end its script.
			if raw, err := json.Marshal(data); err == nil {
				head.WriteString(`<script type="application/ld+json">` + string(raw) + `</script>`)
			}
		}
	}
	out := namedTags.ReplaceAll(page, nil)
	if at := charset.FindIndex(out); at != nil {
		out = append(out[:at[1]:at[1]], append([]byte(head.String()), out[at[1]:]...)...)
	} else if i := bytes.Index(out, []byte("<head>")); i >= 0 {
		out = append(out[:i+6:i+6], append([]byte(head.String()), out[i+6:]...)...)
	} else {
		out = append([]byte(head.String()), out...)
	}
	if p.Heading != "" || p.Text != "" {
		text := `<div id="app"><div class="prerendered"><h1>` + html.EscapeString(p.Heading) + `</h1><p>` + html.EscapeString(p.Text) + `</p></div></div>`
		out = bytes.Replace(out, []byte(`<div id="app"></div>`), []byte(text), 1)
	}
	return out
}
