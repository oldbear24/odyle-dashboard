package odyle

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// Planned-run reminders in a room's Discord channel, through a webhook its owner connects
// under Room settings. The backend posts a test message when the webhook is saved and each
// run at the room's lead times (up to three, 15 minutes until chosen), and when it starts if
// the room asks for that. A post links back to the room (with the server's Application URL),
// is edited when the run changes and marked when it is cancelled or done (#33). Discord
// renders <t:…> timestamps in every reader's own time zone. Names and notes never ping
// anyone: only Going attendees who turned the Discord channel on in their notification
// settings are mentioned, by their Discord id, and only in the first post (#34).
// ODYLE_DISCORD_WEBHOOK_BASE replaces https://discord.com for tests.

var webhookPath = regexp.MustCompile(`^/api/webhooks/\d{5,30}/[\w-]{20,120}$`)
var discordHost = regexp.MustCompile(`^https://(?:(?:ptb|canary)\.)?discord(?:app)?\.com(/.*)$`)

func webhook(value any) (string, error) {
	s, _ := value.(string)
	link := trim(s)
	if link == "" {
		return "", nil
	}
	if test := os.Getenv("ODYLE_DISCORD_WEBHOOK_BASE"); test != "" && strings.HasPrefix(link, test+"/") && webhookPath.MatchString(link[len(test):]) {
		return link, nil
	}
	if m := discordHost.FindStringSubmatch(link); m == nil || !webhookPath.MatchString(m[1]) {
		return "", badRequest("Paste a Discord webhook URL (https://discord.com/api/webhooks/…).")
	}
	return link, nil
}

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

var languages = map[string]words{
	"en": {connected: func(room string) string {
		return "Odyle will remind this channel of planned runs in **" + room + "** before each one starts."
	}, starts: "Starts", now: "Starting now", cancelled: "Cancelled", done: "Done", open: "Open the room", event: "The event",
		going: func(n int) string { return "Going (" + strconv.Itoa(n) + ")" }, waiting: func(n int) string { return "Waiting for a place (" + strconv.Itoa(n) + ")" }, nobody: "Nobody yet", footer: func(room string) string { return "Odyle · " + room },
		claims: "Can claim a cube", claimsAhead: func(k, n int) string { return fraction(k, n) + " by the start (an estimate)" }, claimsNow: fraction,
		partyReady: func(n int) string { return fraction(n, n) + " · party ready" }},
	"cs": {connected: func(room string) string {
		return "Odyle bude tomuto kanálu připomínat plánované běhy místnosti **" + room + "** před začátkem každého."
	}, starts: "Začíná", now: "Začíná teď", cancelled: "Zrušeno", done: "Hotovo", open: "Otevřít místnost", event: "Událost",
		going: func(n int) string { return "Jdou (" + strconv.Itoa(n) + ")" }, waiting: func(n int) string { return "Čekají na místo (" + strconv.Itoa(n) + ")" }, nobody: "Zatím nikdo", footer: func(room string) string { return "Odyle · " + room },
		claims: "Vezme si kostku", claimsAhead: func(k, n int) string { return fraction(k, n) + " do začátku (odhad)" }, claimsNow: fraction,
		partyReady: func(n int) string { return fraction(n, n) + " · parta je připravená" }},
}

func fraction(k, n int) string { return strconv.Itoa(k) + "/" + strconv.Itoa(n) }

func say(language string) words {
	if w, ok := languages[language]; ok {
		return w
	}
	return languages["en"]
}

// discordLeadChoices are the times before a run a room can choose for its reminders, in minutes.
var discordLeadChoices = []int64{5, 10, 15, 30, 60, 120}

// checkLeads validates a room's reminder times: one to three of the choices, largest first.
func checkLeads(value any) ([]int64, error) {
	list, ok := value.([]any)
	if !ok || len(list) == 0 || len(list) > 3 {
		return nil, badRequest("Choose one to three reminder times.")
	}
	out := []int64{}
	for _, v := range list {
		n, ok := v.(float64)
		lead := int64(n)
		if !ok || float64(lead) != n || !slices.Contains(discordLeadChoices, lead) {
			return nil, badRequest("Choose reminder times from the list.")
		}
		if slices.Contains(out, lead) {
			return nil, badRequest("Choose different reminder times.")
		}
		out = append(out, lead)
	}
	slices.Sort(out)
	slices.Reverse(out)
	return out, nil
}

