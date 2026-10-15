package odyle

import (
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// Per-account caps. They only stop runaway or abusive clients: players keep a handful
// of characters, and every character costs the portrait job one PLAYNC lookup a day.
var limits = struct {
	Characters     int64 `json:"characters"`
	OwnedRooms     int64 `json:"ownedRooms"`
	Memberships    int64 `json:"memberships"`
	DesktopDevices int   `json:"desktopDevices"`
}{30, 20, 50, 10}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func membership(app core.App, userId, roomId string) (*core.Record, error) {
	found, err := list(app, "room_members", "room = {:room} && user = {:user}", dbx.Params{"room": roomId, "user": userId})
	if err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, forbidden("You are not a member of this room.")
	}
	return found[0], nil
}

func owner(app core.App, userId, roomId string) (*core.Record, error) {
	room, err := app.FindRecordById("party_rooms", roomId)
	if err != nil {
		return nil, notFound("This room no longer exists.")
	}
	if room.GetString("owner") != userId {
		return nil, forbidden("Only the room owner can do this.")
	}
	return room, nil
}

func ownCharacter(app core.App, userId, id string) (*core.Record, error) {
	character, err := app.FindRecordById("characters", id)
	if err != nil {
		return nil, notFound("This character no longer exists.")
	}
	if character.GetString("user") != userId {
		return nil, forbidden("This character belongs to another account.")
	}
	return character, nil
}

// otherMember is another membership of the owner's room, for removing, re-roling or handing over.
func otherMember(app core.App, room *core.Record, memberId, userId, refusal string) (*core.Record, error) {
	target, err := app.FindRecordById("room_members", memberId)
	if err != nil {
		return nil, notFound("This member is no longer in the room.")
	}
	if target.GetString("room") != room.Id || target.GetString("user") == userId {
		return nil, forbidden(refusal)
	}
	return target, nil
}

func newRecord(app core.App, collection string) (*core.Record, error) {
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return nil, err
	}
	return core.NewRecord(c), nil
}

func newCharacter(app core.App, userId string) (*core.Record, error) {
	count, err := app.CountRecords("characters", dbx.HashExp{"user": userId})
	if err != nil {
		return nil, err
	}
	if count >= limits.Characters {
		return nil, badRequest("You can keep up to 30 characters. Delete one you no longer play under My rooms & characters.")
	}
	record, err := newRecord(app, "characters")
	if err != nil {
		return nil, err
	}
	record.Set("user", userId)
	return record, nil
}

func ownSession(app core.App, userId, id string) (*core.Record, error) {
	session, err := app.FindRecordById("publisher_sessions", id)
	if err != nil || session.GetString("user") != userId || !session.GetDateTime("expiresAt").Time().After(time.Now()) {
		return nil, forbidden("Publisher session expired. Reconnect.")
	}
	return session, nil
}

// notify tells the rooms' subscribers to fetch their snapshot again.
func notify(app core.App, roomIds []string) {
	for _, id := range unique(roomIds) {
		topic := "odyle.room." + id
		for _, client := range app.SubscriptionsBroker().Clients() {
			if client.HasSubscription(topic) {
				client.Send(subscriptions.Message{Name: topic, Data: []byte(`{"refresh":true}`)})
			}
		}
	}
}

// Odyle per cube is one server-wide value (odyle_settings, edited by superusers).
// Rooms keep their legacy cost field, but every response reports the setting.
func odylePerCube(app core.App) int64 { return readSettings(app).OdylePerCube }

// The Discord webhook is a hidden field, so the public export never carries it; members
// only learn whether the room posts reminders.
func roomJSON(room *core.Record, cost int64) map[string]any {
	out := room.PublicExport()
	out["cost"] = cost
	out["discordReminders"] = room.GetString("discordWebhook") != ""
	return out
}

func roomsFor(app core.App, userId string) ([]string, error) {
	memberships, err := list(app, "room_members", "user = {:user}", dbx.Params{"user": userId})
	if err != nil {
		return nil, err
	}
	return field(memberships, "room"), nil
}

// touch marks the last time the account used Odyle, for the optional clean-up of
// inactive accounts (retention). Written at most hourly, so readings stay cheap.
func touch(e *core.RequestEvent) {
	auth := e.Auth
	if auth == nil || auth.Collection().Name != "users" {
		return
	}
	if auth.GetString("lastActiveAt") > ago(time.Hour) {
		return
	}
	user, err := e.App.FindRecordById("users", auth.Id)
	if err == nil {
		user.Set("lastActiveAt", now())
		err = e.App.Save(user)
	}
	if err != nil {
		warn(e.App, "Odyle activity mark failed", "user", auth.Id, "error", err.Error())
	}
}

// run answers a route: errors meant for the client pass as they are, a record deleted
// meanwhile (another tab, another member) is 404, anything else 400 with its message.
func run(e *core.RequestEvent, action func() error) error {
	touch(e)
	err := action()
	if err == nil || apiStatus(err) != 0 {
		return err
	}
	if isNoRows(err) {
		return notFound("This no longer exists. Reload the page.")
	}
	text := err.Error()
	if text == "" {
		text = "Request could not be completed."
	}
	return badRequest(text)
}

type change func(app core.App, user *core.Record, b body, affected *[]string) (any, error)

// mutate runs a change in one transaction, then tells the affected rooms.
func mutate(e *core.RequestEvent, fn change) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		var result any
		affected := []string{}
		if err := e.App.RunInTransaction(func(app core.App) error {
			var err error
			result, err = fn(app, e.Auth, b, &affected)
			return err
		}); err != nil {
			return err
		}
		notify(e.App, affected)
		if result == nil {
			result = map[string]any{"success": true}
		}
		return e.JSON(200, result)
	})
}

func invite(app core.App, room *core.Record, role string) (map[string]any, error) {
	code := security.RandomStringWithAlphabet(12, codeAlphabet)
	record, err := newRecord(app, "room_invites")
	if err != nil {
		return nil, err
	}
	record.Set("room", room.Id)
	record.Set("role", role)
	record.Set("digest", security.SHA256(code))
	record.Set("expiresAt", expiry(1800))
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return map[string]any{"code": code, "role": role, "expiresAt": record.GetString("expiresAt")}, nil
}

func addMember(app core.App, roomId, userId, role string) (*core.Record, error) {
	record, err := newRecord(app, "room_members")
	if err != nil {
		return nil, err
	}
	record.Set("room", roomId)
	record.Set("user", userId)
	record.Set("role", role)
	record.Set("sharedCharacters", []string{})
	return record, app.Save(record)
}

func joinable(app core.App, userId string) error {
	count, err := app.CountRecords("room_members", dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	if count >= limits.Memberships {
		return badRequest("You can be in up to 50 rooms. Leave one first.")
	}
	return nil
}

func roomInvites(app core.App, room *core.Record) ([]any, error) {
	reporter, err := invite(app, room, "reporter")
	if err != nil {
		return nil, err
	}
	viewer, err := invite(app, room, "viewer")
	if err != nil {
		return nil, err
	}
	return []any{reporter, viewer}, nil
}

func create(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		owned, err := app.CountRecords("party_rooms", dbx.HashExp{"owner": user.Id})
		if err != nil {
			return nil, err
		}
		if owned >= limits.OwnedRooms {
			return nil, badRequest("You can own up to 20 rooms. Close one you no longer use.")
		}
		if err := joinable(app, user.Id); err != nil {
			return nil, err
		}
		room, err := newRecord(app, "party_rooms")
		if err != nil {
			return nil, err
		}
		cost := odylePerCube(app)
		name, err := text(b["name"], "Room name", 60)
		if err != nil {
			return nil, err
		}
		room.Set("name", name)
		room.Set("owner", user.Id)
		room.Set("cost", cost)
		if err := app.Save(room); err != nil {
			return nil, err
		}
		member, err := addMember(app, room.Id, user.Id, "owner")
		if err != nil {
			return nil, err
		}
		invites, err := roomInvites(app, room)
		if err != nil {
			return nil, err
		}
		return map[string]any{"room": roomJSON(room, cost), "membership": member, "invites": invites}, nil
	})
}

var codeSeparators = regexp.MustCompile(`[\s\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}-]`)

// normalizeCode drops spaces and dashes of a typed code and upper-cases it.
func normalizeCode(code string) string {
	return strings.ToUpper(codeSeparators.ReplaceAllString(code, ""))
}

