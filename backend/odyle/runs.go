package odyle

import (
	"slices"
	"sort"
	"strconv"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// runsOf lists the upcoming runs of a room, soonest first; a run stays listed until three
// hours after it started. planner and attendees are account ids; clients name them
// from members.
func runsOf(app core.App, roomId string, members []*Member) ([]plannedRun, error) {
	if members == nil {
		var err error
		if members, err = roomMembers(app, roomId); err != nil {
			return nil, err
		}
	}
	users, byId, rules, at := memberUsers(members), map[string]*Member{}, readSettings(app), time.Now()
	for _, m := range members {
		byId[m.Id] = m
	}
	found, err := app.FindRecordsByFilter("room_runs", "room = {:room} && startsAt >= {:since}", "startsAt", 0, 0, dbx.Params{"room": roomId, "since": ago(3 * time.Hour)})
	if err != nil {
		return nil, err
	}
	out := make([]plannedRun, len(found))
	for i, r := range views[Run](found) {
		attendees, picks := []string{}, map[string]string{}
		for _, id := range r.Attendees() {
			if user := users[id]; user != "" {
				attendees = append(attendees, user)
			}
		}
		// A pick counts while the member still goes and still shares that character here.
		for member, character := range r.Picks() {
			if m := byId[member]; m != nil && slices.Contains(r.Attendees(), member) && m.Shares(app, character) {
				picks[users[member]] = character
			}
		}
		cant := []string{}
		for _, id := range r.Cant() {
			if user := users[id]; user != "" && !slices.Contains(r.Attendees(), id) {
				cant = append(cant, user)
			}
		}
		invited := []string{}
		for _, id := range r.Invited() {
			if user := users[id]; user != "" && !slices.Contains(r.Attendees(), id) && !slices.Contains(r.Cant(), id) {
				invited = append(invited, user)
			}
		}
		party, queue := runParty(rules, r)
		waiting := []string{}
		for _, id := range queue {
			if user := users[id]; user != "" {
				waiting = append(waiting, user)
			}
		}
		spent, err := spentAtRun(app, r, party, byId, runCost(rules, r.Dungeon()), at)
		if err != nil {
			return nil, err
		}
		out[i] = plannedRun{Id: r.Id, Dungeon: r.Dungeon(), StartsAt: r.StartsAt(), Note: r.Note(), Planner: users[r.PlannedBy()], Attendees: attendees, Picks: picks, Cant: cant, Invited: invited, Waiting: waiting, Link: r.GetString("link"), Spent: spent, Called: r.GetBool("called")}
	}
	return out, nil
}

// runRoom refuses a new run when the room already has 20 still ahead; runs that started
// do not count (they stay listed for three hours and are deleted after a day).
func runRoom(app core.App, roomId string) error {
	ahead, err := app.CountRecords("room_runs", dbx.HashExp{"room": roomId}, dbx.NewExp("startsAt >= {:now}", dbx.Params{"now": stamp(time.Now())}))
	if err != nil {
		return err
	}
	if ahead >= 20 {
		return badRequest("A room can plan up to 20 runs at a time.")
	}
	return nil
}

// plannedRun is a run as rooms list it; planner and attendees are account ids, and picks
// maps an attendee's account id to the character they bring (when they picked one).
type plannedRun struct {
	Id        string            `json:"id"`
	Dungeon   string            `json:"dungeon"`
	StartsAt  string            `json:"startsAt"`
	Note      string            `json:"note"`
	Planner   string            `json:"planner"`
	Attendees []string          `json:"attendees"`
	Picks     map[string]string `json:"picks"`
	// Cant: the accounts that answered they cannot come (#45); additive, older clients ignore it.
	Cant []string `json:"cant"`
	// Invited: the accounts a run planned from the wishlist, or called now, invited that have not
	// answered yet (#45).
	Invited []string `json:"invited"`
	// Waiting: those going beyond its dungeon's party size, first come first, who wait for a
	// place (#45); they stay in attendees.
	Waiting []string `json:"waiting"`
	// Called: a member called the party to this run now (Run now).
	Called bool `json:"called"`
	// Link: the run's event elsewhere (Raid-Helper, a Discord event; #35), "" without one.
	Link string `json:"link"`
	// Spent: once the run started, how many of its attendees the readers saw spend its cost (#42).
	Spent int `json:"spent"`
}

// runInvite is what an invited member is told (#45): on their account's topic, so open
// dashboards and Windows apps can show it, unless they turned run notices off. Now marks a
// run the planner called the party to (Run now); older apps word it as an invite.
type runInvite struct {
	RunId    string `json:"runId"`
	RoomId   string `json:"roomId"`
	Room     string `json:"room"`
	Dungeon  string `json:"dungeon"`
	StartsAt string `json:"startsAt"`
	By       string `json:"by"`
	Now      bool   `json:"now,omitempty"`
}

// inviteToRun tells the invited members of a run. A call (Run now) also goes by Web Push, and
// not to members in their quiet hours.
func inviteToRun(app core.App, r *Run, invited []string, planner *core.Record, called bool) error {
	if len(invited) == 0 {
		return nil
	}
	room, err := findAs[Room](app, "party_rooms", r.Room())
	if err != nil {
		return err
	}
	members, err := app.FindRecordsByIds("room_members", invited)
	if err != nil {
		return err
	}
	type told struct {
		user *core.Record
		n    notificationSettings
	}
	invite, at, pushes := runInvite{RunId: r.Id, RoomId: room.Id, Room: room.Name(), Dungeon: r.Dungeon(), StartsAt: r.StartsAt(), By: planner.GetString("displayName"), Now: called}, time.Now(), []told{}
	for _, m := range views[Member](members) {
		user, err := app.FindRecordById("users", m.User())
		if err != nil {
			continue
		}
		n := notificationsOf(user)
		if !n.Kinds.Runs || called && n.quietAt(at) {
			continue
		}
		// Delivered once the run is saved (the outbox waits for the commit).
		changes(app).user(app, user.Id, func(news *userNews) { news.invites = append(news.invites, invite) })
		if called {
			pushes = append(pushes, told{user, n})
		}
	}
	// The pushes wait on push services for seconds: they go after the commit, in the
	// background, so neither the write lock nor the caller's answer waits for them, and a
	// call that was not saved tells no one.
	if len(pushes) > 0 {
		afterCommit(app, func(root core.App) {
			work := &stateOf(root).pushes
			work.Add(1)
			go func() {
				defer work.Done()
				for _, p := range pushes {
					pushCall(root, p.user, p.n, invite)
				}
			}()
		})
	}
	return nil
}

// pushCall tells a called member by Web Push when the account wants that (push.go).
var pushCall = func(core.App, *core.Record, notificationSettings, runInvite) {}

// Run now: a member calls the party to a run starting about callLead from now (a whole minute),
// and a room calls at most once every callGap.
const callLead, callGap = 10 * time.Minute, 30 * time.Minute

// callable are the members a call invites: players other than the caller who play live in the
// room now, or whose character there is expected to hold a cube at the run's cost by its start
// (the Odyle clock). Members without a character there are left out.
func callable(app core.App, roomId, caller string, start time.Time, cost int64) ([]string, error) {
	members, err := roomMembers(app, roomId)
	if err != nil {
		return nil, err
	}
	entries, _, err := roomEntries(app, roomId)
	if err != nil {
		return nil, err
	}
	rules, at, out := readSettings(app).Clock, time.Now(), []string{}
	for _, m := range members {
		if m.Id == caller || m.Role() == "viewer" {
			continue
		}
		if c := broughtBy(m.User(), entries, at, ""); c != nil && (readyState(*c, at) == "live" || valueAt(*c, start, at, rules) >= cost) {
			out = append(out, m.Id)
		}
	}
	return out, nil
}

// plan handles planned runs: { roomId, dungeon, startsAt, note? } plans one with the
// planner going, { roomId, id, going, character? } joins (with the character it brings) or leaves it,
// { roomId, id, done: true } wraps a started run up (its attendees' wishes for the dungeon go),
// { roomId, id, again: true, startsAt? } plans it again a week later, { roomId, id, dungeon?,
// startsAt?, note? } changes it and { roomId, id, remove: true } cancels it (changes
// and cancelling: its planner or the room owner). Owners and players plan and join;
// viewers read. A room whose owner turned planned runs off has none.
func plan(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		room, err := findAs[Room](app, "party_rooms", m.Room())
		if err != nil {
			return nil, err
		}
		if !room.On("runs") {
			return nil, forbidden("The room owner turned planned runs off.")
		}
		// Officers change, cancel and wrap up every run, like the owner (#43).
		p := &runPlanner{app: app, user: user, m: m, room: room, roomId: m.Room(), viewer: m.Role() == "viewer", isOwner: m.Role() == "owner" || m.Role() == "officer"}
		if b.set("id") {
			err = p.changeRun(b)
		} else {
			err = p.newRun(b)
		}
		if err != nil {
			return nil, err
		}
		runs, err := runsOf(app, p.roomId, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"runs": runs}, nil
	})
}