// postWebhook sends one message and answers Discord's answer. Only the ids in mentions can
// be pinged.
func postWebhook(link string, payload map[string]any, mentions []string) (response, error) {
	return sendWebhook("POST", link+"?wait=true", payload, mentions)
}

// editWebhook changes a message the webhook posted; its mentions line stays and pings nobody again.
func editWebhook(link, messageId string, payload map[string]any) (response, error) {
	return sendWebhook("PATCH", link+"/messages/"+messageId, map[string]any{"embeds": payload["embeds"]}, nil)
}

func sendWebhook(method, link string, payload map[string]any, mentions []string) (response, error) {
	allowed := map[string]any{"parse": []any{}}
	if len(mentions) > 0 {
		allowed["users"] = mentions
	}
	message := newObject().set("allowed_mentions", allowed)
	for _, key := range []string{"content", "embeds"} {
		if v, ok := payload[key]; ok {
			message.set(key, v)
		}
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return response{}, err
	}
	return send(call{method: method, url: link, headers: map[string]string{"content-type": "application/json", "user-agent": userAgent}, payload: raw, timeout: 10 * time.Second, limit: 64 << 10})
}

// connectWebhook makes the test post of a newly connected webhook and answers the webhook's
// name in Discord ("" when Discord does not say); it fails when Discord refuses the post.
func connectWebhook(link, roomName, language string) (string, error) {
	res, err := postWebhook(link, map[string]any{"content": say(language).connected(plain(roomName))}, nil)
	if err != nil {
		return "", badRequest("Discord could not be reached. Try again in a minute.")
	}
	if res.status == http.StatusTooManyRequests {
		return "", badRequest("Discord asked to slow down. Try again in a minute.")
	}
	if res.status < 200 || res.status >= 300 {
		return "", badRequest("Discord did not accept this webhook. Copy it again from the channel settings.")
	}
	name := ""
	if found, err := send(call{method: "GET", url: link, headers: map[string]string{"user-agent": userAgent}, timeout: 10 * time.Second, limit: 64 << 10}); err == nil && found.status == 200 {
		if body, ok := found.json().(map[string]any); ok {
			name = cut(textOf(body["name"]), 100)
		}
	}
	return name, nil
}

// Discord limits how often a webhook posts and answers 429 with how long to wait, for
// that webhook or, when the limit is global, for all of them. The reminders job leaves
// a waiting webhook alone until then; its runs stay due for a later run.
type webhookWaits struct {
	mu    sync.Mutex
	until map[string]time.Time // by webhook digest; "*" for every webhook
}

func (w *webhookWaits) waiting(link string, at time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return at.Before(w.until[security.SHA256(link)]) || at.Before(w.until["*"])
}

