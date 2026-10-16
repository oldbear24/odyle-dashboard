package odyle

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// discordStand answers like Discord's webhook API: posts with a message id (?wait=true),
// edits, and the webhook's name; answers queued in answers go first.
type discordStand struct {
	url      string
	mu       sync.Mutex
	requests []discordRequest
	answers  chan func(http.ResponseWriter)
	ids      atomic.Int64
}

type discordRequest struct {
	method, path string
	body         map[string]any
}

func newDiscordStand(t *testing.T) *discordStand {
	t.Helper()
	s := &discordStand{answers: make(chan func(http.ResponseWriter), 10)}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		s.mu.Lock()
		s.requests = append(s.requests, discordRequest{r.Method, r.URL.Path, body})
		s.mu.Unlock()
		select {
		case answer := <-s.answers:
			answer(w)
			return
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case "GET":
			w.Write([]byte(`{"name":"Odyle hook","channel_id":"1"}`))
		case "POST":
			fmt.Fprintf(w, `{"id":"%d"}`, 100000+s.ids.Add(1))
		default:
			w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)
	t.Setenv("ODYLE_DISCORD_WEBHOOK_BASE", server.URL)
	s.url = server.URL
	return s
}

func (s *discordStand) of(method string) []discordRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []discordRequest{}
	for _, r := range s.requests {
		if r.method == method {
			out = append(out, r)
		}
	}
	return out
}

func (s *discordStand) answer(status int, body string) {
	s.answers <- func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(body))
	}
}

// embedOf is a request's first embed.
func embedOf(t *testing.T, r discordRequest) map[string]any {
	t.Helper()
	embeds, _ := r.body["embeds"].([]any)
	if len(embeds) == 0 {
		t.Fatalf("no embed: %v", r.body)
	}
	return embeds[0].(map[string]any)
}