// runPlanner is a member of a room acting on its planned runs (plan); isOwner is true for
// its owner and officers.
type runPlanner struct {
	app             core.App
	user            *core.Record
	m               *Member
	room            *Room
	roomId          string
	viewer, isOwner bool
}

// changeRun acts on one planned run of the room, by the verb the body names.
func (p *runPlanner) changeRun(b body) error {
	r, err := findAs[Run](p.app, "room_runs", b.str("id"))
	if err != nil || r.Room() != p.roomId {
		return notFound("This run is no longer planned.")
	}
	going, isGoing := b.boolean("going")
	// After the start, its attendees wrap the run up too: done, or it did not happen.
	started, attending := !timeOf(r.StartsAt()).After(time.Now()), slices.Contains(r.Attendees(), p.m.Id)
	switch {
	case b.isTrue("done"):
		return p.wrapUp(r, started, attending)
	case b.isTrue("again"):
		return p.planAgain(r, b)
	case b.isTrue("remove"):
		return p.cancel(r, started, attending)
	case b.has("cant"):
		return p.answerCant(r, b)
	case isGoing:
		return p.answerGoing(r, b, going)
	case b.has("dungeon") || b.has("startsAt") || b.has("note") || b.has("link"):
		return p.edit(r, b)
	default:
		return badRequest("Send going or cant (true or false), the changes to the run, done, again or remove: true.")
	}
}