func (w *webhookWaits) wait(link string, res response, at time.Time) time.Duration {
	wait := max(retryAfter(res), time.Second)
	key := security.SHA256(link)
	if strings.EqualFold(res.header.Get("X-RateLimit-Global"), "true") {
		key = "*"
	} else if body, ok := res.json().(map[string]any); ok && body["global"] == true {
		key = "*"
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.until == nil {
		w.until = map[string]time.Time{}
	}
	for k, until := range w.until {
		if !at.Before(until) {
			delete(w.until, k)
		}
	}
	w.until[key] = at.Add(wait)
	return wait
}

// runPost is what a reminder shows: the run as it is now, or as it was once it ended.
type runPost struct {
	room, dungeon, startsAt, note string
	going                         []string // its party (runParty), in the order they answered
	waiting                       []string // those going beyond the party size, first come first
	lead                          int64    // minutes before the start; 0: it starts now
	ended                         string   // "", "cancelled" or "done"
	link                          string   // the room on the dashboard; "" without an Application URL
	event                         string   // the run's event elsewhere (#35)
	mentions                      []string
	// Readiness, when the room shows it (#46): how many of those going can claim a cube at the
	// start (now, once it started). Counts only: the channel may include people outside the room.
	readiness, started bool
	claim, of          int
}

// claimsKey is what a post shows of readiness, kept on the post so it is edited only when that changes.
func (p runPost) claimsKey() string {
	if !p.readiness || p.of == 0 {
		return ""
	}
	return fmt.Sprintf("%d/%d/%t", p.claim, p.of, p.started)
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

// deliveryStatus is how a room's webhook last fared, for its owner under Room settings.
type deliveryStatus struct {
	OkAt      string `json:"okAt,omitempty"`
	Error     string `json:"error,omitempty"`
	ErrorAt   string `json:"errorAt,omitempty"`
	Dropped   string `json:"dropped,omitempty"` // why the webhook was dropped
	DroppedAt string `json:"droppedAt,omitempty"`
}

func statusOf(room *Room) deliveryStatus {
	var s deliveryStatus
	_ = json.Unmarshal([]byte(room.GetString("discordStatus")), &s)
	return s
}

// noteDelivery keeps how a delivery went on the room, with a single-field write (not news).
func noteDelivery(app core.App, roomId string, change func(*deliveryStatus)) {
	room, err := findAs[Room](app, "party_rooms", roomId)
	if err != nil {
		return
	}
	s := statusOf(room)
	change(&s)
	raw, _ := json.Marshal(s)
	if _, err := app.DB().NewQuery("UPDATE party_rooms SET discordStatus = {:status} WHERE id = {:id}").Bind(dbx.Params{"status": string(raw), "id": roomId}).Execute(); err != nil {
		warn(app, "Odyle could not keep how a Discord delivery went", "room", roomId, "error", err.Error())
	}
}

type failer func(text, event string, args ...any)

// unknownMessage is Discord's error code for a message that is gone (deleted in the channel).
const unknownMessage = 10008

func discordCode(res response) int {
	if body, ok := res.json().(map[string]any); ok {
		return int(number(body["code"]))
	}
	return 0
}

// delivered reports whether Discord took a post or an edit, and otherwise notes why: a limit
// leaves the webhook alone until it ends, and a webhook Discord no longer knows (401, 404) is
// dropped, its room's members told and its owner shown why.
func delivered(app core.App, room *Room, link string, res response, fail failer, what string) (bool, error) {
	status := res.status
	switch {
	case status >= 200 && status < 300:
		noteDelivery(app, room.Id, func(s *deliveryStatus) { s.OkAt, s.Error, s.ErrorAt = now(), "", "" })
		return true, nil
	case status == http.StatusTooManyRequests:
		wait := stateOf(app).webhooks.wait(link, res, time.Now())
		fail(what+" waits: Discord asked to wait "+wait.Round(time.Second).String(), "Odyle Discord post waits", "room", room.Id, "retryAfter", wait.String())
	case status == 401 || status == 404:
		fresh, err := findAs[Room](app, "party_rooms", room.Id)
		if err != nil {
			return false, err
		}
		// Replaced meanwhile: the new webhook is kept.
		if fresh.DiscordWebhook() != link {
			return false, nil
		}
		s := statusOf(fresh)
		s.Dropped, s.DroppedAt = "Discord answered "+strconv.Itoa(status)+": the webhook was deleted or its channel is gone.", now()
		raw, _ := json.Marshal(s)
		fresh.SetDiscord("", "")
		fresh.Set("discordStatus", string(raw))
		if err := app.Save(fresh); err != nil {
			return false, err
		}
		notify(app, []string{room.Id})
		fail("Dropped the Discord webhook of room "+room.Id+": Discord answered "+strconv.Itoa(status), "Odyle dropped a Discord webhook that Discord no longer knows", "room", room.Id, "status", status)
	default:
		noteDelivery(app, room.Id, func(s *deliveryStatus) { s.Error, s.ErrorAt = "Discord answered "+strconv.Itoa(status)+".", now() })
		fail(what+" failed: Discord answered "+strconv.Itoa(status), "Odyle Discord post failed", "room", room.Id, "status", status)
	}
	return false, nil
}

// startPostWindow is how long after its start a run can still get its start post.
const startPostWindow = 5 * time.Minute

// dueLead is the lead a run is due to be posted at now, if any: the smallest of its room's
// lead times that has come, unless a post for this start came close enough to it (within half
// the lead again, so a run planned 20 minutes ahead is posted once, not for 60 and again for
// 15), or 0 for the start post in the first five minutes, when the room asks for it.
func dueLead(room *Room, r *Run, posts []*core.Record, at time.Time) (int64, bool) {
	start := timeOf(r.StartsAt())
	postedAt := []time.Time{}
	for _, p := range posts {
		if p.GetDateTime("startsAt").Time().Equal(start) {
			postedAt = append(postedAt, p.GetDateTime("postedAt").Time())
		}
	}
	// Announced before posts were kept (or by an earlier version): that counts too.
	if reminded := r.GetString("remindedAt"); reminded != "" {
		postedAt = append(postedAt, timeOf(reminded))
	}
	covered := func(lead int64) bool {
		window := time.Duration(lead) * time.Minute * 3 / 2
		for _, p := range postedAt {
			if start.Sub(p) <= window {
				return true
			}
		}
		return false
	}
	if !at.Before(start) {
		return 0, room.DiscordStartPost() && at.Before(start.Add(startPostWindow)) && !covered(0)
	}
	leads := room.DiscordLeads()
	for i := len(leads) - 1; i >= 0; i-- {
		if lead := leads[i]; start.Sub(at) <= time.Duration(lead)*time.Minute {
			return lead, !covered(lead)
		}
	}
	return 0, false
}

// remindRuns is a job, every minute. It posts each run to its room's Discord channel at the
// room's lead times (at once when it was planned later than the first) and, when the room
// asks for it, as it starts; it edits posts whose run changed and marks those whose run was
// cancelled or done. A webhook Discord no longer knows is dropped. Paused by superusers
// (Server controls), runs starting meanwhile are not announced afterwards. Discord limits
// each webhook, so the posts of one webhook go one after another; up to four webhooks post
// at the same time, so one slow channel does not hold up the others. Posts are forgotten two
// days after they were made.
func remindRuns(app core.App) (result, error) {
	if readSettings(app).RemindersPaused {
		return result{Skipped: "paused"}, nil
	}
	var mu sync.Mutex
	out := result{}
	// text is the job's last error on the Background jobs page; the log line keeps the fields.
	fail := func(text, event string, args ...any) {
		mu.Lock()
		out.fail(text)
		mu.Unlock()
		warn(app, event, args...)
	}
	at := time.Now()
	if _, err := app.DB().NewQuery("DELETE FROM discord_posts WHERE postedAt < {:old}").Bind(dbx.Params{"old": stamp(at.Add(-48 * time.Hour))}).Execute(); err != nil {
		return out, err
	}
	longest := slices.Max(discordLeadChoices)
	found, err := app.FindRecordsByFilter("room_runs", "room.discordWebhook != '' && startsAt > {:since} && startsAt <= {:until}", "startsAt", 200, 0,
		dbx.Params{"since": stamp(at.Add(-startPostWindow)), "until": stamp(at.Add(time.Duration(longest) * time.Minute))})
	if err != nil {
		return out, err
	}
	runs := views[Run](found)
	rooms, err := roomsByID(app, pluck(runs, (*Run).Room))
	if err != nil {
		return result{}, err
	}
	postsOf := map[string][]*core.Record{}
	if len(runs) > 0 {
		ids := make([]any, len(runs))
		for i, r := range runs {
			ids[i] = r.Id
		}
		posts, err := app.FindAllRecords("discord_posts", dbx.In("run", ids...))
		if err != nil {
			return result{}, err
		}
		for _, p := range posts {
			postsOf[p.GetString("run")] = append(postsOf[p.GetString("run")], p)
		}
	}
	type work struct {
		label string
		do    func() (bool, error)
	}
	groups, order := map[string][]work{}, []string{}
	add := func(link string, w work) {
		if groups[link] == nil {
			order = append(order, link)
		}
		groups[link] = append(groups[link], w)
	}
	for _, r := range runs {
		room := rooms[r.Room()]
		if room == nil || room.DiscordWebhook() == "" {
			continue
		}
		if lead, due := dueLead(room, r, postsOf[r.Id], at); due {
			add(room.DiscordWebhook(), work{"Reminder for run " + r.Id, func() (bool, error) { return postRun(app, r, lead, fail) }})
		}
	}
	// Posts to bring up to date: their run changed, was cancelled or was done, or what it shows
	// of readiness changed.
	if err := watchReadiness(app, at); err != nil {
		fail("Readiness of Discord posts failed: "+message(err), "Odyle Discord readiness failed", "error", message(err))
	}
	dirty, err := app.FindRecordsByFilter("discord_posts", "dirty = true && messageId != ''", "postedAt", 100, 0)
	if err != nil {
		return result{}, err
	}
	editRooms, err := roomsByID(app, pluckRecords(dirty, "room"))
	if err != nil {
		return result{}, err
	}
	for _, p := range dirty {
		link := ""
		if room := editRooms[p.GetString("room")]; room != nil {
			link = room.DiscordWebhook()
		}
		add(link, work{"Update of a Discord post of run " + p.GetString("run"), func() (bool, error) { return editPost(app, p, fail) }})
	}
	slots := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, link := range order {
		wg.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			for _, w := range groups[link] {
				done, err := safely(w.do)
				if err != nil {
					fail(w.label+" failed: "+message(err), "Odyle Discord post failed", "work", w.label, "error", message(err))
				} else if done {
					mu.Lock()
					out.Done++
					mu.Unlock()
				}
			}
		})
	}
	wg.Wait()
	return out, nil
}

