package odyle

import (
	"sort"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

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
		room, err := newAs[Room](app, "party_rooms")
		if err != nil {
			return nil, err
		}
		cost := odylePerCube(app)
		name, err := text(b["name"], "Room name", 60)
		if err != nil {
			return nil, err
		}
		room.SetName(name)
		room.SetOwner(user.Id)
		if err := app.Save(room); err != nil {
			return nil, err
		}
		member, err := addMember(app, room.Id, user.Id, "owner")
		if err != nil {
			return nil, err
		}
		invites, err := roomInvites(app, room, user.Id)
		if err != nil {
			return nil, err
		}
		achieved(app, user.Id, nil, true)
		return map[string]any{"room": roomJSON(room, cost), "membership": member.JSON(app), "invites": invites}, nil
	})
}

func join(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		typed, err := text(b["code"], "Invite code", 20)
		if err != nil {
			return nil, err
		}
		invitation, err := firstAs[Invite](app, "room_invites", "digest", security.SHA256(normalizeCode(typed)))
		if err != nil {
			return nil, badRequest("Invite is invalid or expired.")
		}
		room, err := findAs[Room](app, "party_rooms", invitation.Room())
		if err != nil {
			return nil, err
		}
		cost := odylePerCube(app)
		existing, err := membershipsWhere(app, "room = {:room} && user = {:user}", dbx.Params{"room": room.Id, "user": user.Id})
		if err != nil {
			return nil, err
		}
		// A member opening the link again, even once it expired or was used up, lands in the
		// room and uses none of its joins.
		if len(existing) > 0 {
			return map[string]any{"room": roomJSON(room, cost), "membership": existing[0].JSON(app), "alreadyMember": true}, nil
		}
		if !invitation.Open(time.Now()) {
			return nil, badRequest("Invite is invalid or expired.")
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
		member, err := addMember(app, room.Id, user.Id, invitation.Role())
		if err != nil {
			return nil, err
		}
		invitation.Set("uses", invitation.Uses()+1)
		if err := app.Save(invitation); err != nil {
			return nil, err
		}
		// Achievements: the link's maker brought a player in, and this account is in a room.
		if maker := invitation.CreatedBy(); maker != user.Id {
			achieved(app, maker, adding(map[string]int64{"invited": 1}), false)
		}
		achieved(app, user.Id, nil, true)
		return map[string]any{"room": roomJSON(room, cost), "membership": member.JSON(app)}, nil
	})
}

// readersOf lists the account's own Windows apps with an open reader session, the latest
// contact first: the session, the computer name of the PC that opened it (empty for an
// app that opened it without its device key) and its last contact. Rooms and snapshots
// carry it, so the dashboard names the PC that reads instead of asking to connect one.
// One query, and one more for the PC names when a session has a PC.
func readersOf(app core.App, userId string) ([]any, error) {
	found, err := app.FindRecordsByFilter("publisher_sessions", "user = {:user} && expiresAt > {:now}", "-lastContactAt", 10, 0, dbx.Params{"user": userId, "now": stamp(time.Now())})
	if err != nil {
		return nil, err
	}
	sessions, names, devices := views[ReaderSession](found), map[string]string{}, []string{}
	for _, s := range sessions {
		if s.Device() != "" {
			devices = append(devices, s.Device())
		}
	}
	if len(devices) > 0 {
		paired, err := app.FindRecordsByIds("desktop_devices", unique(devices))
		if err != nil {
			return nil, err
		}
		for _, d := range views[Device](paired) {
			names[d.Id] = d.Name()
		}
	}
	type reader struct{ session, name, contact string }
	list := make([]reader, len(sessions))
	for i, s := range sessions {
		list[i] = reader{s.Id, names[s.Device()], contactAt(app, s)}
	}
	sort.SliceStable(list, func(a, b int) bool { return list[a].contact > list[b].contact })
	out := make([]any, len(list))
	for i, r := range list {
		out[i] = map[string]any{"sessionId": r.session, "name": r.name, "lastContactAt": r.contact}
	}
	return out, nil
}

