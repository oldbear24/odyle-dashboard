package odyle

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Discord markdown would let a dungeon or display name format the whole message.
var markdown = regexp.MustCompile(`([\\*_~` + "`" + `|>#\[\]()])`)

func plain(text string) string { return markdown.ReplaceAllString(text, `\$1`) }

type words struct {
	connected func(room string) string
	starts    string
	now       string
	cancelled string
	done      string
	open      string
	event     string
	going     func(n int) string
	waiting   func(n int) string
	nobody    string
	footer    func(room string) string
	// Readiness (#46): the field's name and its value before the start (an estimate), once it
	// started, and once everyone going can claim a cube.
	claims                 string
	claimsAhead, claimsNow func(k, n int) string
	partyReady             func(n int) string
}

func fraction(k, n int) string { return strconv.Itoa(k) + "/" + strconv.Itoa(n) }

// say is the words of Discord posts in a language (locales.go), English for one the server has
// no texts in.
func say(language string) words {
	d := func(key string, args ...any) string { return localeText(language, discordTexts, key, args...) }
	return words{connected: func(room string) string { return d("connected", room) }, starts: d("starts"), now: d("now"), cancelled: d("cancelled"), done: d("done"), open: d("open"), event: d("event"),
		going: func(n int) string { return d("going", n) }, waiting: func(n int) string { return d("waiting", n) }, nobody: d("nobody"), footer: func(room string) string { return d("footer", room) },
		claims: d("claims"), claimsAhead: func(k, n int) string { return d("claimsAhead", fraction(k, n)) }, claimsNow: fraction,
		partyReady: func(n int) string { return d("partyReady", fraction(n, n)) }}
}

func reminder(p runPost, language string) map[string]any {
	w := say(language)
	at, _ := parseDate(strings.Replace(p.startsAt, " ", "T", 1))
	unix := strconv.FormatInt(at.Unix(), 10)
	title, color, description := plain(p.dungeon), 0x5ee0b0, w.starts+" <t:"+unix+":R> · <t:"+unix+":f>"
	switch {
	case p.ended == "cancelled":
		title, color, description = title+" · "+w.cancelled, 0x6b7280, w.cancelled+" · <t:"+unix+":f>"
	case p.ended == "done":
		title, color, description = title+" · "+w.done, 0x3f7d63, w.done+" · <t:"+unix+":f>"
	case p.lead == 0:
		description = w.now + " · <t:" + unix + ":f>"
	}
	if p.ended == "" && p.note != "" {
		description += "\n" + plain(p.note)
	}
	if p.ended == "" && p.link != "" {
		description += "\n[" + w.open + "](" + p.link + ")"
	}
	if p.ended == "" && p.event != "" {
		description += "\n[" + w.event + "](" + p.event + ")"
	}
	embed := newObject().set("title", cut(title, 250)).set("color", color).set("description", description)
	if p.link != "" {
		embed.set("url", p.link)
	}
	if p.ended == "" {
		names := w.nobody
		if len(p.going) > 0 {
			escaped := make([]string, len(p.going))
			for i, name := range p.going {
				escaped[i] = plain(name)
			}
			names = cut(strings.Join(escaped, ", "), 1000)
		}
		fields := []any{newObject().set("name", w.going(len(p.going))).set("value", names)}
		if len(p.waiting) > 0 {
			escaped := make([]string, len(p.waiting))
			for i, name := range p.waiting {
				escaped[i] = plain(name)
			}
			fields = append(fields, newObject().set("name", w.waiting(len(p.waiting))).set("value", cut(strings.Join(escaped, ", "), 1000)))
		}
		if p.claimsKey() != "" {
			value := w.claimsAhead(p.claim, p.of)
			switch {
			case p.started && p.claim == p.of:
				value = w.partyReady(p.of)
			case p.started:
				value = w.claimsNow(p.claim, p.of)
			}
			fields = append(fields, newObject().set("name", w.claims).set("value", value))
		}
		embed.set("fields", fields)
	}
	embed.set("footer", newObject().set("text", cut(w.footer(p.room), 200)))
	message := map[string]any{"embeds": []any{embed}}
	if p.ended == "" && len(p.mentions) > 0 {
		tags := make([]string, len(p.mentions))
		for i, id := range p.mentions {
			tags[i] = "<@" + id + ">"
		}
		message["content"] = strings.Join(tags, " ")
	}
	return message
}