func join(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		typed, err := text(b["code"], "Invite code", 20)
		if err != nil {
			return nil, err
		}
		invitation, err := app.FindFirstRecordByData("room_invites", "digest", security.SHA256(normalizeCode(typed)))
		if err != nil || !invitation.GetDateTime("expiresAt").Time().After(time.Now()) {
			return nil, badRequest("Invite is invalid or expired.")
		}
		room, err := app.FindRecordById("party_rooms", invitation.GetString("room"))
		if err != nil {
			return nil, err
		}
		cost := odylePerCube(app)
		existing, err := list(app, "room_members", "room = {:room} && user = {:user}", dbx.Params{"room": room.Id, "user": user.Id})
		if err != nil {
			return nil, err
		}
		if len(existing) > 0 {
			return map[string]any{"room": roomJSON(room, cost), "membership": existing[0]}, nil
		}
		members, err := app.CountRecords("room_members", dbx.HashExp{"room": room.Id})
		if err != nil {
			return nil, err
		}
		if members >= 50 {
			return nil, badRequest("Room is full.")
		}
		if err := joinable(app, user.Id); err != nil {
			return nil, err
		}
		member, err := addMember(app, room.Id, user.Id, invitation.GetString("role"))
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return map[string]any{"room": roomJSON(room, cost), "membership": member}, nil
	})
}

// rooms answers with one query for the memberships, one for their rooms and one for
// the settings; serverNow lets the dashboard correct its clock without a heartbeat
// round trip. The Windows app shows the announcement from here, as it refreshes rooms
// every 15 seconds anyway.
func rooms(e *core.RequestEvent) error {
	return run(e, func() error {
		rules := readSettings(e.App)
		memberships, err := list(e.App, "room_members", "user = {:user}", dbx.Params{"user": e.Auth.Id})
		if err != nil {
			return err
		}
		byId := map[string]*core.Record{}
		if len(memberships) > 0 {
			found, err := e.App.FindRecordsByIds("party_rooms", field(memberships, "room"))
			if err != nil {
				return err
			}
			for _, r := range found {
				byId[r.Id] = r
			}
		}
		out := []any{}
		for _, m := range memberships {
			room := byId[m.GetString("room")]
			if room == nil {
				continue
			}
			linked, j := stringSlice(m, "sharedCharacters"), roomJSON(room, rules.OdylePerCube)
			j["role"], j["sharedCharacters"], j["sharing"] = m.GetString("role"), linked, len(linked) > 0
			out = append(out, j)
		}
		return e.JSON(200, map[string]any{"odylePerCube": rules.OdylePerCube, "serverNow": now(), "announcement": announcement(rules), "rooms": out})
	})
}

// snapshot is a whole room in three queries: members, their accounts and all their
// characters, instead of two lookups per member. Others see only the characters a
// member linked to this room; members always see all of their own, each flagged with
// whether it is shared here.
func snapshot(e *core.RequestEvent) error {
	return run(e, func() error {
		id := e.Request.PathValue("id")
		if _, err := membership(e.App, e.Auth.Id, id); err != nil {
			return err
		}
		rules := readSettings(e.App)
		room, err := e.App.FindRecordById("party_rooms", id)
		if err != nil {
			return err
		}
		members, err := list(e.App, "room_members", "room = {:room}", dbx.Params{"room": id})
		if err != nil {
			return err
		}
		userIds, names, characters := field(members, "user"), map[string]string{}, map[string][]*core.Record{}
		if len(userIds) > 0 {
			users, err := e.App.FindRecordsByIds("users", userIds)
			if err != nil {
				return err
			}
			for _, u := range users {
				names[u.Id] = u.GetString("displayName")
			}
			owned, err := e.App.FindAllRecords("characters", dbx.In("user", anys(userIds)...))
			if err != nil {
				return err
			}
			for _, c := range owned {
				characters[c.GetString("user")] = append(characters[c.GetString("user")], c)
			}
		}
		for _, owned := range characters {
			sort.SliceStable(owned, func(a, b int) bool { return owned[a].GetString("created") < owned[b].GetString("created") })
		}
		out := make([]any, len(members))
		for i, m := range members {
			linked, mine := stringSlice(m, "sharedCharacters"), m.GetString("user") == e.Auth.Id
			visible := []any{}
			for _, c := range characters[m.GetString("user")] {
				if mine || contains(linked, c.Id) {
					j := c.PublicExport()
					j["shared"] = contains(linked, c.Id)
					visible = append(visible, j)
				}
			}
			j := m.PublicExport()
			j["sharing"], j["displayName"], j["characters"] = len(linked) > 0, names[m.GetString("user")], visible
			out[i] = j
		}
		wishes, err := wishlistOf(e.App, id, members)
		if err != nil {
			return err
		}
		runs, err := runsOf(e.App, id, members)
		if err != nil {
			return err
		}
		return e.JSON(200, map[string]any{"room": roomJSON(room, rules.OdylePerCube), "serverNow": now(), "members": out, "wishlist": wishes, "runs": runs, "dungeons": rules.Dungeons})
	})
}

func roomMembers(app core.App, roomId string) ([]*core.Record, error) {
	return list(app, "room_members", "room = {:room}", dbx.Params{"room": roomId})
}

// memberUsers maps membership ids to account ids.
func memberUsers(members []*core.Record) map[string]string {
	users := make(map[string]string, len(members))
	for _, m := range members {
		users[m.Id] = m.GetString("user")
	}
	return users
}

type wish struct {
	Key     string `json:"key"`
	Dungeon string `json:"dungeon"`
	Since   string `json:"since"`
	Users   []any  `json:"users"`
}

// wishlistOf is the room's dungeon wishlist grouped by dungeon, most wanted first, then
// oldest. Users are the accounts that still need it; clients name them from members.
func wishlistOf(app core.App, roomId string, members []*core.Record) ([]*wish, error) {
	if members == nil {
		var err error
		if members, err = roomMembers(app, roomId); err != nil {
			return nil, err
		}
	}
	users := memberUsers(members)
	records, err := app.FindRecordsByFilter("room_wishes", "room = {:room}", "created", 0, 0, dbx.Params{"room": roomId})
	if err != nil {
		return nil, err
	}
	entries, order := map[string]*wish{}, []*wish{}
	for _, w := range records {
		key := w.GetString("key")
		entry := entries[key]
		if entry == nil {
			entry = &wish{Key: key, Dungeon: w.GetString("dungeon"), Since: w.GetString("created"), Users: []any{}}
			entries[key] = entry
			order = append(order, entry)
		}
		var user any
		if id, ok := users[w.GetString("member")]; ok {
			user = id
		}
		entry.Users = append(entry.Users, user)
	}
	sort.SliceStable(order, func(a, b int) bool {
		if len(order[a].Users) != len(order[b].Users) {
			return len(order[a].Users) > len(order[b].Users)
		}
		return order[a].Since < order[b].Since
	})
	return order, nil
}

// Reporters and owners add dungeons they need, anyone removes their own entry, and
// the owner can clear a dungeon for everyone, for example after the party ran it.
func wishlist(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		roomId := m.GetString("room")
		wanted, err := dungeon(b["dungeon"])
		if err != nil {
			return nil, err
		}
		want, ok := b.boolean("wanted")
		if !ok {
			return nil, badRequest("Wanted must be true or false.")
		}
		entry, err := list(app, "room_wishes", "room = {:room} && key = {:key}", dbx.Params{"room": roomId, "key": wanted.key})
		if err != nil {
			return nil, err
		}
		mine := []*core.Record{}
		for _, w := range entry {
			if w.GetString("member") == m.Id {
				mine = append(mine, w)
			}
		}
		switch {
		case b.isTrue("everyone"):
			if want {
				return nil, badRequest("A dungeon can only be cleared for everyone, not added for them.")
			}
			if _, err := owner(app, user.Id, roomId); err != nil {
				return nil, err
			}
			for _, w := range entry {
				if err := app.Delete(w); err != nil {
					return nil, err
				}
			}
		case !want:
			for _, w := range mine {
				if err := app.Delete(w); err != nil {
					return nil, err
				}
			}
		case len(mine) == 0:
			if m.GetString("role") == "viewer" {
				return nil, forbidden("Viewers cannot add dungeons to this room's wishlist.")
			}
			count, err := app.CountRecords("room_wishes", dbx.HashExp{"member": m.Id})
			if err != nil {
				return nil, err
			}
			if count >= 20 {
				return nil, badRequest("You can have up to 20 dungeons on a room's wishlist.")
			}
			var listed *dungeonName
			if len(entry) == 0 {
				current, err := wishlistOf(app, roomId, nil)
				if err != nil {
					return nil, err
				}
				if len(current) >= 50 {
					return nil, badRequest("This room's wishlist is full (50 dungeons).")
				}
				// A new entry must be in the dungeon catalog, when there is one, and takes its spelling.
				if listed, err = catalogName(app, wanted.dungeon); err != nil {
					return nil, err
				}
				if listed == nil {
					return nil, badRequest("Choose a dungeon from the list.")
				}
			}
			record, err := newRecord(app, "room_wishes")
			if err != nil {
				return nil, err
			}
			// Joining an entry keeps its first spelling, whatever case this member typed.
			spelling := ""
			if len(entry) > 0 {
				spelling = entry[0].GetString("dungeon")
			} else {
				spelling = listed.dungeon
			}
			record.Set("room", roomId)
			record.Set("member", m.Id)
			record.Set("dungeon", spelling)
			record.Set("key", wanted.key)
			if err := app.Save(record); err != nil {
				return nil, err
			}
		}
		*affected = append(*affected, roomId)
		wishes, err := wishlistOf(app, roomId, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"wishlist": wishes}, nil
	})
}