func pluckRecords(records []*core.Record, field string) []string {
	out := make([]string, len(records))
	for i, r := range records {
		out[i] = r.GetString(field)
	}
	return out
}

// safely is do with a panic turned into its error.
func safely(do func() (bool, error)) (done bool, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("the Discord post failed: %v", p)
		}
	}()
	return do()
}

// postRun posts a run at a lead and reports whether Discord took it. The post is kept before
// it is sent and forgotten when Discord does not take it, so a failed save never posts twice.
func postRun(app core.App, r *Run, lead int64, fail failer) (bool, error) {
	room, err := findAs[Room](app, "party_rooms", r.Room())
	if err != nil {
		return false, err
	}
	link := room.DiscordWebhook()
	// Dropped by an earlier post of this job (Discord no longer knew it), or disconnected meanwhile.
	if link == "" || stateOf(app).webhooks.waiting(link, time.Now()) {
		return false, nil
	}
	p, err := runContent(app, room, r, lead, true)
	if err != nil {
		return false, err
	}
	collection, err := app.FindCollectionByNameOrId("discord_posts")
	if err != nil {
		return false, err
	}
	post := core.NewRecord(collection)
	post.Set("room", room.Id)
	post.Set("run", r.Id)
	post.Set("webhook", security.SHA256(link))
	post.Set("lead", lead)
	post.Set("startsAt", r.StartsAt())
	post.Set("dungeon", r.Dungeon())
	post.Set("postedAt", now())
	post.Set("claims", p.claimsKey())
	if err := app.Save(post); err != nil {
		return false, err
	}
	message := reminder(p, room.DiscordLanguage())
	res, err := postWebhook(link, message, p.mentions)
	// A short wait (a burst of runs in one room) is waited out once.
	if wait := retryAfter(res); err == nil && res.status == http.StatusTooManyRequests && wait <= 2*time.Second {
		time.Sleep(wait)
		res, err = postWebhook(link, message, p.mentions)
	}
	forget := func() {
		if err := app.Delete(post); err != nil {
			warn(app, "Odyle could not forget a Discord post that failed", "run", r.Id, "error", err.Error())
		}
	}
	if err != nil {
		forget()
		noteDelivery(app, room.Id, func(s *deliveryStatus) { s.Error, s.ErrorAt = "Discord could not be reached.", now() })
		return false, err
	}
	ok, err := delivered(app, room, link, res, fail, "Reminder for run "+r.Id)
	if !ok {
		forget()
		return false, err
	}
	// Discord answers the message with ?wait=true; its id lets the post be edited later.
	if body, isMap := res.json().(map[string]any); isMap && discordId.MatchString(textOf(body["id"])) {
		if _, err := app.DB().NewQuery("UPDATE discord_posts SET messageId = {:message} WHERE id = {:id}").Bind(dbx.Params{"message": textOf(body["id"]), "id": post.Id}).Execute(); err != nil {
			return true, err
		}
	}
	_, err = app.DB().NewQuery("UPDATE room_runs SET remindedAt = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": now(), "id": r.Id}).Execute()
	return true, err
}