// wrapUp marks a started run done: the dungeon leaves the wishlist of everyone in its party;
// those still waiting for a place keep theirs.
func (p *runPlanner) wrapUp(r *Run, started, attending bool) error {
	if !started {
		return badRequest("A run can be marked done once it has started.")
	}
	if r.PlannedBy() != p.m.Id && !p.isOwner && !attending {
		return forbidden("Only its planner, an attendee, an officer or the room owner can mark this run done.")
	}
	ran, err := dungeon(r.Dungeon())
	if err != nil {
		return err
	}
	wishes, err := list(p.app, "room_wishes", "room = {:room} && key = {:key}", dbx.Params{"room": p.roomId, "key": ran.key})
	if err != nil {
		return err
	}
	party, _ := runParty(readSettings(p.app), r)
	for _, w := range wishes {
		if slices.Contains(party, w.GetString("member")) {
			if err := p.app.Delete(w); err != nil {
				return err
			}
		}
	}
	if err := endPosts(p.app, r, "done"); err != nil {
		return err
	}
	return p.app.Delete(r)
}

// planAgain plans the same dungeon, note and local time a week later (the browser sends that
// time, which keeps it across a daylight saving change), with the caller going.
func (p *runPlanner) planAgain(r *Run, b body) error {
	if p.viewer {
		return forbidden("Viewers cannot plan runs.")
	}
	next := timeOf(r.StartsAt()).Add(7 * 24 * time.Hour).UTC().Format(isoLayout)
	var err error
	if b.has("startsAt") {
		if next, err = runStart(b["startsAt"], time.Now()); err != nil {
			return err
		}
	} else if next, err = runStart(next, time.Now()); err != nil {
		return err
	}
	if err := runRoom(p.app, p.roomId); err != nil {
		return err
	}
	again, err := newAs[Run](p.app, "room_runs")
	if err != nil {
		return err
	}
	again.Set("room", p.roomId)
	again.Set("plannedBy", p.m.Id)
	again.SetDungeon(r.Dungeon())
	again.SetStart(next)
	again.SetNote(r.Note())
	again.SetAttendees([]string{p.m.Id})
	if err := p.app.Save(again); err != nil {
		return err
	}
	achieved(p.app, p.user.Id, adding(map[string]int64{"planned": 1}), false)
	return nil
}