// Reset times of the Global service, edited by superusers in odyle_settings next to
// odylePerCube. Launch defaults: 07:00 UTC daily, Wednesday weekly.
func resets(app core.App) map[string]any {
	s := readSettings(app)
	return map[string]any{"dailyResetHour": s.DailyResetHour, "weeklyResetDay": s.WeeklyResetDay}
}

// Personal daily and weekly checklists in the account's order. doneAt is the last time
// the account checked a task; clients show it done while that is after the current
// reset (src/tasks.js), so nothing has to uncheck tasks and nothing is deleted at reset.
func tasksOf(app core.App, userId string) ([]any, error) {
	found, err := app.FindRecordsByFilter("user_tasks", "user = {:user}", "position,created", 0, 0, dbx.Params{"user": userId})
	if err != nil {
		return nil, err
	}
	out := make([]any, len(found))
	for i, t := range found {
		out[i] = t.PublicExport()
	}
	return out, nil
}

func taskList(app core.App, userId, cadence string) ([]*core.Record, error) {
	return app.FindRecordsByFilter("user_tasks", "user = {:user} && cadence = {:cadence}", "position,created", 0, 0, dbx.Params{"user": userId, "cadence": cadence})
}

func checklist(app core.App, userId string) (map[string]any, error) {
	list, err := tasksOf(app, userId)
	if err != nil {
		return nil, err
	}
	return map[string]any{"tasks": list, "resets": resets(app), "serverNow": now()}, nil
}

func tasks(e *core.RequestEvent) error {
	return run(e, func() error {
		out, err := checklist(e.App, e.Auth.Id)
		if err != nil {
			return err
		}
		return e.JSON(200, out)
	})
}

// One route for the checklist: { title, cadence } adds a task, { id, done } stores or
// clears the time it was checked, { id, title } renames it, { id, move: 'up'|'down' }
// moves it within its list and { id, remove: true } deletes it. Tasks are private to
// the account and every answer carries the whole list.
func checklistTask(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if b.set("id") {
			t, err := app.FindRecordById("user_tasks", b.str("id"))
			if err != nil {
				return nil, notFound("This task no longer exists.")
			}
			if t.GetString("user") != user.Id {
				return nil, forbidden("This task belongs to another account.")
			}
			done, isDone := b.boolean("done")
			move, _ := b.text("move")
			switch {
			case b.isTrue("remove"):
				if err := app.Delete(t); err != nil {
					return nil, err
				}
			case isDone:
				if done {
					t.Set("doneAt", now())
				} else {
					t.Set("doneAt", "")
				}
				if err := app.Save(t); err != nil {
					return nil, err
				}
			case b.has("title"):
				title, _, err := task(b["title"], t.GetString("cadence"))
				if err != nil {
					return nil, err
				}
				t.Set("title", title)
				if err := app.Save(t); err != nil {
					return nil, err
				}
			case move == "up" || move == "down":
				order, err := taskList(app, user.Id, t.GetString("cadence"))
				if err != nil {
					return nil, err
				}
				at := -1
				for i, x := range order {
					if x.Id == t.Id {
						at = i
					}
				}
				to := at + 1
				if move == "up" {
					to = at - 1
				}
				if to >= 0 && to < len(order) {
					order[at], order[to] = order[to], order[at]
				}
				for i, x := range order {
					if x.GetInt("position") != i+1 {
						x.Set("position", i+1)
						if err := app.Save(x); err != nil {
							return nil, err
						}
					}
				}
			default:
				return nil, badRequest("Send done (true or false), a new title, move (up or down) or remove: true.")
			}
		} else {
			title, cadence, err := task(b["title"], b["cadence"])
			if err != nil {
				return nil, err
			}
			count, err := app.CountRecords("user_tasks", dbx.HashExp{"user": user.Id})
			if err != nil {
				return nil, err
			}
			if count >= 40 {
				return nil, badRequest("You can keep up to 40 tasks.")
			}
			order, err := taskList(app, user.Id, cadence)
			if err != nil {
				return nil, err
			}
			t, err := newRecord(app, "user_tasks")
			if err != nil {
				return nil, err
			}
			position := 1
			if len(order) > 0 {
				position = order[len(order)-1].GetInt("position") + 1
			}
			t.Set("user", user.Id)
			t.Set("title", title)
			t.Set("cadence", cadence)
			t.Set("position", position)
			if err := app.Save(t); err != nil {
				return nil, err
			}
		}
		return checklist(app, user.Id)
	})
}

// endSession ends a reader session; the characters it read keep their values but turn stale.
func endSession(app core.App, session *core.Record) error {
	read, err := list(app, "characters", "readingSession = {:id}", dbx.Params{"id": session.Id})
	if err != nil {
		return err
	}
	for _, c := range read {
		c.Set("valid", false)
		if err := app.Save(c); err != nil {
			return err
		}
	}
	return app.Delete(session)
}

// A version like 0.6.0.12; anything else is left out, never refused.
var versionForm = regexp.MustCompile(`^\d{1,5}(\.\d{1,5}){1,3}$`)

func appVersion(value any) string {
	if s, ok := value.(string); ok && versionForm.MatchString(trim(s)) {
		return trim(s)
	}
	return ""
}

// session opens a reader session. A paired app sends its device key, so removing the
// PC ends this session too; a key the server no longer knows means the pairing ended
// (401, and the app pairs again). Newer apps also send their version, for the
// superuser dashboard's Apps page.
func session(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		var device *core.Record
		if b.set("deviceKey") {
			key, err := deviceKey(b)
			if err != nil {
				return nil, err
			}
			if device = findDevice(app, key); device == nil || device.GetString("user") != user.Id {
				return nil, unauthorized("This PC is no longer paired with an account.")
			}
		}
		if b.set("previousSessionId") {
			previous, err := ownSession(app, user.Id, b.str("previousSessionId"))
			if err != nil {
				return nil, err
			}
			if err := endSession(app, previous); err != nil {
				return nil, err
			}
			roomIds, err := roomsFor(app, user.Id)
			if err != nil {
				return nil, err
			}
			*affected = append(*affected, roomIds...)
		}
		// A PC runs one Odyle at a time, so its new session replaces the ones it left open (a
		// restart, an update, a crash). Their readings are not marked stale: a restarted app
		// takes its character over within seconds, and otherwise the missing heartbeat turns
		// it stale.
		if device != nil {
			old, err := list(app, "publisher_sessions", "device = {:device}", dbx.Params{"device": device.Id})
			if err != nil {
				return nil, err
			}
			for _, s := range old {
				if err := app.Delete(s); err != nil {
					return nil, err
				}
			}
		}
		record, err := newRecord(app, "publisher_sessions")
		if err != nil {
			return nil, err
		}
		record.Set("user", user.Id)
		record.Set("expiresAt", expiry(86400))
		if device != nil {
			record.Set("device", device.Id)
		}
		record.Set("appVersion", appVersion(b["appVersion"]))
		if err := app.Save(record); err != nil {
			return nil, err
		}
		return map[string]any{"sessionId": record.Id, "sequence": 0}, nil
	})
}

