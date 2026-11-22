package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
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

func membership(app core.App, userId, roomId string) (*Member, error) {
	found, err := membershipsWhere(app, "room = {:room} && user = {:user}", dbx.Params{"room": roomId, "user": userId})
	if err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, forbidden("You are not a member of this room.")
	}
	return found[0], nil
}

func owner(app core.App, userId, roomId string) (*Room, error) {
	room, err := findAs[Room](app, "party_rooms", roomId)
	if err != nil {
		return nil, notFound("This room no longer exists.")
	}
	if room.Owner() != userId {
		return nil, forbidden("Only the room owner can do this.")
	}
	return room, nil
}

// manager is the room for its owner or one of its officers (#43). Officers run the room with
// its owner: invite links, every planned run, clearing a dungeon off everyone's wishlist and
// Discord reminders. Renaming and closing the room, roles, removing members and handing the
// room over stay with the owner.
func manager(app core.App, userId, roomId string) (*Room, error) {
	room, err := findAs[Room](app, "party_rooms", roomId)
	if err != nil {
		return nil, notFound("This room no longer exists.")
	}
	if room.Owner() == userId {
		return room, nil
	}
	if m, err := membership(app, userId, roomId); err != nil || m.Role() != "officer" {
		return nil, forbidden("Only the room owner or an officer can do this.")
	}
	return room, nil
}

func ownCharacter(app core.App, userId, id string) (*Character, error) {
	character, err := findAs[Character](app, "characters", id)
	if err != nil {
		return nil, notFound("This character no longer exists.")
	}
	if character.User() != userId {
		return nil, forbidden("This character belongs to another account.")
	}
	return character, nil
}

// otherMember is another membership of the owner's room, for removing, re-roling or handing over.
func otherMember(app core.App, room *Room, memberId, userId, refusal string) (*Member, error) {
	target, err := findAs[Member](app, "room_members", memberId)
	if err != nil {
		return nil, notFound("This member is no longer in the room.")
	}
	if target.Room() != room.Id || target.User() == userId {
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

func newCharacter(app core.App, userId string) (*Character, error) {
	count, err := app.CountRecords("characters", dbx.HashExp{"user": userId})
	if err != nil {
		return nil, err
	}
	if count >= limits.Characters {
		return nil, badRequest("You can keep up to 30 characters. Delete one you no longer play under My rooms & characters.")
	}
	c, err := newAs[Character](app, "characters")
	if err != nil {
		return nil, err
	}
	c.SetUser(userId)
	// An account with PvP stats on counts for its new characters from zero (pvp.go).
	if owner, err := app.FindRecordById("users", userId); err == nil && owner.GetBool("pvpStats") {
		c.Set("pvp", pvpCounts{})
	}
	return c, nil
}

// shareNew shares a character the account has just saved in every room where it turned
// shareNew on; a viewer's membership never shares.
func shareNew(app core.App, c *Character) error {
	memberships, err := membershipsWhere(app, "user = {:user} && shareNew = true && role != 'viewer'", dbx.Params{"user": c.User()})
	if err != nil {
		return err
	}
	if err := loadShares(app, memberships); err != nil {
		return err
	}
	for _, m := range memberships {
		if err := shareIn(app, m, c.Id); err != nil {
			return err
		}
	}
	return nil
}

// POST /api/odyle/share-new turns shareNew on or off for one of the account's rooms.
func shareNewSetting(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		if m.Role() == "viewer" {
			return nil, forbidden("Viewers cannot share characters with this room.")
		}
		enabled, ok := b.boolean("enabled")
		if !ok {
			return nil, badRequest("Sharing must be true or false.")
		}
		m.Set("shareNew", enabled)
		if err := app.Save(m); err != nil {
			return nil, err
		}
		*affected = append(*affected, m.Room())
		return map[string]any{"shareNew": enabled}, nil
	})
}

func ownSession(app core.App, userId, id string) (*ReaderSession, error) {
	session, err := findAs[ReaderSession](app, "publisher_sessions", id)
	if err != nil || session.User() != userId || !session.ExpiresAt().After(time.Now()) {
		return nil, forbidden("Publisher session expired. Reconnect.")
	}
	return session, nil
}

// Odyle per cube is one server-wide value (odyle_settings, edited by superusers).
// Rooms keep their legacy cost field, but every response reports the setting. A dungeon
// of the catalog can cost its own amount (dungeonEntry), which only snapshots carry.
func odylePerCube(app core.App) int64 { return readSettings(app).OdylePerCube }

// The Discord webhook is a hidden field, so the public export never carries it; members
// only learn whether the room posts reminders. So is the information board, which only the
// snapshot carries (boardOf). features says whether each room feature is on.
func roomJSON(room *Room, cost int64) map[string]any {
	out := room.PublicExport()
	out["cost"] = cost
	out["discordReminders"] = room.DiscordWebhook() != ""
	out["features"] = room.Features()
	return out
}

func roomsFor(app core.App, userId string) ([]string, error) {
	found, err := membershipsWhere(app, "user = {:user}", dbx.Params{"user": userId})
	if err != nil {
		return nil, err
	}
	rooms := make([]string, len(found))
	for i, m := range found {
		rooms[i] = m.Room()
	}
	return rooms, nil
}

// touch marks the last time the account used Odyle, for the optional clean-up of
// inactive accounts (retention). Written at most hourly, so readings stay cheap.
func touch(e *core.RequestEvent) {
	auth := e.Auth
	if auth == nil || auth.Collection().Name != "users" {
		return
	}
	if viewOf[Account](auth).LastActiveAt() > ago(time.Hour) {
		return
	}
	// Only this field: a whole-record save of a copy read here would put back what another
	// request committed meanwhile (spins, settings, a rotated token key).
	if _, err := e.App.DB().NewQuery("UPDATE users SET lastActiveAt = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": stamp(time.Now()), "id": auth.Id}).Execute(); err != nil {
		warn(e.App, "Odyle activity mark failed", "user", auth.Id, "error", err.Error())
	}
}

// run answers a route: errors meant for the client (badRequest and the others in helpers.go)
// pass as they are, and a record deleted meanwhile (another tab, another member) is 404.
// Anything else is the server's (a locked database, a broken constraint, a bug): it is logged
// with the route and the account and answers 500 without its text, which the client could not
// act on.
func run(e *core.RequestEvent, action func() error) error {
	touch(e)
	err := action()
	if err == nil || apiStatus(err) != 0 {
		return err
	}
	if isNoRows(err) {
		return notFound("This no longer exists. Reload the page.")
	}
	account := ""
	if e.Auth != nil {
		account = e.Auth.Id
	}
	// The route's pattern, not its path, which can carry a token (the calendar feed).
	route := e.Request.Pattern
	if route == "" {
		route = e.Request.Method
	}
	warn(e.App, "Odyle request failed", "route", route, "user", account, "error", err.Error())
	return serverError()
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