// cancel deletes a run with its Discord posts marked cancelled.
func (p *runPlanner) cancel(r *Run, started, attending bool) error {
	if r.PlannedBy() != p.m.Id && !p.isOwner && !(started && attending) {
		return forbidden("Only its planner, an officer or the room owner can cancel this run.")
	}
	if err := endPosts(p.app, r, "cancelled"); err != nil {
		return err
	}
	return p.app.Delete(r)
}

// answerCant (#45): the member answers they cannot come, which takes them off the run; false
// takes the answer back. Going again clears it.
func (p *runPlanner) answerCant(r *Run, b body) error {
	if p.viewer {
		return forbidden("Viewers cannot join runs.")
	}
	cant, ok := b.boolean("cant")
	if !ok {
		return badRequest("Can't must be true or false.")
	}
	answered := without(r.Cant(), p.m.Id)
	if cant {
		answered = append(answered, p.m.Id)
		r.SetAttendees(without(r.Attendees(), p.m.Id))
		picks := r.Picks()
		delete(picks, p.m.Id)
		r.Set("picks", picks)
	}
	r.Set("cant", answered)
	return p.app.Save(r)
}

// answerGoing joins the run or leaves it. Going with a character: one of the member's own,
// shared in this room.
func (p *runPlanner) answerGoing(r *Run, b body, going bool) error {
	if p.viewer {
		return forbidden("Viewers cannot join runs.")
	}
	if going {
		r.Set("cant", without(r.Cant(), p.m.Id))
	}
	pick := ""
	if going && b.set("character") {
		c, err := ownCharacter(p.app, p.user.Id, b.str("character"))
		if err != nil {
			return err
		}
		if !p.m.Shares(p.app, c.Id) {
			return badRequest("Pick a character you share in this room.")
		}
		pick = c.Id
	}
	// A member already going keeps their place; one leaving drops their pick.
	attendees := append([]string{}, r.Attendees()...)
	if !going {
		attendees = without(attendees, p.m.Id)
	} else if !slices.Contains(attendees, p.m.Id) {
		attendees = append(attendees, p.m.Id)
	}
	r.SetAttendees(attendees)
	picks := r.Picks()
	delete(picks, p.m.Id)
	if pick != "" {
		picks[p.m.Id] = pick
	}
	r.Set("picks", picks)
	return p.app.Save(r)
}