// rooms answers with one query for the memberships, one for their rooms and one for
// the settings, plus the account's readers (readersOf) and the rooms at a glance in three
// queries for all of them (roomsEntries); serverNow lets the dashboard correct its clock
// without a heartbeat round trip. The Windows app shows the announcement from here, as it
// fetches the rooms every 5 minutes with realtime (and every 15 seconds without), and
// learns whether packet readers are paused.
func rooms(e *core.RequestEvent) error {
	return run(e, func() error {
		rules := readSettings(e.App)
		memberships, err := membershipsWhere(e.App, "user = {:user}", dbx.Params{"user": e.Auth.Id})
		if err == nil {
			err = loadShares(e.App, memberships)
		}
		if err != nil {
			return err
		}
		readers, err := readersOf(e.App, e.Auth.Id)
		if err != nil {
			return err
		}
		byId, err := roomsByID(e.App, pluck(memberships, (*Member).Room))
		if err != nil {
			return err
		}
		next, err := nextRuns(e.App, pluck(memberships, (*Member).Room))
		if err != nil {
			return err
		}
		glance, members, err := roomsEntries(e.App, pluck(memberships, (*Member).Room))
		if err != nil {
			return err
		}
		out, at := []any{}, time.Now()
		for _, m := range memberships {
			room := byId[m.Room()]
			if room == nil {
				continue
			}
			linked, j := m.Shared(e.App), roomJSON(room, rules.OdylePerCube)
			j["role"], j["sharedCharacters"], j["sharing"], j["shareNew"] = m.Role(), linked, len(linked) > 0, m.GetBool("shareNew")
			// The room at a glance (#51): its members, the players live now and the cubes their
			// party can open now (the readiness rules, readiness.go), and its next run.
			party := partyOf(glance[room.Id], at, rules.OdylePerCube)
			j["memberCount"], j["liveCount"], j["partyCubes"], j["nextRun"] = len(members[room.Id]), len(party.Players), party.Cubes, next[room.Id]
			out = append(out, j)
		}
		return e.JSON(200, map[string]any{"odylePerCube": rules.OdylePerCube, "serverNow": now(), "announcement": announcement(rules), "readerPaused": rules.ReaderPaused, "readers": readers, "rooms": out, "clock": rules.Clock, "notifications": notificationsOf(e.Auth), "maps": rules.Maps, "classIcons": classIcons(e.App), "kept": map[string]any{"historyDays": rules.HistoryDays, "locationDays": rules.LocationDays, "pvpDays": rules.PvpDays},
			"achievements": map[string]any{"new": progressOf(e.Auth).unseen()}})
	})
}

// snapshot is a whole room in three queries: members, their accounts and the characters
// shown, instead of two lookups per member. Others see only the characters a member linked
// to this room, so only those and the viewer's own are read; members always see all of
// their own, each flagged with whether it is shared here. The announcement rides along, so
// an open dashboard room needs no separate request for it, and so do the viewer's own
// readers (readersOf). The dungeon catalog (`catalog`) gives each dungeon's cost, party size
// and category.
func snapshot(e *core.RequestEvent) error {
	return run(e, func() error {
		id := e.Request.PathValue("id")
		if _, err := membership(e.App, e.Auth.Id, id); err != nil {
			return err
		}
		rules := readSettings(e.App)
		room, err := findAs[Room](e.App, "party_rooms", id)
		if err != nil {
			return err
		}
		members, err := roomMembers(e.App, id)
		if err != nil {
			return err
		}
		userIds := pluck(members, (*Member).User)
		names, err := displayNames(e.App, userIds)
		if err != nil {
			return err
		}
		// Equipped slot-machine items (#107), shown next to each member's name.
		looks, err := looksOf(e.App, userIds)
		if err != nil {
			return err
		}
		owned, err := charactersShown(e.App, members, e.Auth.Id)
		if err != nil {
			return err
		}
		for _, list := range owned {
			sort.SliceStable(list, func(a, b int) bool { return list[a].Created() < list[b].Created() })
		}
		out := make([]any, len(members))
		for i, m := range members {
			mine, visible := m.User() == e.Auth.Id, []any{}
			for _, c := range owned[m.User()] {
				if mine || m.Shares(e.App, c.Id) {
					present(e.App, c)
					j := c.PublicExport()
					j["shared"] = m.Shares(e.App, c.Id)
					visible = append(visible, j)
				}
			}
			j := m.JSON(e.App)
			j["sharing"], j["displayName"], j["characters"] = len(m.Shared(e.App)) > 0, names[m.User()], visible
			if look := looks[m.User()]; look != nil {
				j["look"] = look
			}
			out[i] = j
		}
		// A room feature its owner turned off comes empty: no wishlist, no runs, no week.
		wishes, runs := []*wish{}, []plannedRun{}
		if room.On("wishlist") {
			if wishes, err = wishlistOf(e.App, id, members); err != nil {
				return err
			}
		}
		if room.On("runs") {
			if runs, err = runsOf(e.App, id, members); err != nil {
				return err
			}
		}
		readers, err := readersOf(e.App, e.Auth.Id)
		if err != nil {
			return err
		}
		// The party's week (#42): one line, what the shared characters spent since the reset.
		var week any
		if room.On("week") {
			if week, err = roomWeekOf(e.App, rules, members, rules.OdylePerCube, time.Now()); err != nil {
				return err
			}
		}
		return e.JSON(200, map[string]any{"room": roomJSON(room, rules.OdylePerCube), "serverNow": now(), "members": out, "board": boardOf(room), "wishlist": wishes, "runs": runs, "week": week, "catalog": rules.Dungeons, "announcement": announcement(rules), "readers": readers, "clock": rules.Clock, "remindersPaused": rules.RemindersPaused, "maintenance": maintenanceOf(rules), "classRoles": rules.ClassRoles, "maps": rules.Maps, "classIcons": classIcons(e.App)})
	})
}