// character saves a character's identity before its first game reading. This route
// cannot supply energy, confidence, ownership, timestamps or a reader session.
func character(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		for key := range b {
			if key != "characterName" && key != "server" && key != "region" {
				return nil, badRequest("Only character name, server and region may be saved here.")
			}
		}
		data, err := characterIdentity(b)
		if err != nil {
			return nil, err
		}
		existing, err := sameCharacter(app, user.Id, data)
		if err != nil {
			return nil, err
		}
		if len(existing) > 0 {
			return map[string]any{"character": existing[0]}, nil
		}
		record, err := newCharacter(app, user.Id)
		if err != nil {
			return nil, err
		}
		record.Set("characterName", data.characterName)
		record.Set("server", data.server)
		record.Set("region", data.region)
		record.Set("confirmed", false)
		record.Set("valid", false)
		if err := app.Save(record); err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return map[string]any{"character": record}, nil
	})
}

func sameCharacter(app core.App, userId string, data identity) ([]*core.Record, error) {
	return list(app, "characters", "user = {:user} && region = {:region} && server = {:server} && characterName = {:name}", dbx.Params{"user": userId, "region": data.region, "server": data.server, "name": data.characterName})
}

// report saves a reading of the Windows app.
func report(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		session, err := ownSession(app, user.Id, b.str("sessionId"))
		if err != nil {
			return nil, err
		}
		data, err := validReading(b, session.Id, session.GetInt64("sequence"), acceptedAdapters(app))
		if err != nil {
			return nil, err
		}
		var character *core.Record
		if b.set("characterId") {
			if character, err = ownCharacter(app, user.Id, b.str("characterId")); err != nil {
				return nil, err
			}
		} else {
			existing, err := sameCharacter(app, user.Id, identity{characterName: data.characterName, server: data.server, region: data.region})
			if err != nil {
				return nil, err
			}
			if len(existing) > 0 {
				character = existing[0]
			} else if character, err = newCharacter(app, user.Id); err != nil {
				return nil, err
			}
			// Only a lookup without characterId may name a character; an existing one
			// keeps the identity the game gave it.
			character.Set("characterName", data.characterName)
			character.Set("server", data.server)
			character.Set("region", data.region)
		}
		// lastReadingAt marks the last change, so a value re-sent unchanged (the reader
		// resumed after a pause) keeps its timestamp. Every change (the first reading
		// included) is also kept in the character's history.
		changed := !character.GetBool("confirmed") || character.GetInt64("value") != data.value
		if changed {
			character.Set("lastReadingAt", now())
		}
		character.Set("value", data.value)
		character.Set("confirmed", true)
		character.Set("valid", true)
		character.Set("source", "packet")
		character.Set("parserVersion", data.parserVersion)
		character.Set("lastSeenAt", now())
		character.Set("readingSession", session.Id)
		if err := app.Save(character); err != nil {
			return nil, err
		}
		if changed {
			point, err := newRecord(app, "character_readings")
			if err != nil {
				return nil, err
			}
			point.Set("character", character.Id)
			point.Set("value", data.value)
			if err := app.Save(point); err != nil {
				return nil, err
			}
		}
		session.Set("sequence", data.sequence)
		session.Set("expiresAt", expiry(86400))
		if err := app.Save(session); err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return map[string]any{"character": character, "serverNow": now()}, nil
	})
}

func sharing(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		if m.GetString("role") == "viewer" {
			return nil, forbidden("Viewers cannot share characters with this room.")
		}
		enabled, ok := b.boolean("enabled")
		if !ok {
			return nil, badRequest("Sharing must be true or false.")
		}
		// Sharing is per character. Without characterId (older clients) the choice
		// applies to every character the account has saved right now.
		var targets []string
		if b.set("characterId") {
			c, err := ownCharacter(app, user.Id, b.str("characterId"))
			if err != nil {
				return nil, err
			}
			targets = []string{c.Id}
		} else {
			saved, err := list(app, "characters", "user = {:user}", dbx.Params{"user": user.Id})
			if err != nil {
				return nil, err
			}
			targets = ids(saved)
		}
		next := []string{}
		for _, id := range stringSlice(m, "sharedCharacters") {
			if !contains(targets, id) {
				next = append(next, id)
			}
		}
		if enabled {
			next = append(next, targets...)
		}
		m.Set("sharedCharacters", next)
		if err := app.Save(m); err != nil {
			return nil, err
		}
		*affected = append(*affected, m.GetString("room"))
		return map[string]any{"sharedCharacters": next}, nil
	})
}

// heartbeat is presence only. No realtime refresh is sent: clients derive live/stale
// from lastSeenAt on their own schedule, and a broadcast every 20 seconds per reader
// made every member refetch the whole snapshot for nothing.
func heartbeat(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if b.set("sessionId") {
			session, err := ownSession(app, user.Id, b.str("sessionId"))
			if err != nil {
				return nil, err
			}
			session.Set("expiresAt", expiry(86400))
			if err := app.Save(session); err != nil {
				return nil, err
			}
			if b.set("characterId") {
				c, err := ownCharacter(app, user.Id, b.str("characterId"))
				if err != nil {
					return nil, err
				}
				if c.GetString("readingSession") == session.Id {
					c.Set("lastSeenAt", now())
					if err := app.Save(c); err != nil {
						return nil, err
					}
				}
			}
		}
		return map[string]any{"serverNow": now()}, nil
	})
}

func invalidate(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		if b.set("sessionId") && c.GetString("readingSession") != b.str("sessionId") {
			return nil, nil
		}
		c.Set("valid", false)
		if err := app.Save(c); err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return nil, nil
	})
}

func leave(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		if m.GetString("role") == "owner" {
			return nil, badRequest("Use close to delete an owned room. Characters are retained.")
		}
		*affected = append(*affected, m.GetString("room"))
		return nil, app.Delete(m)
	})
}

func closeRoom(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return nil, app.Delete(room)
	})
}

func invites(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		old, err := list(app, "room_invites", "room = {:room}", dbx.Params{"room": room.Id})
		if err != nil {
			return nil, err
		}
		for _, r := range old {
			if err := app.Delete(r); err != nil {
				return nil, err
			}
		}
		fresh, err := roomInvites(app, room)
		if err != nil {
			return nil, err
		}
		return map[string]any{"invites": fresh}, nil
	})
}

func revoke(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		target, err := otherMember(app, room, b.str("memberId"), user.Id, "Cannot remove this member.")
		if err != nil {
			return nil, err
		}
		if err := app.Delete(target); err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return nil, nil
	})
}

// Superusers can pause new pairings (Server controls); paired PCs keep signing in.
func pairingOpen(app core.App) error {
	if readSettings(app).PairingPaused {
		return badRequest("Pairing new PCs is paused for now. Try again later.")
	}
	return nil
}

func desktopCode(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, _ body, _ *[]string) (any, error) {
		if err := pairingOpen(app); err != nil {
			return nil, err
		}
		old, err := list(app, "desktop_codes", "user = {:user}", dbx.Params{"user": user.Id})
		if err != nil {
			return nil, err
		}
		for _, r := range old {
			if err := app.Delete(r); err != nil {
				return nil, err
			}
		}
		code := security.RandomStringWithAlphabet(16, codeAlphabet)
		record, err := newRecord(app, "desktop_codes")
		if err != nil {
			return nil, err
		}
		record.Set("user", user.Id)
		record.Set("digest", security.SHA256(code))
		record.Set("expiresAt", expiry(300))
		if err := app.Save(record); err != nil {
			return nil, err
		}
		return map[string]any{"code": code, "expiresAt": record.GetString("expiresAt")}, nil
	})
}

// newDevice is a paired Windows app's lasting credential. Only its digest is stored;
// the app keeps the key (DPAPI) and trades it for account tokens with desktopSignIn. An
// account keeps its most recently used devices, so stale pairings of reinstalled PCs
// drop off.
func newDevice(app core.App, userId, name string) (string, error) {
	devices, err := app.FindRecordsByFilter("desktop_devices", "user = {:user}", "-lastUsedAt,-created", 500, 0, dbx.Params{"user": userId})
	if err != nil {
		return "", err
	}
	if len(devices) >= limits.DesktopDevices {
		for _, old := range devices[limits.DesktopDevices-1:] {
			if err := dropDevice(app, old); err != nil {
				return "", err
			}
		}
	}
	key := security.RandomString(48)
	record, err := newRecord(app, "desktop_devices")
	if err != nil {
		return "", err
	}
	record.Set("user", userId)
	record.Set("digest", security.SHA256(key))
	record.Set("lastUsedAt", now())
	record.Set("name", name)
	return key, app.Save(record)
}

