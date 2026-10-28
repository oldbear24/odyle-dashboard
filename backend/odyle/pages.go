package odyle

import (
	"encoding/xml"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"github.com/oldbear24/odyle-dashboard/backend/web"
)

// The dashboard's pages as search engines and link previews see them (backend/web): each
// public page (the start, the armory and its profiles, What's new, privacy, the demo) is
// named for what it shows; signed-in pages, searches and profiles the armory does not keep
// yet are kept out of search engines. The texts are English, like the addresses; the
// dashboard shows the page in the reader's language once it runs. robots.txt and
// sitemap.xml list the public pages, profiles included, under the public address.

const armorySite = "Odyle Armory"

// Search regions in PLAYNC's codes, by name.
var regionTitles = map[string]string{"nae": "North America East", "naw": "North America West", "eu": "Europe", "la": "South America", "as": "Asia"}

// The profile tabs (src/armory.js armoryTabs) as titles name them; the player card
// (/card, cards.go) is a page of its own.
var tabTitles = map[string]string{"skills": "skills", "daevanion": "Daevanion boards", "titles": "titles", "appearance": "appearance"}

// DescribePage tells what the dashboard page at route shows (web.Describe).
func DescribePage(e *core.RequestEvent, route, base string) web.Page {
	parts := strings.Split(strings.Trim(route, "/"), "/")
	home := web.Data{"@context": "https://schema.org", "@type": "WebSite", "name": "Odyle", "url": base + "/"}
	switch {
	case route == "/":
		return web.Page{Data: []any{home}}
	case route == "/armory":
		return web.Page{Title: "AION 2 armory: look up any Global character · Odyle", Description: "Look up any AION 2 Global character: gear with every item's stats and stones, combat power, item level, stats, skills, Daevanion boards, titles and skins, as PLAYNC's official character pages list them. No sign-in needed.",
			Heading: "Look up a character", Text: "Everything PLAYNC's official character pages show of any AION 2 Global character, kept by Odyle.", Data: []any{crumbs(base, [2]string{armorySite, "/armory"})}}
	case parts[0] == "armory" && len(parts) > 1 && parts[1] == "find":
		return web.Page{Title: "Character search · " + armorySite, Private: true}
	case parts[0] == "armory" && (len(parts) == 4 || len(parts) == 5):
		return profilePage(e.App, parts, base)
	case route == "/changelog":
		return web.Page{Title: "What's new in Odyle", Description: "Every Odyle release: what is new, what changed and what was fixed in the party dashboard, the armory and the Windows app.", Heading: "What's new"}
	case route == "/privacy":
		return web.Page{Title: "Privacy · Odyle", Description: "What Odyle keeps about you and your characters, why, for how long, and how to take it all with you or delete it.", Heading: "Privacy"}
	case route == "/demo":
		return web.Page{Title: "Demo party room · Odyle", Description: "See an Odyle party room without signing in: every character's Odyle, the next run, the wishlist and who is ready to go."}
	case route == "/tasks", route == "/account", route == "/slots", len(parts) == 2 && parts[0] == "room":
		return web.Page{Private: true}
	}
	return web.Page{Missing: true}
}

// profilePage names an armory profile (/armory/<region>/<server id>/<character id>[/<tab>])
// after the copy the armory keeps.
func profilePage(app core.App, parts []string, base string) web.Page {
	region, characterId, tab := parts[1], parts[3], ""
	serverId, _ := strconv.Atoi(parts[2])
	if len(parts) == 5 {
		tab = parts[4]
	}
	server := armoryServer(region, serverId)
	if _, known := tabTitles[tab]; server == "" || !armoryIds.MatchString(characterId) || tab != "" && tab != "card" && !known {
		return web.Page{Missing: true}
	}
	waiting := web.Page{Title: "A character on " + server + " · " + armorySite, Description: "An AION 2 Global character on " + server + " (" + regionTitles[region] + "), as PLAYNC's official character pages list it.", Private: true}
	record, err := keptProfile(app, serverId, characterId)
	if err != nil || record == nil {
		return waiting
	}
	if record.GetBool("hidden") {
		return web.Page{Missing: true}
	}
	var p armoryProfile
	if err := record.UnmarshalJSONField("profile", &p); err != nil || p.Name == "" {
		return waiting
	}
	race := strings.TrimSuffix(p.Race, "s")
	who := strings.TrimSpace(fmt.Sprintf("level %d %s %s", p.Level, race, p.Class))
	where := server + " (" + regionTitles[region] + ")"
	if p.Legion != "" {
		where += ", legion " + p.Legion
	}
	power := fmt.Sprintf("%s combat power, item level %s", grouped(p.CombatPower), grouped(p.ItemLevel))
	page := web.Page{Kind: "profile", ImageAlt: "Portrait of " + p.Name, Heading: p.Name, Text: fmt.Sprintf("%s, %s on %s: %s.", p.Name, who, where, power)}
	if p.Portrait != "" {
		page.Image = "api/odyle/armory-images/" + p.Portrait
	}
	path := "/armory/" + region + "/" + strconv.Itoa(serverId) + "/" + characterId
	trail := [][2]string{{armorySite, "/armory"}, {p.Name, path}}
	switch tab {
	case "card":
		trail = append(trail, [2]string{"Player card", path + "/card"})
		page.Title = fmt.Sprintf("%s's player card · %s · %s", p.Name, server, armorySite)
		page.Description = fmt.Sprintf("The player card of %s, a %s on %s with %s: a trading card of the character's portrait, stats and strongest skills that turns in 3D.", p.Name, who, where, power)
	case "":
		page.Title = fmt.Sprintf("%s · Level %d %s on %s · %s", p.Name, p.Level, p.Class, server, armorySite)
		page.Description = fmt.Sprintf("%s is a %s on %s with %s. See the gear with every item's stats and stones, the stats, skills, Daevanion boards, titles and skins, as PLAYNC lists them.", p.Name, who, where, power)
	default:
		trail = append(trail, [2]string{capitalized(tabTitles[tab]), path + "/" + tab})
		page.Title = fmt.Sprintf("%s's %s · %s · %s", p.Name, tabTitles[tab], server, armorySite)
		page.Description = fmt.Sprintf("%s of %s, a %s on %s with %s.", tabSummary(tab, &p), p.Name, who, where, power)
	}
	page.Data = []any{crumbs(base, trail...)}
	return page
}