// roomLink is the room on the dashboard, from the server's Application URL (Settings →
// Application), or "" while that is unset, PocketBase's default (localhost) or not a web address.
func roomLink(app core.App, roomId string) string {
	base := strings.TrimRight(app.Settings().Meta.AppURL, "/")
	if !strings.HasPrefix(base, "https://") && !strings.HasPrefix(base, "http://") {
		return ""
	}
	host := strings.TrimPrefix(strings.TrimPrefix(base, "https://"), "http://")
	if host == "" || strings.ContainsAny(host, "?#") || strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.0.0.1") || strings.HasPrefix(host, "[::1]") {
		return ""
	}
	return base + "/#/room/" + roomId
}

var discordId = regexp.MustCompile(`^\d{5,30}$`)

// pings are the Discord ids of the accounts that asked to be mentioned in run reminders (#34):
// the Discord channel and runs on in their notification settings, and not in their quiet hours.
func pings(app core.App, accounts []*core.Record, at time.Time) []string {
	ids := []string{}
	for _, a := range accounts {
		n := notificationsOf(a)
		if !n.Channels.Discord || !n.Kinds.Runs || n.quietAt(at) {
			continue
		}
		auths, err := app.FindAllExternalAuthsByRecord(a)
		if err != nil {
			continue
		}
		for _, auth := range auths {
			if auth.Provider() == "discord" && discordId.MatchString(auth.ProviderId()) && !slices.Contains(ids, auth.ProviderId()) {
				ids = append(ids, auth.ProviderId())
			}
		}
	}
	return ids
}

// runContent is a run's post as it is now, with the display names of those going and, when
// asked, the ids to ping.
func runContent(app core.App, room *Room, r *Run, lead int64, mention bool) (runPost, error) {
	p := runPost{room: room.Name(), dungeon: r.Dungeon(), startsAt: r.StartsAt(), note: r.Note(), lead: lead, link: roomLink(app, room.Id), event: r.GetString("link"), going: []string{}}
	attendees := r.Attendees()
	if len(attendees) == 0 {
		return p, nil
	}
	members, err := app.FindRecordsByIds("room_members", attendees)
	if err != nil {
		return p, err
	}
	users := pluck(views[Member](members), (*Member).User)
	if len(users) == 0 {
		return p, nil
	}
	accounts, err := app.FindRecordsByIds("users", users)
	if err != nil {
		return p, err
	}
	// Names in the order they answered Going: the party, then those waiting for a place.
	userOf, nameOf := map[string]string{}, map[string]string{}
	for _, m := range views[Member](members) {
		userOf[m.Id] = m.User()
	}
	for _, a := range views[Account](accounts) {
		nameOf[a.Id] = a.DisplayName()
	}
	names := func(ids []string) []string {
		out := []string{}
		for _, id := range ids {
			if name, ok := nameOf[userOf[id]]; ok {
				out = append(out, name)
			}
		}
		return out
	}
	rules := readSettings(app)
	party, waiting := runParty(rules, r)
	p.going, p.waiting = names(party), names(waiting)
	if mention {
		p.mentions = pings(app, accounts, time.Now())
	}
	if room.DiscordReadiness() {
		entries, users, err := roomEntries(app, room.Id)
		if err != nil {
			return p, err
		}
		at := time.Now()
		start, _ := parseDate(r.StartsAt())
		p.readiness, p.started = true, !start.After(at)
		p.claim, p.of = runClaims(r, party, entries, users, at, runCost(rules, r.Dungeon()), rules.Clock)
	}
	return p, nil
}