// edit changes a run's dungeon, start, note or link.
func (p *runPlanner) edit(r *Run, b body) error {
	if p.viewer {
		return forbidden("Viewers cannot plan runs.")
	}
	if r.PlannedBy() != p.m.Id && !p.isOwner {
		return forbidden("Only its planner, an officer or the room owner can change this run.")
	}
	// A run keeps its dungeon when the name only differs in case or spacing,
	// even if the catalog changed since.
	if b.has("dungeon") {
		typed, err := dungeon(b["dungeon"])
		if err != nil {
			return err
		}
		current, err := dungeon(r.Dungeon())
		if err != nil {
			return err
		}
		if typed.key != current.key {
			name, err := catalogName(p.app, b["dungeon"])
			if err != nil {
				return err
			}
			if name == nil {
				return badRequest("Choose a dungeon from the list.")
			}
			r.SetDungeon(name.dungeon)
		}
	}
	// A new start time is announced again on Discord.
	if b.has("startsAt") {
		startsAt, err := runStart(b["startsAt"], time.Now())
		if err != nil {
			return err
		}
		if parsed, _ := parseDate(startsAt); !parsed.Equal(timeOf(r.StartsAt())) {
			r.SetStart(startsAt)
		}
	}
	if b.has("note") {
		n, err := note(b, "note")
		if err != nil {
			return err
		}
		r.SetNote(n)
	}
	if b.has("link") {
		link, err := eventLink(b["link"])
		if err != nil {
			return err
		}
		r.Set("link", link)
	}
	return p.app.Save(r)
}

// newRun plans a run with the planner going. Run now (call) starts it in ten minutes, once
// per half hour and room.
func (p *runPlanner) newRun(b body) error {
	if p.viewer {
		return forbidden("Viewers cannot plan runs.")
	}
	name, err := catalogName(p.app, b["dungeon"])
	if err != nil {
		return err
	}
	if name == nil {
		return badRequest("Choose a dungeon from the list.")
	}
	n, err := note(b, "note")
	if err != nil {
		return err
	}
	called := b.isTrue("call")
	var startsAt string
	if called {
		calls, err := p.app.CountRecords("room_runs", dbx.HashExp{"room": p.roomId, "called": true}, dbx.NewExp("created >= {:since}", dbx.Params{"since": ago(callGap)}))
		if err != nil {
			return err
		}
		if calls > 0 {
			return badRequest("The party was called less than 30 minutes ago. Answer that run instead.")
		}
		startsAt = time.Now().Add(callLead).Truncate(time.Minute).UTC().Format(isoLayout)
	} else if startsAt, err = runStart(b["startsAt"], time.Now()); err != nil {
		return err
	}
	if err := runRoom(p.app, p.roomId); err != nil {
		return err
	}
	r, err := newAs[Run](p.app, "room_runs")
	if err != nil {
		return err
	}
	r.Set("room", p.roomId)
	r.Set("plannedBy", p.m.Id)
	r.SetDungeon(name.dungeon)
	r.SetStart(startsAt)
	r.SetNote(n)
	if b.has("link") {
		link, err := eventLink(b["link"])
		if err != nil {
			return err
		}
		r.Set("link", link)
	}
	r.SetAttendees([]string{p.m.Id})
	r.Set("called", called)
	// Planned from the wishlist (#45): the members who want the dungeon are invited. A
	// call invites those who can come now (callable).
	invited := []string{}
	if called {
		start, _ := parseDate(startsAt)
		if invited, err = callable(p.app, p.roomId, p.m.Id, start, runCost(readSettings(p.app), name.dungeon)); err != nil {
			return err
		}
	} else if b.isTrue("fromWish") && p.room.On("wishlist") {
		wishes, err := list(p.app, "room_wishes", "room = {:room} && key = {:key}", dbx.Params{"room": p.roomId, "key": name.key})
		if err != nil {
			return err
		}
		for _, w := range wishes {
			if member := w.GetString("member"); member != p.m.Id && !slices.Contains(invited, member) {
				invited = append(invited, member)
			}
		}
	}
	r.Set("invited", invited)
	if err := p.app.Save(r); err != nil {
		return err
	}
	if err := inviteToRun(p.app, r, invited, p.user, called); err != nil {
		return err
	}
	achieved(p.app, p.user.Id, adding(map[string]int64{"planned": 1}), false)
	return nil
}