// tabSummary is what a profile tab counts, in words.
func tabSummary(tab string, p *armoryProfile) string {
	switch tab {
	case "skills":
		learned := 0
		for _, s := range p.Skills {
			if s.Acquired {
				learned++
			}
		}
		return fmt.Sprintf("The skills (%d of %d learned, with their levels and what gear and Daevanion add)", learned, len(p.Skills))
	case "daevanion":
		open, total := int64(0), int64(0)
		for _, b := range p.Boards {
			open, total = open+b.Open, total+b.Total
		}
		return fmt.Sprintf("The Daevanion boards (%d of %d nodes open, with every board's effects)", open, total)
	case "titles":
		return fmt.Sprintf("The titles (%d of %d owned, with the equipped ones' effects)", p.Titles.Owned, p.Titles.Total)
	}
	return "The look (the skins worn over the gear, the pet and the wings)"
}

// crumbs is a schema.org trail from the start to the page, by name and path.
func crumbs(base string, trail ...[2]string) web.Data {
	items := []any{web.Data{"@type": "ListItem", "position": 1, "name": "Odyle", "item": base + "/"}}
	for i, c := range trail {
		items = append(items, web.Data{"@type": "ListItem", "position": i + 2, "name": c[0], "item": base + c[1]})
	}
	return web.Data{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items}
}

func capitalized(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// grouped is n with thousands separated by commas (107,458).
func grouped(n int64) string {
	digits := strconv.FormatInt(max(0, n), 10)
	var b strings.Builder
	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(d)
	}
	return b.String()
}

// robotsRoute answers GET /robots.txt: crawlers may read the dashboard and the armory's
// routes and images (the pages fetch them), not the rest of the API or the superuser
// dashboard; the sitemap is named under the public address.
func robotsRoute(e *core.RequestEvent) error {
	base := web.PublicURL(e.App)
	prefix := ""
	if u, err := url.Parse(base); err == nil {
		prefix = u.Path
	}
	lines := []string{"User-agent: *", "Allow: " + prefix + "/api/odyle/armory/", "Allow: " + prefix + "/api/odyle/armory-images/", "Disallow: " + prefix + "/api/", "Disallow: " + prefix + "/_/"}
	if base != "" {
		lines = append(lines, "", "Sitemap: "+base+"/sitemap.xml")
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=3600")
	return e.String(200, strings.Join(lines, "\n")+"\n")
}

// sitemapLimit keeps the sitemap within the 50,000 addresses one may list.
const sitemapLimit = 45000

type sitemapEntry struct {
	Loc     string `xml:"loc"`
	LastMod string `xml:"lastmod,omitempty"`
}

// sitemapRoute answers GET /sitemap.xml: the public pages and the profiles the armory
// keeps (the most recently opened first), under the public address; without one there is
// none (404).
func sitemapRoute(e *core.RequestEvent) error {
	base := web.PublicURL(e.App)
	if base == "" {
		return notFound("The sitemap needs the Application URL.")
	}
	entries := []sitemapEntry{{Loc: base + "/"}, {Loc: base + "/armory"}, {Loc: base + "/changelog"}, {Loc: base + "/privacy"}, {Loc: base + "/demo"}}
	var kept []struct {
		Region      string `db:"region"`
		ServerId    int    `db:"serverId"`
		CharacterId string `db:"characterId"`
		FetchedAt   string `db:"fetchedAt"`
	}
	err := e.App.DB().NewQuery("SELECT region, serverId, characterId, fetchedAt FROM armory_profiles WHERE hidden = FALSE AND fetchedAt != '' AND name != '' ORDER BY viewedAt DESC LIMIT {:limit}").Bind(dbx.Params{"limit": sitemapLimit}).All(&kept)
	if err != nil {
		return err
	}
	for _, k := range kept {
		if armoryServer(k.Region, k.ServerId) == "" || !armoryIds.MatchString(k.CharacterId) {
			continue
		}
		entry := sitemapEntry{Loc: fmt.Sprintf("%s/armory/%s/%d/%s", base, k.Region, k.ServerId, k.CharacterId)}
		if at, err := time.Parse(stampLayout, k.FetchedAt); err == nil {
			entry.LastMod = at.UTC().Format("2006-01-02")
		}
		entries = append(entries, entry)
	}
	out, err := xml.Marshal(struct {
		XMLName xml.Name       `xml:"urlset"`
		XMLNS   string         `xml:"xmlns,attr"`
		URLs    []sitemapEntry `xml:"url"`
	}{XMLNS: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: entries})
	if err != nil {
		return err
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=3600")
	return e.Blob(200, "application/xml; charset=utf-8", append([]byte(xml.Header), out...))
}