// markDirty marks posts for an edit (bind {:marked} to stamp(time.Now())). It moves their
// updated time too, so editPost can tell a post marked again while it edited the post.
const markDirty = "dirty = TRUE, updated = {:marked}"

// editPost brings a post up to date with its run, or marks it once the run was cancelled or
// done. A post whose message is gone in Discord, whose run is gone or whose webhook was
// replaced or disconnected since is left as it is.
func editPost(app core.App, post *core.Record, fail failer) (bool, error) {
	// The mark is cleared only if the post is as it was read: one marked again meanwhile (the
	// run cancelled or changed while Discord answered) stays marked for the next edit.
	unmark := func(set string, params dbx.Params) error {
		params["id"], params["updated"], params["ended"] = post.Id, post.GetString("updated"), post.GetString("ended")
		_, err := app.DB().NewQuery("UPDATE discord_posts SET dirty = FALSE" + set + " WHERE id = {:id} AND updated = {:updated} AND ended = {:ended}").Bind(params).Execute()
		return err
	}
	settled := func() error { return unmark("", dbx.Params{}) }
	room, err := findAs[Room](app, "party_rooms", post.GetString("room"))
	if err != nil {
		return false, err
	}
	link := room.DiscordWebhook()
	if link == "" || security.SHA256(link) != post.GetString("webhook") {
		return false, settled()
	}
	if stateOf(app).webhooks.waiting(link, time.Now()) {
		return false, nil
	}
	p := runPost{room: room.Name(), dungeon: post.GetString("dungeon"), startsAt: post.GetString("startsAt"), ended: post.GetString("ended"), link: roomLink(app, room.Id)}
	if p.ended == "" {
		r, err := findAs[Run](app, "room_runs", post.GetString("run"))
		if isNoRows(err) {
			return false, settled()
		}
		if err != nil {
			return false, err
		}
		if p, err = runContent(app, room, r, post.GetInt64("lead"), false); err != nil {
			return false, err
		}
	}
	res, err := editWebhook(link, post.GetString("messageId"), reminder(p, room.DiscordLanguage()))
	if err != nil {
		return false, err
	}
	if res.status == http.StatusNotFound && discordCode(res) == unknownMessage {
		return false, app.Delete(post)
	}
	ok, err := delivered(app, room, link, res, fail, "Update of a Discord post of run "+post.GetString("run"))
	if ok {
		return true, unmark(", claims = {:claims}", dbx.Params{"claims": p.claimsKey()})
	}
	return false, err
}