// dropDevice ends a pairing: its key stops working and its reader sessions end (their
// readings turn stale), so the app notices at its next heartbeat and asks for a new
// connection link.
func dropDevice(app core.App, device *core.Record) error {
	sessions, err := list(app, "publisher_sessions", "device = {:device}", dbx.Params{"device": device.Id})
	if err != nil {
		return err
	}
	for _, s := range sessions {
		if err := endSession(app, s); err != nil {
			return err
		}
	}
	return app.Delete(device)
}

func deviceKey(b body) (string, error) { return text(b["deviceKey"], "Device key", 100) }

func findDevice(app core.App, key string) *core.Record {
	device, err := app.FindFirstRecordByData("desktop_devices", "digest", security.SHA256(key))
	if err != nil {
		return nil
	}
	return device
}

// deviceName is the Windows computer name the app sends with pairing and sign-in;
// optional, for the list of paired PCs. Anything that is not a usable name is left
// out, never refused.
func deviceName(value any) string {
	if s, ok := value.(string); ok && trim(s) != "" {
		return cut(collapse(trim(s)), 40)
	}
	return ""
}

func pair(e *core.RequestEvent) error {
	return run(e, func() error {
		if err := pairingOpen(e.App); err != nil {
			return err
		}
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		typed, err := text(b["code"], "Pairing code", 24)
		if err != nil {
			return err
		}
		var result map[string]any
		if err := e.App.RunInTransaction(func(app core.App) error {
			record, err := app.FindFirstRecordByData("desktop_codes", "digest", security.SHA256(normalizeCode(typed)))
			if err != nil || !record.GetDateTime("expiresAt").Time().After(time.Now()) {
				return badRequest("Pairing code is invalid or expired.")
			}
			user, err := app.FindRecordById("users", record.GetString("user"))
			if err != nil {
				return err
			}
			if err := app.Delete(record); err != nil {
				return err
			}
			token, err := user.NewAuthToken()
			if err != nil {
				return err
			}
			key, err := newDevice(app, user.Id, deviceName(b["name"]))
			if err != nil {
				return err
			}
			result = map[string]any{"token": token, "record": user, "deviceKey": key}
			return nil
		}); err != nil {
			return err
		}
		return e.JSON(200, result)
	})
}

// desktopDevice gives a device key to an app paired before keys existed; it asks with
// its still-valid token.
func desktopDevice(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		key, err := newDevice(app, user.Id, deviceName(b["name"]))
		if err != nil {
			return nil, err
		}
		return map[string]any{"deviceKey": key}, nil
	})
}

// desktopSignIn is public: a fresh account token for a paired app. An unknown key (the
// app disconnected, the account signed out everywhere or was deleted) is 401, and the
// app pairs again.
func desktopSignIn(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		key, err := deviceKey(b)
		if err != nil {
			return err
		}
		device, name := findDevice(e.App, key), deviceName(b["name"])
		if device == nil {
			return unauthorized("This PC is no longer paired with an account.")
		}
		user, err := e.App.FindRecordById("users", device.GetString("user"))
		if err != nil {
			return err
		}
		device.Set("lastUsedAt", now())
		if name != "" {
			device.Set("name", name)
		}
		if err := e.App.Save(device); err != nil {
			return err
		}
		token, err := user.NewAuthToken()
		if err != nil {
			return err
		}
		return e.JSON(200, map[string]any{"token": token, "record": user})
	})
}

// unpair is public: the app's Disconnect forgets its key on the server too. Unknown
// keys are fine.
func unpair(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		key, err := deviceKey(b)
		if err != nil {
			return err
		}
		if device := findDevice(e.App, key); device != nil {
			roomIds, err := roomsFor(e.App, device.GetString("user"))
			if err != nil {
				return err
			}
			if err := e.App.RunInTransaction(func(app core.App) error {
				current, err := app.FindRecordById("desktop_devices", device.Id)
				if err != nil {
					return err
				}
				return dropDevice(app, current)
			}); err != nil {
				return err
			}
			notify(e.App, roomIds)
		}
		return e.JSON(200, map[string]any{"success": true})
	})
}

// forgetDevice removes one paired PC under Account & data, for example a lost or sold
// one; the other browsers and PCs stay signed in.
func forgetDevice(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		device, err := app.FindRecordById("desktop_devices", b.str("deviceId"))
		if err != nil {
			return nil, notFound("This PC is no longer paired.")
		}
		if device.GetString("user") != user.Id {
			return nil, forbidden("This PC is paired with another account.")
		}
		if err := dropDevice(app, device); err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return nil, nil
	})
}

// cleanup is the expiry job: expired invites, pairing codes and reader sessions,
// history older than 30 days and planned runs a day after they started.
func cleanup(app core.App) (result, error) {
	at := time.Now()
	done, err := purge(app, "room_invites", "expiresAt <= {:cutoff}", stamp(at))
	if err != nil {
		return nil, err
	}
	codes, err := purge(app, "desktop_codes", "expiresAt <= {:cutoff}", stamp(at))
	if err != nil {
		return nil, err
	}
	done += codes
	// Sessions end one by one: the characters they read turn stale.
	sessions, err := list(app, "publisher_sessions", "expiresAt <= {:now}", dbx.Params{"now": stamp(at)})
	if err != nil {
		return nil, err
	}
	for _, s := range sessions {
		if err := endSession(app, s); err != nil {
			return nil, err
		}
		done++
	}
	// Odyle history covers 30 days; planned runs go a day after they started.
	history, err := purge(app, "character_readings", "created < {:cutoff}", stamp(at.Add(-30*24*time.Hour)))
	if err != nil {
		return nil, err
	}
	runs, err := purge(app, "room_runs", "startsAt < {:cutoff}", stamp(at.Add(-24*time.Hour)))
	if err != nil {
		return nil, err
	}
	return result{"done": done + history + runs}, nil
}

// Rows purge deletes per statement, and statements per run: a backlog (after a long
// stop, say) goes over a few runs instead of holding the database in one long write.
var purgeBatch, purgeBatches = 1000, 50

// purge deletes the rows of a collection that match the condition (compared with
// {:cutoff}) without loading them. It is only for the expiry job's invites, pairing
// codes, history and runs: nothing refers to them and they have no files or hooks, so
// deleting each record would add queries and change nothing else.
func purge(app core.App, collection, condition, cutoff string) (int, error) {
	query := "DELETE FROM {{" + collection + "}} WHERE [[id]] IN (SELECT [[id]] FROM {{" + collection + "}} WHERE " + condition + " LIMIT {:limit})"
	total := 0
	for range purgeBatches {
		res, err := app.DB().NewQuery(query).Bind(dbx.Params{"cutoff": cutoff, "limit": purgeBatch}).Execute()
		if err != nil {
			return total, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return total, err
		}
		total += int(n)
		if n < int64(purgeBatch) {
			break
		}
	}
	return total, nil
}