func remindOnce(t *testing.T, app core.App) result {
	t.Helper()
	out, err := remindRuns(app)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func discordRoom(t *testing.T, app core.App, owner *core.Record, link string, values map[string]any) (*core.Record, *core.Record) {
	t.Helper()
	fields := map[string]any{"owner": owner.Id, "name": "Raid", "cost": 40, "discordWebhook": link + "/api/webhooks/1/abcdefghijklmnopqrstuvwx"}
	for k, v := range values {
		fields[k] = v
	}
	room := saved(t, app, "party_rooms", fields)
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": owner.Id, "role": "owner"})
	return room, member
}

func TestDiscordLeadsComeOnceEachAndCloseOnesTogether(t *testing.T) {
	app := newTestApp(t)
	collection, _ := app.FindCollectionByNameOrId("party_rooms")
	runs, _ := app.FindCollectionByNameOrId("room_runs")
	posts, _ := app.FindCollectionByNameOrId("discord_posts")
	start := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	room := viewOf[Room](core.NewRecord(collection))
	room.Set("discordLeads", []int64{60, 15})
	run := viewOf[Run](core.NewRecord(runs))
	run.Set("startsAt", start.Format(isoLayout))
	postAt := func(before time.Duration) *core.Record {
		p := core.NewRecord(posts)
		p.Set("startsAt", start.Format(isoLayout))
		p.Set("postedAt", start.Add(-before).Format(isoLayout))
		return p
	}
	for _, c := range []struct {
		name   string
		before time.Duration
		posted []*core.Record
		lead   int64
		due    bool
	}{
		{"before the first lead", 90 * time.Minute, nil, 0, false},
		{"the first lead", 59 * time.Minute, nil, 60, true},
		{"posted for it", 40 * time.Minute, []*core.Record{postAt(60 * time.Minute)}, 60, false},
		{"the second lead", 14 * time.Minute, []*core.Record{postAt(60 * time.Minute)}, 15, true},
		// Planned 20 minutes ahead: posted at once for 60, which covers 15 as well.
		{"a late plan covers the next lead", 14 * time.Minute, []*core.Record{postAt(20 * time.Minute)}, 15, false},
		{"started, no start post asked for", -time.Minute, nil, 0, false},
	} {
		lead, due := dueLead(room, run, c.posted, start.Add(-c.before))
		if lead != c.lead || due != c.due {
			t.Errorf("%s: lead %d, due %v", c.name, lead, due)
		}
	}
	room.Set("discordStartPost", true)
	if lead, due := dueLead(room, run, []*core.Record{postAt(15 * time.Minute)}, start.Add(time.Minute)); lead != 0 || !due {
		t.Errorf("start post: %d, %v", lead, due)
	}
	if _, due := dueLead(room, run, nil, start.Add(6*time.Minute)); due {
		t.Error("a start post comes only in the first five minutes")
	}
	// A run announced before posts were kept is not announced again.
	run.Set("remindedAt", start.Add(-15*time.Minute).Format(isoLayout))
	if _, due := dueLead(room, run, nil, start.Add(-14*time.Minute)); due {
		t.Error("remindedAt counts as a post")
	}
	// Leads saved by hand or by an older client: only the choices, 15 when none.
	room.Set("discordLeads", []int64{7, 120, 120, 5, 30, 60})
	if leads := room.DiscordLeads(); fmt.Sprint(leads) != "[120 30 5]" {
		t.Errorf("leads %v", leads)
	}
	room.Set("discordLeads", nil)
	if leads := room.DiscordLeads(); fmt.Sprint(leads) != "[15]" {
		t.Errorf("default leads %v", leads)
	}
}

func TestDiscordRemindersLinkBackAndUpdateInPlace(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	app.Settings().Meta.AppURL = "https://odyle.example/"
	user := newUser(t, app, "Planner")
	room, member := discordRoom(t, app, user, hook.url, map[string]any{"discordLeads": []int64{60, 15}, "discordStartPost": true})
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(50 * time.Minute)), "plannedBy": member.Id, "attendees": []string{member.Id}})
	link := "https://odyle.example/#/room/" + room.Id
	// The first lead that has come: one post, linking back to the room.
	if out := remindOnce(t, app); out.Done != 1 || len(hook.of("POST")) != 1 {
		t.Fatalf("first post: %v, %d posts", out, len(hook.of("POST")))
	}
	first := embedOf(t, hook.of("POST")[0])
	if first["url"] != link || !strings.Contains(first["description"].(string), "[Open the room]("+link+")") || first["title"] != "Fire Temple" {
		t.Fatalf("embed %v", first)
	}
	if _, ok := hook.of("POST")[0].body["content"]; ok {
		t.Fatalf("nobody asked to be pinged: %v", hook.of("POST")[0].body)
	}
	if out := remindOnce(t, app); out.Done != 0 || len(hook.of("POST")) != 1 {
		t.Fatalf("posted again: %v", out)
	}
	// A change edits the post in place, once.
	r, err := findAs[Run](app, "room_runs", run.Id)
	if err != nil {
		t.Fatal(err)
	}
	r.SetNote("Bring potions")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	if out := remindOnce(t, app); out.Done != 1 || len(hook.of("PATCH")) != 1 {
		t.Fatalf("edit: %v, %d edits", out, len(hook.of("PATCH")))
	}
	edit := hook.of("PATCH")[0]
	if edit.path != "/api/webhooks/1/abcdefghijklmnopqrstuvwx/messages/100001" || !strings.Contains(embedOf(t, edit)["description"].(string), "Bring potions") {
		t.Fatalf("edit %v", edit)
	}
	if _, ok := edit.body["content"]; ok {
		t.Fatalf("an edit keeps the content: %v", edit.body)
	}
	if out := remindOnce(t, app); out.Done != 0 || len(hook.of("PATCH")) != 1 {
		t.Fatalf("edited again: %v", out)
	}
	// Moved to ten minutes ahead: the old post shows the new time, and the 15-minute post comes.
	r, _ = findAs[Run](app, "room_runs", run.Id)
	r.SetStart(stamp(time.Now().Add(10 * time.Minute)))
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	if out := remindOnce(t, app); out.Done != 2 || len(hook.of("POST")) != 2 || len(hook.of("PATCH")) != 2 {
		t.Fatalf("moved: %v, %d posts, %d edits", out, len(hook.of("POST")), len(hook.of("PATCH")))
	}
	// It starts (its posts came before): the start post.
	started, before := stamp(time.Now().Add(-time.Minute)), stamp(time.Now().Add(-11*time.Minute))
	for _, q := range []string{"UPDATE room_runs SET startsAt = {:at}, remindedAt = {:before} WHERE id = {:id}", "UPDATE discord_posts SET startsAt = {:at}, postedAt = {:before} WHERE run = {:id}"} {
		if _, err := app.DB().NewQuery(q).Bind(dbx.Params{"at": started, "before": before, "id": run.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	if out := remindOnce(t, app); out.Done != 1 || len(hook.of("POST")) != 3 || !strings.HasPrefix(embedOf(t, hook.of("POST")[2])["description"].(string), "Starting now") {
		t.Fatalf("start post: %v, %d posts", out, len(hook.of("POST")))
	}
	if out := remindOnce(t, app); out.Done != 0 || len(hook.of("POST")) != 3 {
		t.Fatalf("start posted again: %v", out)
	}
	// Cancelled: each post is marked, and nothing is posted for it any more.
	ask(t, app, "POST", "/api/odyle/plan", tokenOf(t, user), `{"roomId":"`+room.Id+`","id":"`+run.Id+`","remove":true}`, 200)
	if out := remindOnce(t, app); out.Done != 3 || len(hook.of("PATCH")) != 5 {
		t.Fatalf("cancelled: %v, %d edits", out, len(hook.of("PATCH")))
	}
	for _, e := range hook.of("PATCH")[2:] {
		embed := embedOf(t, e)
		if embed["title"] != "Fire Temple · Cancelled" || embed["fields"] != nil {
			t.Fatalf("cancelled embed %v", embed)
		}
	}
	// How it went is kept for the owner.
	fresh, _ := findAs[Room](app, "party_rooms", room.Id)
	if s := statusOf(fresh); s.OkAt == "" || s.Error != "" {
		t.Fatalf("status %+v", s)
	}
}

func TestDiscordPingsOnlyThoseWhoAskedAndNeverInEdits(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	asked, quiet, other := newUser(t, app, "Asked"), newUser(t, app, "Quiet"), newUser(t, app, "Other")
	users, _ := app.FindCollectionByNameOrId("users")
	for i, u := range []*core.Record{asked, quiet, other} {
		auth := core.NewExternalAuth(app)
		auth.SetCollectionRef(users.Id)
		auth.SetRecordRef(u.Id)
		auth.SetProvider("discord")
		auth.SetProviderId(fmt.Sprintf("12345678901234567%d", i))
		if err := app.Save(auth); err != nil {
			t.Fatal(err)
		}
	}
	on := `{"channels":{"tray":true,"browser":true,"push":true,"discord":true},"leadMinutes":[15],"kinds":{"runs":true,"cap":false},"capTicks":1,"quiet":{"from":"","to":"","timeZone":""}}`
	asked.Set("notifications", on)
	// Quiet hours over the whole day hold the ping too.
	quiet.Set("notifications", strings.Replace(on, `"from":"","to":"","timeZone":""`, `"from":"00:00","to":"23:59","timeZone":"UTC"`, 1))
	for _, u := range []*core.Record{asked, quiet} {
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
	}
	room, member := discordRoom(t, app, asked, hook.url, nil)
	going := []string{member.Id}
	for _, u := range []*core.Record{quiet, other} {
		going = append(going, saved(t, app, "room_members", map[string]any{"room": room.Id, "user": u.Id, "role": "reporter"}).Id)
	}
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(10 * time.Minute)), "plannedBy": member.Id, "attendees": going})
	remindOnce(t, app)
	post := hook.of("POST")[0].body
	allowed, _ := json.Marshal(post["allowed_mentions"])
	if post["content"] != "<@123456789012345670>" || string(allowed) != `{"parse":[],"users":["123456789012345670"]}` {
		t.Fatalf("post %v, allowed %s", post["content"], allowed)
	}
	r, _ := findAs[Run](app, "room_runs", run.Id)
	r.SetAttendees(going[:2])
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	remindOnce(t, app)
	edit := hook.of("PATCH")[0].body
	allowed, _ = json.Marshal(edit["allowed_mentions"])
	if _, ok := edit["content"]; ok || string(allowed) != `{"parse":[]}` {
		t.Fatalf("edit %v", edit)
	}
}

