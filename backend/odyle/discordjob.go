package odyle

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

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
		stateOf(app).ops.discord.note(nil)
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
		// Discord failing (5xx) is the operator's to hear of (alerts.go); a room's own webhook
		// refused is its owner's.
		if status >= 500 {
			stateOf(app).ops.discord.note(fmt.Errorf("Discord answered %d", status))
		}
		noteDelivery(app, room.Id, func(s *deliveryStatus) { s.Error, s.ErrorAt = "Discord answered "+strconv.Itoa(status)+".", now() })
		fail(what+" failed: Discord answered "+strconv.Itoa(status), "Odyle Discord post failed", "room", room.Id, "status", status)
	}
	return false, nil
}

// startPostWindow is how long after its start a run can still get its start post.
const startPostWindow = 5 * time.Minute

// dueLead is the lead a run is due to be posted at now, if any: the smallest of its room's
// lead times that has come, unless a post for this start came close enough to it, or 0 for the
// start post in the first five minutes, when the room asks for it. Close enough is within half
// the lead again (so a run planned 20 minutes ahead is posted once, not for 60 and again for
// 15), but never back to where the next larger lead came due: a post must have come at least
// halfway from that lead's time to this one, so the larger lead's own post, made when it came
// due or a little later, does not count (leads 15 and 10 get both posts).
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
	// covered says whether a post came within window before the start.
	covered := func(window time.Duration) bool {
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
		lead := time.Duration(leads[i]) * time.Minute
		if start.Sub(at) > lead {
			continue
		}
		window := lead * 3 / 2
		if i > 0 {
			window = min(window, (lead+time.Duration(leads[i-1])*time.Minute)/2)
		}
		return leads[i], !covered(window)
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
		stateOf(app).ops.discord.note(err)
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
		stateOf(app).ops.discord.note(err)
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