// configureDiscord enables Discord sign-in from DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.
func configureDiscord(app core.App) error {
	clientId, clientSecret := os.Getenv("DISCORD_CLIENT_ID"), os.Getenv("DISCORD_CLIENT_SECRET")
	if clientId == "" || clientSecret == "" {
		return nil
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.OAuth2.Enabled, users.OAuth2.Providers = true, []core.OAuth2ProviderConfig{{Name: "discord", ClientId: clientId, ClientSecret: clientSecret}}
	return app.Save(users)
}

// runsOf lists the upcoming runs of a room, soonest first; a run stays listed until three
// hours after it started. planner and attendees are account ids; clients name them
// from members.
func runsOf(app core.App, roomId string, members []*core.Record) ([]any, error) {
	if members == nil {
		var err error
		if members, err = roomMembers(app, roomId); err != nil {
			return nil, err
		}
	}
	users := memberUsers(members)
	found, err := app.FindRecordsByFilter("room_runs", "room = {:room} && startsAt >= {:since}", "startsAt", 0, 0, dbx.Params{"room": roomId, "since": ago(3 * time.Hour)})
	if err != nil {
		return nil, err
	}
	out := make([]any, len(found))
	for i, r := range found {
		attendees := []string{}
		for _, id := range stringSlice(r, "attendees") {
			if user := users[id]; user != "" {
				attendees = append(attendees, user)
			}
		}
		out[i] = map[string]any{"id": r.Id, "dungeon": r.GetString("dungeon"), "startsAt": r.GetString("startsAt"), "note": r.GetString("note"), "planner": users[r.GetString("plannedBy")], "attendees": attendees}
	}
	return out, nil
}

// plan handles planned runs: { roomId, dungeon, startsAt, note? } plans one with the
// planner going, { roomId, id, going } joins or leaves it, { roomId, id, dungeon?,
// startsAt?, note? } changes it and { roomId, id, remove: true } cancels it (changes
// and cancelling: its planner or the room owner). Owners and players plan and join;
// viewers read.
func plan(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		roomId, viewer, isOwner := m.GetString("room"), m.GetString("role") == "viewer", m.GetString("role") == "owner"
		if b.set("id") {
			r, err := app.FindRecordById("room_runs", b.str("id"))
			if err != nil || r.GetString("room") != roomId {
				return nil, notFound("This run is no longer planned.")
			}
			going, isGoing := b.boolean("going")
			switch {
			case b.isTrue("remove"):
				if r.GetString("plannedBy") != m.Id && !isOwner {
					return nil, forbidden("Only its planner or the room owner can cancel this run.")
				}
				if err := app.Delete(r); err != nil {
					return nil, err
				}
			case isGoing:
				if viewer {
					return nil, forbidden("Viewers cannot join runs.")
				}
				attendees := []string{}
				for _, id := range stringSlice(r, "attendees") {
					if id != m.Id {
						attendees = append(attendees, id)
					}
				}
				if going {
					attendees = append(attendees, m.Id)
				}
				r.Set("attendees", attendees)
				if err := app.Save(r); err != nil {
					return nil, err
				}
			case b.has("dungeon") || b.has("startsAt") || b.has("note"):
				if viewer {
					return nil, forbidden("Viewers cannot plan runs.")
				}
				if r.GetString("plannedBy") != m.Id && !isOwner {
					return nil, forbidden("Only its planner or the room owner can change this run.")
				}
				// A run keeps its dungeon when the name only differs in case or spacing,
				// even if the catalog changed since.
				if b.has("dungeon") {
					typed, err := dungeon(b["dungeon"])
					if err != nil {
						return nil, err
					}
					current, err := dungeon(r.GetString("dungeon"))
					if err != nil {
						return nil, err
					}
					if typed.key != current.key {
						name, err := catalogName(app, b["dungeon"])
						if err != nil {
							return nil, err
						}
						if name == nil {
							return nil, badRequest("Choose a dungeon from the list.")
						}
						r.Set("dungeon", name.dungeon)
					}
				}
				// A new start time is announced again on Discord.
				if b.has("startsAt") {
					startsAt, err := runStart(b["startsAt"], time.Now())
					if err != nil {
						return nil, err
					}
					if parsed, _ := parseDate(startsAt); !parsed.Equal(r.GetDateTime("startsAt").Time()) {
						r.Set("startsAt", startsAt)
						r.Set("remindedAt", "")
					}
				}
				if b.has("note") {
					n, err := note(b, "note")
					if err != nil {
						return nil, err
					}
					r.Set("note", n)
				}
				if err := app.Save(r); err != nil {
					return nil, err
				}
			default:
				return nil, badRequest("Send going (true or false), the changes to the run or remove: true.")
			}
		} else {
			if viewer {
				return nil, forbidden("Viewers cannot plan runs.")
			}
			name, err := catalogName(app, b["dungeon"])
			if err != nil {
				return nil, err
			}
			if name == nil {
				return nil, badRequest("Choose a dungeon from the list.")
			}
			n, err := note(b, "note")
			if err != nil {
				return nil, err
			}
			startsAt, err := runStart(b["startsAt"], time.Now())
			if err != nil {
				return nil, err
			}
			count, err := app.CountRecords("room_runs", dbx.HashExp{"room": roomId})
			if err != nil {
				return nil, err
			}
			if count >= 20 {
				return nil, badRequest("A room can plan up to 20 runs at a time.")
			}
			r, err := newRecord(app, "room_runs")
			if err != nil {
				return nil, err
			}
			r.Set("room", roomId)
			r.Set("dungeon", name.dungeon)
			r.Set("startsAt", startsAt)
			r.Set("note", n)
			r.Set("plannedBy", m.Id)
			r.Set("attendees", []string{m.Id})
			if err := app.Save(r); err != nil {
				return nil, err
			}
		}
		*affected = append(*affected, roomId)
		runs, err := runsOf(app, roomId, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"runs": runs}, nil
	})
}

// Room management by its owner: rename it, make a member a player (reporter) or a
// viewer, or hand the room over. Viewers cannot share, so a member made viewer stops
// sharing characters here. The previous owner stays as a player and can then leave.
func rename(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		name, err := text(b["name"], "Room name", 60)
		if err != nil {
			return nil, err
		}
		room.Set("name", name)
		if err := app.Save(room); err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return map[string]any{"room": roomJSON(room, odylePerCube(app))}, nil
	})
}

func role(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		target, err := otherMember(app, room, b.str("memberId"), user.Id, "Cannot change this member.")
		if err != nil {
			return nil, err
		}
		next, _ := b.text("role")
		if next != "reporter" && next != "viewer" {
			return nil, badRequest("Choose player or viewer.")
		}
		target.Set("role", next)
		if next == "viewer" {
			target.Set("sharedCharacters", []string{})
		}
		if err := app.Save(target); err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return map[string]any{"membership": target}, nil
	})
}

func transfer(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		target, err := otherMember(app, room, b.str("memberId"), user.Id, "Cannot hand the room to this member.")
		if err != nil {
			return nil, err
		}
		mine, err := membership(app, user.Id, room.Id)
		if err != nil {
			return nil, err
		}
		target.Set("role", "owner")
		if err := app.Save(target); err != nil {
			return nil, err
		}
		mine.Set("role", "reporter")
		if err := app.Save(mine); err != nil {
			return nil, err
		}
		room.Set("owner", target.GetString("user"))
		if err := app.Save(room); err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return map[string]any{"room": roomJSON(room, odylePerCube(app))}, nil
	})
}

// discordWebhook lets the room owner connect a Discord channel webhook ({ roomId,
// webhook, language }) or disconnects it (an empty webhook). A test post proves the webhook
// before it is saved; it runs outside a transaction because it waits on Discord. No
// response carries the URL.
func discordWebhook(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		room, err := owner(e.App, e.Auth.Id, b.str("roomId"))
		if err != nil {
			return err
		}
		url, err := webhook(b["webhook"])
		if err != nil {
			return err
		}
		language := "en"
		if l, _ := b.text("language"); l == "cs" {
			language = "cs"
		}
		if url != "" {
			if err := connectWebhook(url, room.GetString("name"), language); err != nil {
				return err
			}
		}
		room.Set("discordWebhook", url)
		room.Set("discordLanguage", language)
		if err := e.App.Save(room); err != nil {
			return err
		}
		notify(e.App, []string{room.Id})
		return e.JSON(200, map[string]any{"room": roomJSON(room, odylePerCube(e.App))})
	})
}

// remindRuns is a job, every minute: it posts each run to its room's Discord channel 15
// minutes before it starts, or at once when it was planned later than that. A run is
// announced once and again after a new start time; a webhook Discord no longer knows is
// dropped. Paused by superusers (Server controls), runs starting meanwhile are not
// announced afterwards. Discord limits each webhook, so the runs of one webhook are
// posted one after another; up to four webhooks post at the same time, so one slow
// channel does not hold up the others.
func remindRuns(app core.App) (result, error) {
	if readSettings(app).RemindersPaused {
		return result{"skipped": "paused"}, nil
	}
	var mu sync.Mutex
	out := result{"done": 0, "failed": 0}
	// text is the job's last error on the Background jobs page; the log line keeps the fields.
	fail := func(text, event string, args ...any) {
		mu.Lock()
		out["failed"] = out["failed"].(int) + 1
		out["error"] = text
		mu.Unlock()
		warn(app, event, args...)
	}
	at := time.Now()
	due, err := app.FindRecordsByFilter("room_runs", "remindedAt = '' && room.discordWebhook != '' && startsAt > {:now} && startsAt <= {:soon}", "startsAt", 50, 0, dbx.Params{"now": stamp(at), "soon": stamp(at.Add(15 * time.Minute))})
	if err != nil || len(due) == 0 {
		return out, err
	}
	rooms, err := app.FindRecordsByIds("party_rooms", unique(field(due, "room")))
	if err != nil {
		return nil, err
	}
	webhooks := map[string]string{}
	for _, room := range rooms {
		webhooks[room.Id] = room.GetString("discordWebhook")
	}
	groups, order := map[string][]*core.Record{}, []string{}
	for _, r := range due {
		link := webhooks[r.GetString("room")]
		if groups[link] == nil {
			order = append(order, link)
		}
		groups[link] = append(groups[link], r)
	}
	slots := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, link := range order {
		wg.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			for _, r := range groups[link] {
				reminded, err := safeRemind(app, r, fail)
				if err != nil {
					fail("Reminder for run "+r.Id+" failed: "+message(err), "Odyle run reminder failed", "run", r.Id, "error", message(err))
				} else if reminded {
					mu.Lock()
					out["done"] = out["done"].(int) + 1
					mu.Unlock()
				}
			}
		})
	}
	wg.Wait()
	return out, nil
}

