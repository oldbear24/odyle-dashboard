package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// account answers the account page: profile, caps and the Windows apps (reader
// sessions) in use.
func account(e *core.RequestEvent) error {
	return run(e, func() error {
		user, err := findAs[Account](e.App, "users", e.Auth.Id)
		if err != nil {
			return err
		}
		found, err := e.App.FindRecordsByFilter("publisher_sessions", "user = {:user} && expiresAt > {:now}", "-lastContactAt", 20, 0, dbx.Params{"user": user.Id, "now": stamp(time.Now())})
		if err != nil {
			return err
		}
		sessions, reading := views[ReaderSession](found), map[string]string{}
		if len(sessions) > 0 {
			read, err := e.App.FindAllRecords("characters", dbx.In("readingSession", anys(ids(found))...))
			if err != nil {
				return err
			}
			for _, c := range views[Character](read) {
				reading[c.ReadingSession()] = c.Name()
			}
		}
		devices, err := devicesOf(e.App, user.Id, 0)
		if err != nil {
			return err
		}
		characters, err := e.App.CountRecords("characters", dbx.HashExp{"user": user.Id})
		if err != nil {
			return err
		}
		owned, err := e.App.CountRecords("party_rooms", dbx.HashExp{"owner": user.Id})
		if err != nil {
			return err
		}
		memberships, err := e.App.CountRecords("room_members", dbx.HashExp{"user": user.Id})
		if err != nil {
			return err
		}
		apps := make([]any, len(sessions))
		for i, s := range sessions {
			apps[i] = map[string]any{"sessionId": s.Id, "connectedAt": s.Created(), "lastContactAt": contactAt(e.App, s), "character": reading[s.Id], "device": s.Device(), "appVersion": s.AppVersion()}
		}
		// When the inactive-account clean-up would delete this account if it stayed away (#49).
		rules, deleteAfter := readSettings(e.App), ""
		if rules.InactiveAccountDays > 0 {
			since := user.LastActiveAt()
			if since == "" {
				since = user.Created()
			}
			if at, err := types.ParseDateTime(since); err == nil {
				deleteAfter = at.Time().Add(time.Duration(rules.InactiveAccountDays) * 24 * time.Hour).UTC().Format(isoLayout)
			}
		}
		paired := make([]any, len(devices))
		for i, d := range devices {
			paired[i] = map[string]any{"id": d.Id, "name": d.Name(), "pairedAt": d.PairedAt(), "lastSignInAt": d.LastUsedAt()}
		}
		return e.JSON(200, map[string]any{
			"account":        map[string]any{"id": user.Id, "displayName": user.DisplayName(), "email": user.Email(), "created": user.Created(), "lastActiveAt": user.LastActiveAt()},
			"notifications":  notificationsOf(user.Record),
			"membership":     user.GetString("membership"),
			"shareLocation":  user.GetBool("shareLocation"),
			"pvpStats":       user.GetBool("pvpStats"),
			"shareTeammates": shareTeammates(user.Record),
			"push":           pushState(e.App, user.Id),
			"limits":         limits,
			"usage":          map[string]any{"ownedRooms": owned, "memberships": memberships, "desktopDevices": len(devices), "characters": characters},
			"retention":      map[string]any{"inactiveAccountDays": rules.InactiveAccountDays, "deleteAfter": deleteAfter, "historyDays": rules.HistoryDays, "locationDays": rules.LocationDays, "pvpDays": rules.PvpDays},
			"paused":         map[string]any{"pairing": rules.PairingPaused, "reminders": rules.RemindersPaused},
			"latestVersion":  latestVersion(e.App),
			"calendar":       calendarState(user.Record),
			"serverNow":      now(),
			"characters":     characters,
			"apps":           apps,
			"devices":        paired,
		})
	})
}