// roomMembers are a room's memberships with the characters each shares there.
func roomMembers(app core.App, roomId string) ([]*Member, error) {
	members, err := membershipsWhere(app, "room = {:room}", dbx.Params{"room": roomId})
	if err == nil {
		err = loadShares(app, members)
	}
	return members, err
}

// memberUsers maps membership ids to account ids.
func memberUsers(members []*Member) map[string]string {
	users := make(map[string]string, len(members))
	for _, m := range members {
		users[m.Id] = m.User()
	}
	return users
}

func leave(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		if m.Role() == "owner" {
			return nil, badRequest("Use close to delete an owned room. Characters are retained.")
		}
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

func revoke(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
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
		return nil, nil
	})
}

// Room management by its owner: rename it, make a member a player (reporter) or a
// viewer, or hand the room over. Viewers cannot share, so a member made viewer stops
// sharing characters here. The previous owner stays as a player and can then leave.
func rename(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		name, err := text(b["name"], "Room name", 60)
		if err != nil {
			return nil, err
		}
		room.SetName(name)
		if err := app.Save(room); err != nil {
			return nil, err
		}
		return map[string]any{"room": roomJSON(room, odylePerCube(app))}, nil
	})
}

func role(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		target, err := otherMember(app, room, b.str("memberId"), user.Id, "Cannot change this member.")
		if err != nil {
			return nil, err
		}
		next, _ := b.text("role")
		if next != "reporter" && next != "officer" && next != "viewer" {
			return nil, badRequest("Choose player, officer or viewer.")
		}
		target.SetRole(next)
		if err := app.Save(target); err != nil {
			return nil, err
		}
		// A viewer shares nothing.
		if next == "viewer" {
			if err := setShared(app, target, nil); err != nil {
				return nil, err
			}
		}
		return map[string]any{"membership": target.JSON(app)}, nil
	})
}

func transfer(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
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
		target.SetRole("owner")
		if err := app.Save(target); err != nil {
			return nil, err
		}
		mine.SetRole("reporter")
		if err := app.Save(mine); err != nil {
			return nil, err
		}
		room.SetOwner(target.User())
		if err := app.Save(room); err != nil {
			return nil, err
		}
		return map[string]any{"room": roomJSON(room, odylePerCube(app))}, nil
	})
}

// handOver passes each room an account owns to its longest-standing officer, else player; a room
// without one closes. It runs as the users delete hook, inside the deleting
// transaction, for every account deletion (by its owner, a superuser or for
// inactivity).
func handOver(app core.App, userId string) error {
	owned, err := app.FindRecordsByFilter("party_rooms", "owner = {:user}", "", 0, 0, dbx.Params{"user": userId})
	if err != nil {
		return err
	}
	for _, room := range views[Room](owned) {
		found, err := app.FindRecordsByFilter("room_members", "room = {:room} && user != {:user} && role = 'officer'", "created", 1, 0, dbx.Params{"room": room.Id, "user": userId})
		if err != nil {
			return err
		}
		if len(found) == 0 {
			found, err = app.FindRecordsByFilter("room_members", "room = {:room} && user != {:user} && role = 'reporter'", "created", 1, 0, dbx.Params{"room": room.Id, "user": userId})
			if err != nil {
				return err
			}
		}
		if len(found) == 0 {
			if err := app.Delete(room); err != nil {
				return err
			}
			continue
		}
		next := viewOf[Member](found[0])
		next.SetRole("owner")
		if err := app.Save(next); err != nil {
			return err
		}
		room.SetOwner(next.User())
		if err := app.Save(room); err != nil {
			return err
		}
	}
	return nil
}