// safeRemind is remindRun with a panic turned into its error.
func safeRemind(app core.App, r *core.Record, fail func(text, event string, args ...any)) (reminded bool, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("the reminder failed: %v", p)
		}
	}()
	return remindRun(app, r, fail)
}

// remindRun posts one run and reports whether Discord took it.
func remindRun(app core.App, r *core.Record, fail func(text, event string, args ...any)) (bool, error) {
	room, err := app.FindRecordById("party_rooms", r.GetString("room"))
	if err != nil {
		return false, err
	}
	url, attendees, users := room.GetString("discordWebhook"), stringSlice(r, "attendees"), []string{}
	// Dropped by an earlier run of this job (Discord no longer knew it), or disconnected meanwhile.
	if url == "" {
		return false, nil
	}
	if len(attendees) > 0 {
		members, err := app.FindRecordsByIds("room_members", attendees)
		if err != nil {
			return false, err
		}
		users = field(members, "user")
	}
	going := []string{}
	if len(users) > 0 {
		accounts, err := app.FindRecordsByIds("users", users)
		if err != nil {
			return false, err
		}
		going = field(accounts, "displayName")
	}
	waits := &stateOf(app).webhooks
	if waits.waiting(url, time.Now()) {
		return false, nil
	}
	message := reminder(room.GetString("name"), r.GetString("dungeon"), r.GetString("startsAt"), r.GetString("note"), going, room.GetString("discordLanguage"))
	res, err := postWebhook(url, message)
	// A short wait (a burst of runs in one room) is waited out once.
	if wait := retryAfter(res); err == nil && res.status == http.StatusTooManyRequests && wait <= 2*time.Second {
		time.Sleep(wait)
		res, err = postWebhook(url, message)
	}
	if err != nil {
		return false, err
	}
	status := res.status
	switch {
	case status == http.StatusTooManyRequests:
		wait := waits.wait(url, res, time.Now())
		fail("Reminder for run "+r.Id+" waits: Discord asked to wait "+wait.Round(time.Second).String(), "Odyle run reminder waits for Discord", "run", r.Id, "room", room.Id, "retryAfter", wait.String())
	case status == 401 || status == 404:
		room.Set("discordWebhook", "")
		if err := app.Save(room); err != nil {
			return false, err
		}
		notify(app, []string{room.Id})
		fail("Dropped the Discord webhook of room "+room.Id+": Discord answered "+strconv.Itoa(status), "Odyle dropped a Discord webhook that Discord no longer knows", "room", room.Id, "status", status)
	case status >= 200 && status < 300:
		r.Set("remindedAt", now())
		return true, app.Save(r)
	default:
		fail("Reminder for run "+r.Id+" failed: Discord answered "+strconv.Itoa(status), "Odyle run reminder failed", "run", r.Id, "status", status)
	}
	return false, nil
}

// upcoming lists the runs the account is going to in the next 24 hours across all its
// rooms, for reminders in the browser and the Windows app.
func upcoming(e *core.RequestEvent) error {
	return run(e, func() error {
		memberships, err := list(e.App, "room_members", "user = {:user}", dbx.Params{"user": e.Auth.Id})
		if err != nil {
			return err
		}
		mine, names, roomIds := map[string]string{}, map[string]string{}, []string{}
		for _, m := range memberships {
			if _, ok := mine[m.GetString("room")]; !ok {
				roomIds = append(roomIds, m.GetString("room"))
			}
			mine[m.GetString("room")] = m.Id
		}
		if len(roomIds) == 0 {
			return e.JSON(200, map[string]any{"runs": []any{}, "serverNow": now()})
		}
		rooms, err := e.App.FindRecordsByIds("party_rooms", roomIds)
		if err != nil {
			return err
		}
		for _, r := range rooms {
			names[r.Id] = r.GetString("name")
		}
		at := time.Now()
		found, err := e.App.FindAllRecords("room_runs", dbx.In("room", anys(roomIds)...), dbx.NewExp("startsAt > {:now} AND startsAt <= {:until}", dbx.Params{"now": stamp(at), "until": stamp(at.Add(24 * time.Hour))}))
		if err != nil {
			return err
		}
		out := []map[string]any{}
		for _, r := range found {
			if !contains(stringSlice(r, "attendees"), mine[r.GetString("room")]) {
				continue
			}
			out = append(out, map[string]any{"id": r.Id, "roomId": r.GetString("room"), "room": names[r.GetString("room")], "dungeon": r.GetString("dungeon"), "startsAt": r.GetString("startsAt"), "note": r.GetString("note")})
		}
		sort.SliceStable(out, func(a, b int) bool { return out[a]["startsAt"].(string) < out[b]["startsAt"].(string) })
		return e.JSON(200, map[string]any{"runs": out, "serverNow": now()})
	})
}

// handOver passes each room an account owns to its longest-standing player; a room
// without one closes. It runs as the users delete hook, inside the deleting
// transaction, for every account deletion (by its owner, a superuser or for
// inactivity).
func handOver(app core.App, userId string) error {
	owned, err := app.FindRecordsByFilter("party_rooms", "owner = {:user}", "", 0, 0, dbx.Params{"user": userId})
	if err != nil {
		return err
	}
	for _, room := range owned {
		next, err := app.FindRecordsByFilter("room_members", "room = {:room} && user != {:user} && role = 'reporter'", "created", 1, 0, dbx.Params{"room": room.Id, "user": userId})
		if err != nil {
			return err
		}
		if len(next) == 0 {
			if err := app.Delete(room); err != nil {
				return err
			}
			continue
		}
		next[0].Set("role", "owner")
		if err := app.Save(next[0]); err != nil {
			return err
		}
		room.Set("owner", next[0].GetString("user"))
		if err := app.Save(room); err != nil {
			return err
		}
	}
	return nil
}

// account answers the account page: profile, caps and the Windows apps (reader
// sessions) in use.
func account(e *core.RequestEvent) error {
	return run(e, func() error {
		user, err := e.App.FindRecordById("users", e.Auth.Id)
		if err != nil {
			return err
		}
		sessions, err := e.App.FindRecordsByFilter("publisher_sessions", "user = {:user} && expiresAt > {:now}", "-updated", 20, 0, dbx.Params{"user": user.Id, "now": stamp(time.Now())})
		if err != nil {
			return err
		}
		reading := map[string]string{}
		if len(sessions) > 0 {
			read, err := e.App.FindAllRecords("characters", dbx.In("readingSession", anys(ids(sessions))...))
			if err != nil {
				return err
			}
			for _, c := range read {
				reading[c.GetString("readingSession")] = c.GetString("characterName")
			}
		}
		devices, err := e.App.FindRecordsByFilter("desktop_devices", "user = {:user}", "-lastUsedAt,-created", 0, 0, dbx.Params{"user": user.Id})
		if err != nil {
			return err
		}
		characters, err := e.App.CountRecords("characters", dbx.HashExp{"user": user.Id})
		if err != nil {
			return err
		}
		apps := make([]any, len(sessions))
		for i, s := range sessions {
			apps[i] = map[string]any{"sessionId": s.Id, "connectedAt": s.GetString("created"), "lastContactAt": s.GetString("updated"), "character": reading[s.Id], "device": s.GetString("device")}
		}
		paired := make([]any, len(devices))
		for i, d := range devices {
			paired[i] = map[string]any{"id": d.Id, "name": d.GetString("name"), "pairedAt": d.GetString("created"), "lastSignInAt": d.GetString("lastUsedAt")}
		}
		return e.JSON(200, map[string]any{
			"account":    map[string]any{"id": user.Id, "displayName": user.GetString("displayName"), "email": user.Email(), "created": user.GetString("created"), "lastActiveAt": user.GetString("lastActiveAt")},
			"limits":     limits,
			"serverNow":  now(),
			"characters": characters,
			"apps":       apps,
			"devices":    paired,
		})
	})
}

func profile(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		record, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		name, err := displayName(b["displayName"])
		if err != nil {
			return nil, err
		}
		record.Set("displayName", name)
		if err := app.Save(record); err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return map[string]any{"record": record}, nil
	})
}