func TestDiscordPostsThatFailAreRetriedAndGoneOnesForgotten(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	user := newUser(t, app, "Planner")
	room, member := discordRoom(t, app, user, hook.url, nil)
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(10 * time.Minute)), "plannedBy": member.Id, "attendees": []string{member.Id}})
	// Not taken: the post is forgotten, so the next run of the job posts it.
	hook.answer(500, `{}`)
	if out := remindOnce(t, app); out.Done != 0 || out.Failed != 1 || countOf(t, app, "discord_posts") != 0 {
		t.Fatalf("failed post: %v", out)
	}
	fresh, _ := findAs[Room](app, "party_rooms", room.Id)
	if s := statusOf(fresh); s.Error != "Discord answered 500." {
		t.Fatalf("status %+v", s)
	}
	if out := remindOnce(t, app); out.Done != 1 || countOf(t, app, "discord_posts") != 1 {
		t.Fatalf("retried: %v", out)
	}
	// A message deleted in the channel is forgotten; the webhook stays.
	if _, err := app.DB().NewQuery("UPDATE discord_posts SET dirty = TRUE").Execute(); err != nil {
		t.Fatal(err)
	}
	hook.answer(404, `{"message":"Unknown Message","code":10008}`)
	if out := remindOnce(t, app); out.Done != 0 || countOf(t, app, "discord_posts") != 0 {
		t.Fatalf("gone message: %v", out)
	}
	if fresh, _ := findAs[Room](app, "party_rooms", room.Id); fresh.DiscordWebhook() == "" {
		t.Fatal("the webhook was dropped for a gone message")
	}
	// A webhook Discord no longer knows is dropped, and its owner sees why.
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Nochsana", "startsAt": stamp(time.Now().Add(12 * time.Minute)), "plannedBy": member.Id})
	hook.answer(404, `{"message":"Unknown Webhook","code":10015}`)
	remindOnce(t, app)
	fresh, _ = findAs[Room](app, "party_rooms", room.Id)
	if s := statusOf(fresh); fresh.DiscordWebhook() != "" || !strings.HasPrefix(s.Dropped, "Discord answered 404") || s.DroppedAt == "" {
		t.Fatalf("not dropped: %q, %+v", fresh.DiscordWebhook(), s)
	}
}