// upcoming lists the runs the account is going to in the next 24 hours across all its
// rooms, for reminders in the browser and the Windows app.
func upcoming(e *core.RequestEvent) error {
	return run(e, func() error {
		memberships, err := membershipsWhere(e.App, "user = {:user}", dbx.Params{"user": e.Auth.Id})
		if err != nil {
			return err
		}
		mine, roomIds := map[string]string{}, []string{}
		for _, m := range memberships {
			if _, ok := mine[m.Room()]; !ok {
				roomIds = append(roomIds, m.Room())
			}
			mine[m.Room()] = m.Id
		}
		out := []upcomingRun{}
		if len(roomIds) == 0 {
			return e.JSON(200, map[string]any{"runs": out, "notifications": notificationsOf(e.Auth), "serverNow": now()})
		}
		rooms, err := roomsByID(e.App, roomIds)
		if err != nil {
			return err
		}
		// The next 24 hours for reminders; the library asks for up to 60 days (?days=, #51).
		at, days := time.Now(), int64(1)
		if asked, err := strconv.ParseInt(e.Request.URL.Query().Get("days"), 10, 64); err == nil {
			days = max(1, min(60, asked))
		}
		found, err := e.App.FindAllRecords("room_runs", dbx.In("room", anys(roomIds)...), dbx.NewExp("startsAt > {:now} AND startsAt <= {:until}", dbx.Params{"now": stamp(at), "until": stamp(at.Add(time.Duration(days) * 24 * time.Hour))}))
		if err != nil {
			return err
		}
		for _, r := range views[Run](found) {
			if !slices.Contains(r.Attendees(), mine[r.Room()]) {
				continue
			}
			name := ""
			if room := rooms[r.Room()]; room != nil {
				name = room.Name()
			}
			out = append(out, upcomingRun{Id: r.Id, RoomId: r.Room(), Room: name, Dungeon: r.Dungeon(), StartsAt: r.StartsAt(), Note: r.Note()})
		}
		sort.SliceStable(out, func(a, b int) bool { return out[a].StartsAt < out[b].StartsAt })
		return e.JSON(200, map[string]any{"runs": out, "notifications": notificationsOf(e.Auth), "serverNow": now()})
	})
}

// maintenanceOf is the weekly maintenance window for clients, or nil when none is set (#47).
func maintenanceOf(rules settings) any {
	if rules.Maintenance.Day == "" {
		return nil
	}
	return rules.Maintenance
}

// nextRuns is the next run of each room, by room: its dungeon and start, or nil without one.
func nextRuns(app core.App, roomIds []string) (map[string]any, error) {
	out := map[string]any{}
	if len(roomIds) == 0 {
		return out, nil
	}
	found, err := app.FindAllRecords("room_runs", dbx.In("room", anys(roomIds)...), dbx.NewExp("startsAt > {:now}", dbx.Params{"now": stamp(time.Now())}))
	if err != nil {
		return nil, err
	}
	runs := views[Run](found)
	sort.SliceStable(runs, func(a, b int) bool { return runs[a].StartsAt() < runs[b].StartsAt() })
	for _, r := range runs {
		if _, seen := out[r.Room()]; !seen {
			out[r.Room()] = map[string]any{"id": r.Id, "dungeon": r.Dungeon(), "startsAt": r.StartsAt()}
		}
	}
	return out, nil
}

// upcomingRun is a run the account is going to, with its room's name.
type upcomingRun struct {
	Id       string `json:"id"`
	RoomId   string `json:"roomId"`
	Room     string `json:"room"`
	Dungeon  string `json:"dungeon"`
	StartsAt string `json:"startsAt"`
	Note     string `json:"note"`
}