// watchReadiness marks for an edit the posts whose readiness changed (#46): those of rooms that
// show it, until five minutes after their run started (the last edit says whether the party was
// ready), and those still showing it after their room turned it off. Each run is counted once;
// an unchanged count edits nothing, and the job runs each minute, so a post changes at most
// once a minute.
func watchReadiness(app core.App, at time.Time) error {
	found, err := app.FindRecordsByFilter("discord_posts", "ended = '' && messageId != '' && dirty = false && startsAt > {:since} && (room.discordReadiness = true || claims != '')", "postedAt", 200, 0,
		dbx.Params{"since": stamp(at.Add(-startPostWindow))})
	if err != nil {
		return err
	}
	shows := map[string]string{}
	for _, post := range found {
		runId := post.GetString("run")
		key, counted := shows[runId]
		if !counted {
			room, err := findAs[Room](app, "party_rooms", post.GetString("room"))
			if err != nil {
				return err
			}
			r, err := findAs[Run](app, "room_runs", runId)
			if isNoRows(err) {
				continue
			}
			if err != nil {
				return err
			}
			p, err := runContent(app, room, r, post.GetInt64("lead"), false)
			if err != nil {
				return err
			}
			key = p.claimsKey()
			shows[runId] = key
		}
		if key != post.GetString("claims") {
			if _, err := app.DB().NewQuery("UPDATE discord_posts SET " + markDirty + " WHERE id = {:id}").Bind(dbx.Params{"id": post.Id, "marked": stamp(time.Now())}).Execute(); err != nil {
				return err
			}
		}
	}
	return nil
}

// endPosts marks a run's posts for the job to show it cancelled or done; the run is deleted
// right after, so each post keeps its dungeon and start.
func endPosts(app core.App, r *Run, how string) error {
	_, err := app.DB().NewQuery("UPDATE discord_posts SET ended = {:how}, dungeon = {:dungeon}, startsAt = {:starts}, " + markDirty + " WHERE run = {:run} AND messageId != ''").
		Bind(dbx.Params{"how": how, "dungeon": r.Dungeon(), "starts": r.StartsAt(), "run": r.Id, "marked": stamp(time.Now())}).Execute()
	return err
}

// watchRunPosts marks a run's Discord posts for an edit when what they show changed.
func watchRunPosts(app core.App) {
	app.OnRecordAfterUpdateSuccess("room_runs").BindFunc(func(e *core.RecordEvent) error {
		before := e.Record.Original()
		for _, f := range []string{"dungeon", "startsAt", "note", "attendees", "link"} {
			if fmt.Sprint(before.Get(f)) != fmt.Sprint(e.Record.Get(f)) {
				if _, err := e.App.DB().NewQuery("UPDATE discord_posts SET " + markDirty + " WHERE run = {:run} AND messageId != ''").Bind(dbx.Params{"run": e.Record.Id, "marked": stamp(time.Now())}).Execute(); err != nil {
					warn(e.App, "Odyle could not mark Discord posts for an edit", "run", e.Record.Id, "error", err.Error())
				}
				break
			}
		}
		return e.Next()
	})
}