func TestRoomOwnersChooseWhenRunsArePosted(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	owner, player := newUser(t, app, "Owner"), newUser(t, app, "Player")
	room := saved(t, app, "party_rooms", map[string]any{"owner": owner.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": owner.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "reporter"})
	webhookURL := hook.url + "/api/webhooks/12345/abcdefghijklmnopqrstuvwx"
	connected := ask(t, app, "POST", "/api/odyle/discord-webhook", tokenOf(t, owner), `{"roomId":"`+room.Id+`","webhook":"`+webhookURL+`","language":"en","leads":[5,30],"startPost":true}`, 200)["room"].(map[string]any)
	if fmt.Sprint(connected["discordLeads"]) != "[30 5]" || connected["discordStartPost"] != true || connected["discordName"] != "Odyle hook" || connected["discordReminders"] != true {
		t.Fatalf("connected %v", connected)
	}
	if raw, _ := json.Marshal(connected); strings.Contains(string(raw), "abcdefghijklmnopqrstuvwx") {
		t.Fatalf("the webhook URL came back: %s", raw)
	}
	// The times alone keep the webhook.
	changed := ask(t, app, "POST", "/api/odyle/discord-webhook", tokenOf(t, owner), `{"roomId":"`+room.Id+`","leads":[120]}`, 200)["room"].(map[string]any)
	if fmt.Sprint(changed["discordLeads"]) != "[120]" || changed["discordReminders"] != true || changed["discordName"] != "Odyle hook" || len(hook.of("POST")) != 1 {
		t.Fatalf("changed %v", changed)
	}
	for _, leads := range []string{`[7]`, `[]`, `[5,10,15,30]`, `[15,15]`, `"15"`} {
		ask(t, app, "POST", "/api/odyle/discord-webhook", tokenOf(t, owner), `{"roomId":"`+room.Id+`","leads":`+leads+`}`, 400)
	}
	ask(t, app, "POST", "/api/odyle/discord-webhook", tokenOf(t, player), `{"roomId":"`+room.Id+`","leads":[15]}`, 403)
	// Disconnecting forgets the webhook and its name.
	off := ask(t, app, "POST", "/api/odyle/discord-webhook", tokenOf(t, owner), `{"roomId":"`+room.Id+`","webhook":""}`, 200)["room"].(map[string]any)
	if off["discordReminders"] != false || off["discordName"] != "" {
		t.Fatalf("off %v", off)
	}
}