// exportData is everything stored for the account as one JSON document (Download my data).
func exportData(e *core.RequestEvent) error {
	return run(e, func() error {
		app := e.App
		user, err := app.FindRecordById("users", e.Auth.Id)
		if err != nil {
			return err
		}
		mine := dbx.Params{"user": user.Id}
		characters, err := all(app, "characters", "user = {:user}", mine)
		if err != nil {
			return err
		}
		memberships, err := all(app, "room_members", "user = {:user}", mine)
		if err != nil {
			return err
		}
		names := map[string]string{}
		if len(memberships) > 0 {
			rooms, err := app.FindRecordsByIds("party_rooms", field(memberships, "room"))
			if err != nil {
				return err
			}
			for _, r := range rooms {
				names[r.Id] = r.GetString("name")
			}
		}
		auths, err := app.FindAllExternalAuthsByRecord(user)
		if err != nil {
			return err
		}
		signIns := make([]any, len(auths))
		for i, a := range auths {
			signIns[i] = map[string]any{"provider": a.Provider(), "providerId": a.ProviderId(), "created": a.GetString("created")}
		}
		exportedCharacters := make([]any, len(characters))
		for i, c := range characters {
			points, err := all(app, "character_readings", "character = {:id}", dbx.Params{"id": c.Id})
			if err != nil {
				return err
			}
			history := make([]any, len(points))
			for j, p := range points {
				history[j] = map[string]any{"value": p.GetInt64("value"), "at": p.GetString("created")}
			}
			j := c.PublicExport()
			j["history"] = history
			exportedCharacters[i] = j
		}
		rooms := make([]any, len(memberships))
		for i, m := range memberships {
			wishes, err := all(app, "room_wishes", "member = {:member}", dbx.Params{"member": m.Id})
			if err != nil {
				return err
			}
			runs, err := all(app, "room_runs", "plannedBy = {:member} || attendees ~ {:member}", dbx.Params{"member": m.Id})
			if err != nil {
				return err
			}
			planned := make([]any, len(runs))
			for j, r := range runs {
				planned[j] = map[string]any{"dungeon": r.GetString("dungeon"), "startsAt": r.GetString("startsAt"), "note": r.GetString("note"), "planned": r.GetString("plannedBy") == m.Id}
			}
			rooms[i] = map[string]any{"room": m.GetString("room"), "name": names[m.GetString("room")], "role": m.GetString("role"), "joined": m.GetString("created"), "sharedCharacters": stringSlice(m, "sharedCharacters"), "wishlist": field(wishes, "dungeon"), "runs": planned}
		}
		checklist, err := tasksOf(app, user.Id)
		if err != nil {
			return err
		}
		sessions, err := all(app, "publisher_sessions", "user = {:user}", mine)
		if err != nil {
			return err
		}
		readerSessions := make([]any, len(sessions))
		for i, s := range sessions {
			readerSessions[i] = map[string]any{"id": s.Id, "connectedAt": s.GetString("created"), "lastContactAt": s.GetString("updated"), "expiresAt": s.GetString("expiresAt")}
		}
		devices, err := all(app, "desktop_devices", "user = {:user}", mine)
		if err != nil {
			return err
		}
		paired := make([]any, len(devices))
		for i, d := range devices {
			paired[i] = map[string]any{"name": d.GetString("name"), "pairedAt": d.GetString("created"), "lastSignInAt": d.GetString("lastUsedAt")}
		}
		return e.JSON(200, map[string]any{
			"exportedAt":        now(),
			"account":           map[string]any{"id": user.Id, "displayName": user.GetString("displayName"), "email": user.Email(), "created": user.GetString("created"), "lastActiveAt": user.GetString("lastActiveAt"), "signIns": signIns},
			"characters":        exportedCharacters,
			"rooms":             rooms,
			"tasks":             checklist,
			"readerSessions":    readerSessions,
			"pairedWindowsApps": paired,
		})
	})
}

// signOutEverywhere ends every sign-in of the account: other browsers and paired
// Windows apps lose their tokens, device keys, reader sessions and pairing codes. The
// asking browser gets a new token.
func signOutEverywhere(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, _ body, affected *[]string) (any, error) {
		record, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		record.RefreshTokenKey()
		if err := app.Save(record); err != nil {
			return nil, err
		}
		sessions, err := list(app, "publisher_sessions", "user = {:user}", dbx.Params{"user": user.Id})
		if err != nil {
			return nil, err
		}
		for _, s := range sessions {
			if err := endSession(app, s); err != nil {
				return nil, err
			}
		}
		for _, name := range []string{"desktop_codes", "desktop_devices"} {
			items, err := list(app, name, "user = {:user}", dbx.Params{"user": user.Id})
			if err != nil {
				return nil, err
			}
			for _, item := range items {
				if err := app.Delete(item); err != nil {
					return nil, err
				}
			}
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		token, err := record.NewAuthToken()
		if err != nil {
			return nil, err
		}
		return map[string]any{"token": token, "record": record}, nil
	})
}

// deleteAccount deletes the account with its characters, history, memberships, wishes
// and tasks; owned rooms pass on first (handOver). Body { confirm: true } guards
// against slips.
func deleteAccount(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		if !b.isTrue("confirm") {
			return nil, badRequest("Confirm that the account should be deleted.")
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		record, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		return nil, app.Delete(record)
	})
}

// deleteCharacter deletes one character with its history and portrait; rooms stop
// listing it. A reader that sees it in game again saves it as a new character.
func deleteCharacter(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return nil, app.Delete(c)
	})
}

// history is a character's Odyle over the last 30 days, oldest first. Its owner and
// members of rooms it is shared in may read it, like its current value.
func history(e *core.RequestEvent) error {
	return run(e, func() error {
		id := e.Request.PathValue("id")
		c, err := e.App.FindRecordById("characters", id)
		if err != nil {
			return notFound("This character no longer exists.")
		}
		if c.GetString("user") != e.Auth.Id {
			sharedIn, err := list(e.App, "room_members", "user = {:owner} && sharedCharacters ~ {:id}", dbx.Params{"owner": c.GetString("user"), "id": id})
			if err != nil {
				return err
			}
			allowed := false
			for _, room := range field(sharedIn, "room") {
				member, err := list(e.App, "room_members", "room = {:room} && user = {:user}", dbx.Params{"room": room, "user": e.Auth.Id})
				if err != nil {
					return err
				}
				if len(member) > 0 {
					allowed = true
					break
				}
			}
			if !allowed {
				return forbidden("This character is not shared with you.")
			}
		}
		points, err := e.App.FindRecordsByFilter("character_readings", "character = {:id} && created >= {:since}", "-created", 500, 0, dbx.Params{"id": id, "since": ago(30 * 24 * time.Hour)})
		if err != nil {
			return err
		}
		readings := make([]any, len(points))
		for i, p := range points {
			readings[len(points)-1-i] = map[string]any{"value": p.GetInt64("value"), "at": p.GetString("created")}
		}
		return e.JSON(200, map[string]any{"character": map[string]any{"id": c.Id, "characterName": c.GetString("characterName"), "value": c.GetInt64("value"), "confirmed": c.GetBool("confirmed")}, "readings": readings, "serverNow": now()})
	})
}

// retention is the nightly job that deletes accounts unused for
// odyle_settings.inactiveAccountDays days (0 keeps them), up to 200 a night. handOver
// passes their rooms on first.
func retention(app core.App) (result, error) {
	days := readSettings(app).InactiveAccountDays
	if days == 0 {
		return result{"skipped": "off"}, nil
	}
	cutoff, out := ago(time.Duration(days)*24*time.Hour), result{"done": 0, "failed": 0}
	users, err := app.FindRecordsByFilter("users", "lastActiveAt < {:cutoff} && (lastActiveAt != '' || created < {:cutoff})", "lastActiveAt", 200, 0, dbx.Params{"cutoff": cutoff})
	if err != nil {
		return nil, err
	}
	for _, user := range users {
		roomIds, err := roomsFor(app, user.Id)
		if err == nil {
			err = app.Delete(user)
		}
		if err != nil {
			out["failed"] = out["failed"].(int) + 1
			out["error"] = "Account " + user.Id + ": " + message(err)
			warn(app, "Odyle could not delete an inactive account", "user", user.Id, "error", message(err))
			continue
		}
		notify(app, roomIds)
		out["done"] = out["done"].(int) + 1
		info(app, "Odyle deleted an inactive account", "user", user.Id)
	}
	return out, nil
}
