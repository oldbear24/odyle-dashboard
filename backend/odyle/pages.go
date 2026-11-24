package odyle

import (
	"cmp"
	"encoding/xml"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"github.com/oldbear24/odyle-dashboard/backend/web"
)

// The dashboard's pages as search engines and link previews see them (backend/web): each
// public page (the start, the armory and its profiles, the timers, What's new, privacy, the
// demo) is named for what it shows; signed-in pages, searches, comparisons and profiles the
// armory does not keep yet are kept out of search engines. The texts are English, like the addresses;
// the dashboard shows the page in the reader's language once it runs. robots.txt and
// sitemap.xml list the public pages, profiles included, under the public address.

const armorySite = "Odyle Armory"

// The profile tabs (src/armory.js armoryTabs) as titles name them; the player card
// (/card, cards.go) is a page of its own.
var tabTitles = map[string]string{"skills": "skills", "daevanion": "Daevanion boards", "titles": "titles", "appearance": "appearance", "upgrade": "upgrades"}

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
	case parts[0] == "armory" && len(parts) > 1 && len(parts) <= 3 && parts[1] == "top":
		return topPage(e.App, parts, base)
	case parts[0] == "armory" && len(parts) > 1 && parts[1] == "find":
		return web.Page{Title: "Character search · " + armorySite, Private: true}
	case route == "/armory/ai":
		// Named after the armory: only the accounts that may use the AI learn of it.
		return web.Page{Title: armorySite, Private: true}
	case parts[0] == "armory" && len(parts) == 8 && parts[4] == "compare":
		return comparePage(e.App, parts)
	case parts[0] == "armory" && (len(parts) == 4 || len(parts) == 5):
		return profilePage(e.App, parts, base)
	case route == "/changelog":
		return web.Page{Title: "What's new in Odyle", Description: "Every Odyle release: what is new, what changed and what was fixed in the party dashboard, the armory and the Windows app.", Heading: "What's new"}
	case route == "/privacy":
		return web.Page{Title: "Privacy · Odyle", Description: "What Odyle keeps about you and your characters, why, for how long, and how to take it all with you or delete it.", Heading: "Privacy"}
	case route == "/demo":
		return web.Page{Title: "Demo party room · Odyle", Description: "See an Odyle party room without signing in: every character's Odyle, the next run, the wishlist and who is ready to go."}
	case route == "/timers":
		return web.Page{Title: "AION 2 timers: daily and weekly reset, Odyle regeneration · Odyle", Description: "When the AION 2 Global daily and weekly resets come in your time, when the natural Odyle pool gains its next tick and how long it takes to fill, with the weekly maintenance and what a cube of each dungeon costs. No sign-in needed.",
			Heading: "AION 2 timers", Text: timersText(readSettings(e.App)), Data: []any{crumbs(base, [2]string{"AION 2 timers", "/timers"})}}
	case route == "/achievements":
		return web.Page{Title: "Achievements · Odyle", Private: true}
	case route == "/week":
		return web.Page{Title: "Your week in Odyle", Private: true}
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
	server := serversOf(app).inRegion(region, serverId)
	if _, known := tabTitles[tab]; server == "" || !armoryIds.MatchString(characterId) || tab != "" && tab != "card" && !known {
		return web.Page{Missing: true}
	}
	waiting := web.Page{Title: "A character on " + server + " · " + armorySite, Description: "An AION 2 Global character on " + server + " (" + regionOfCode(region).title + "), as PLAYNC's official character pages list it.", Private: true}
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
	where := server + " (" + regionOfCode(region).title + ")"
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

// comparePage names two armory profiles side by side (/armory/<region>/<server id>/<character
// id>/compare/<region>/<server id>/<character id>, src/compare.js) after both kept copies, or by
// server while one is not kept yet. Comparisons stay out of search engines; one with a profile
// that is no page (hidden, a server outside its region) is none either.
func comparePage(app core.App, parts []string) web.Page {
	var names [2]string
	for i, at := range [][]string{parts[1:4], parts[5:8]} {
		name, ok := comparedName(app, at[0], at[1], at[2])
		if !ok {
			return web.Page{Missing: true}
		}
		names[i] = name
	}
	return web.Page{Title: names[0] + " vs " + names[1] + " · " + armorySite, Private: true,
		Description: fmt.Sprintf("%s and %s side by side: combat power, item level, gear slot by slot, stats, Daevanion boards and skills, as PLAYNC's official character pages list them.", names[0], names[1])}
}