func profile(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		record, err := findAs[Account](app, "users", user.Id)
		if err != nil {
			return nil, err
		}
		name, err := displayName(b["displayName"])
		if err != nil {
			return nil, err
		}
		record.SetDisplayName(name)
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
		user, err := findAs[Account](app, "users", e.Auth.Id)
		if err != nil {
			return err
		}
		mine := dbx.Params{"user": user.Id}
		characters, err := allAs[Character](app, "characters", "user = {:user}", mine)
		if err != nil {
			return err
		}
		memberships, err := allAs[Member](app, "room_members", "user = {:user}", mine)
		if err != nil {
			return err
		}
		rooms, err := roomsByID(app, pluck(memberships, (*Member).Room))
		if err != nil {
			return err
		}
		auths, err := app.FindAllExternalAuthsByRecord(user.Record)
		if err != nil {
			return err
		}
		signIns := make([]any, len(auths))
		for i, a := range auths {
			signIns[i] = map[string]any{"provider": a.Provider(), "providerId": a.ProviderId(), "created": a.GetString("created")}
		}
		exportedCharacters := make([]any, len(characters))
		for i, c := range characters {
			points, err := allAs[HistoryPoint](app, "character_readings", "character = {:id}", dbx.Params{"id": c.Id})
			if err != nil {
				return err
			}
			present(app, c)
			j := c.PublicExport()
			j["history"] = pluck(points, (*HistoryPoint).JSON)
			if j["locations"], err = placesOf(app, c.Id, 0, 0); err != nil {
				return err
			}
			// Every kept PvP event, with the other players' names as the game said them.
			if j["pvpEvents"], err = pvpEventsOf(app, c.Id, "", 0, 0); err != nil {
				return err
			}
			exportedCharacters[i] = j
		}
		joined := make([]any, len(memberships))
		for i, m := range memberships {
			wishes, err := allAs[Wish](app, "room_wishes", "member = {:member}", dbx.Params{"member": m.Id})
			if err != nil {
				return err
			}
			runs, err := allAs[Run](app, "room_runs", "plannedBy = {:member} || attendees ~ {:member}", dbx.Params{"member": m.Id})
			if err != nil {
				return err
			}
			planned := make([]any, len(runs))
			for j, r := range runs {
				planned[j] = map[string]any{"dungeon": r.Dungeon(), "startsAt": r.StartsAt(), "note": r.Note(), "planned": r.PlannedBy() == m.Id}
			}
			name, board := "", ""
			if room := rooms[m.Room()]; room != nil {
				name = room.Name()
				// The information board, when this account wrote it last.
				if room.GetString("boardBy") == user.Id {
					board = room.GetString("board")
				}
			}
			entry := map[string]any{"room": m.Room(), "name": name, "role": m.Role(), "joined": m.Created(), "sharedCharacters": m.Shared(app), "wishlist": pluck(wishes, (*Wish).Dungeon), "runs": planned}
			if board != "" {
				entry["board"] = board
			}
			joined[i] = entry
		}
		names := map[string]string{}
		for _, c := range characters {
			names[c.Id] = c.Name()
		}
		checklist, err := tasksOf(app, user.Id, names)
		if err != nil {
			return err
		}
		sessions, err := allAs[ReaderSession](app, "publisher_sessions", "user = {:user}", mine)
		if err != nil {
			return err
		}
		readerSessions := make([]any, len(sessions))
		for i, s := range sessions {
			readerSessions[i] = map[string]any{"id": s.Id, "connectedAt": s.Created(), "lastContactAt": contactAt(app, s), "expiresAt": s.GetString("expiresAt")}
		}
		devices, err := allAs[Device](app, "desktop_devices", "user = {:user}", mine)
		if err != nil {
			return err
		}
		paired := make([]any, len(devices))
		for i, d := range devices {
			paired[i] = map[string]any{"name": d.Name(), "pairedAt": d.PairedAt(), "lastSignInAt": d.LastUsedAt()}
		}
		// The invite links the account made that are still kept, without their codes.
		links, err := allAs[Invite](app, "room_invites", "createdBy = {:user}", mine)
		if err != nil {
			return err
		}
		linkRooms, err := roomsByID(app, pluck(links, (*Invite).Room))
		if err != nil {
			return err
		}
		inviteLinks := make([]any, len(links))
		for i, l := range links {
			j := l.JSON()
			delete(j, "id")
			j["room"] = l.Room()
			if room := linkRooms[l.Room()]; room != nil {
				j["name"] = room.Name()
			}
			inviteLinks[i] = j
		}
		return e.JSON(200, map[string]any{
			"exportedAt":        now(),
			"notifications":     notificationsOf(user.Record),
			"membership":        user.GetString("membership"),
			"pushSubscriptions": pushExport(e.App, user.Id),
			"account":           map[string]any{"id": user.Id, "displayName": user.DisplayName(), "email": user.Email(), "created": user.Created(), "lastActiveAt": user.LastActiveAt(), "signIns": signIns},
			"slotMachine":       map[string]any{"spins": user.GetInt("spins"), "collection": wardrobeOf(user.Record)},
			"achievements":      progressOf(user.Record),
			"calendarFeed":      calendarState(user.Record),
			"characters":        exportedCharacters,
			"rooms":             joined,
			"tasks":             checklist,
			"readerSessions":    readerSessions,
			"pairedWindowsApps": paired,
			"inviteLinks":       inviteLinks,
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
		// The calendar feed's address is a sign-in of its own (calendar.go): it ends too.
		record.Set("calendarDigest", "")
		record.Set("calendarSince", "")
		if err := app.Save(record); err != nil {
			return nil, err
		}
		if _, err := endSessions(app, "user = {:user}", dbx.Params{"user": user.Id}); err != nil {
			return nil, err
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