// comparedName is a compared profile's name as the armory keeps it, "a character on <server>"
// while it keeps none, and false for a profile that is no page.
func comparedName(app core.App, region, server, characterId string) (string, bool) {
	serverId, err := strconv.Atoi(server)
	name := serversOf(app).inRegion(region, serverId)
	if err != nil || name == "" || !armoryIds.MatchString(characterId) {
		return "", false
	}
	record, err := keptProfile(app, serverId, characterId)
	if err != nil || record == nil {
		return "a character on " + name, true
	}
	if record.GetBool("hidden") {
		return "", false
	}
	var p armoryProfile
	if err := record.UnmarshalJSONField("profile", &p); err != nil || p.Name == "" {
		return "a character on " + name, true
	}
	return p.Name, true
}

// topPage names the top players page (/armory/top[/<class>], ranks.go): the first class, or the
// class the path names; a class the armory does not know is no page.
func topPage(app core.App, parts []string, base string) web.Page {
	classes, err := rankClasses(app)
	if err != nil || len(classes) == 0 {
		return web.Page{Missing: true}
	}
	class := classes[0]
	if len(parts) == 3 {
		found := slices.IndexFunc(classes, func(c rankClass) bool { return c.Name == parts[2] })
		if found < 0 {
			return web.Page{Missing: true}
		}
		class = classes[found]
	}
	path := "/armory/top/" + class.Name
	return web.Page{Title: fmt.Sprintf("Strongest %s characters of AION 2 Global · %s", class.Name, armorySite),
		Description: fmt.Sprintf("The %s characters of AION 2 Global with the most combat power that Odyle knows, from every region: up to %d, with their server, level and item level, and each one's gear, stats and skills.", class.Name, rankLimit),
		Heading:     "Top players by class", Text: fmt.Sprintf("The strongest %s characters of AION 2 Global that Odyle knows, by combat power.", class.Name),
		Data: []any{crumbs(base, [2]string{armorySite, "/armory"}, [2]string{"Top " + class.Name + " players", path})}}
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
	case "upgrade":
		return fmt.Sprintf("The upgrades (the slots, arcana, stones and Daevanion boards furthest behind the strongest %ss the armory keeps, and what they wear there)", cmp.Or(p.Class, "character"))
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

// robotsRoute answers GET /robots.txt: crawlers may read the dashboard, the armory's routes
// and images and the timers' game rules (the pages fetch them), not the rest of the API or
// the superuser dashboard; the sitemap is named under the public address.
func robotsRoute(e *core.RequestEvent) error {
	base := web.PublicURL(e.App)
	prefix := ""
	if u, err := url.Parse(base); err == nil {
		prefix = u.Path
	}
	lines := []string{"User-agent: *", "Allow: " + prefix + "/api/odyle/armory/", "Allow: " + prefix + "/api/odyle/armory-images/", "Allow: " + prefix + "/api/odyle/game", "Disallow: " + prefix + "/api/", "Disallow: " + prefix + "/_/"}
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
	entries := []sitemapEntry{{Loc: base + "/"}, {Loc: base + "/armory"}, {Loc: base + "/timers"}, {Loc: base + "/changelog"}, {Loc: base + "/privacy"}, {Loc: base + "/demo"}}
	// The top players of each class (ranks.go).
	classes, err := rankClasses(e.App)
	if err != nil {
		return err
	}
	for _, c := range classes {
		entries = append(entries, sitemapEntry{Loc: base + "/armory/top/" + url.PathEscape(c.Name)})
	}
	var kept []struct {
		Region      string `db:"region"`
		ServerId    int    `db:"serverId"`
		CharacterId string `db:"characterId"`
		FetchedAt   string `db:"fetchedAt"`
	}
	err = e.App.DB().NewQuery("SELECT region, serverId, characterId, fetchedAt FROM armory_profiles WHERE hidden = FALSE AND fetchedAt != '' AND name != '' ORDER BY viewedAt DESC LIMIT {:limit}").Bind(dbx.Params{"limit": sitemapLimit}).All(&kept)
	if err != nil {
		return err
	}
	for _, k := range kept {
		if serversOf(e.App).inRegion(k.Region, k.ServerId) == "" || !armoryIds.MatchString(k.CharacterId) {
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
