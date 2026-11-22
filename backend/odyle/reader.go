package odyle

import (
	"regexp"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// endSession ends a reader session; the characters it read keep their values but turn stale.
// Read and written in one transaction (inside the caller's, if any): a reading saved while
// the session ends is not put back to the value read before it.
func endSession(app core.App, session *ReaderSession) error {
	return app.RunInTransaction(func(tx core.App) error {
		read, err := charactersWhere(tx, "readingSession = {:id}", dbx.Params{"id": session.Id})
		if err != nil {
			return err
		}
		for _, c := range read {
			c.SetValid(false)
			if err := tx.Save(c); err != nil {
				return err
			}
		}
		return tx.Delete(session)
	})
}

// endSessions ends the reader sessions that match the filter.
func endSessions(app core.App, filter string, params dbx.Params) (int, error) {
	found, err := list(app, "publisher_sessions", filter, params)
	if err != nil {
		return 0, err
	}
	for _, s := range views[ReaderSession](found) {
		if err := endSession(app, s); err != nil {
			return 0, err
		}
	}
	return len(found), nil
}

// A version like 0.6.0.12; anything else is left out, never refused.
var versionForm = regexp.MustCompile(`^\d{1,5}(\.\d{1,5}){1,3}$`)

func appVersion(value any) string {
	if s, ok := value.(string); ok && versionForm.MatchString(trim(s)) {
		return trim(s)
	}
	return ""
}

// Reader routes answer this to an app without a pairing of its PC: one paired before device
// keys (October 2026), whose saved connection 1.0.0 no longer accepts, or a request that does
// not come from the paired app at all. Apps take the server's own 401 for a pairing that ended
// and ask for a new connection link.
const pairAgain = "This PC's pairing is from an older Odyle and no longer works. Pair it again: copy a new connection link from the dashboard."

// pairedRequest is the PC whose app token signed the request, or a 401 for any other token
// (a browser's, or the refreshable token apps had before device keys). boundDevice has already
// signed nobody in with the token of a PC whose pairing ended.
func pairedRequest(e *core.RequestEvent) (string, error) {
	if id := requestDevice(e); id != "" {
		return id, nil
	}
	return "", unauthorized(pairAgain)
}

// session opens a reader session for a paired PC, which names itself with its device key, so
// removing the PC ends this session too. Without a key (an app paired before device keys) it is
// a 401 that tells the player to pair again, and so is a key the server no longer knows (the
// pairing ended). Apps also send their version, for the superuser dashboard's Apps page.
// Sessions open while packet readers are paused, so the app learns of the pause from the answer.
func session(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if !b.set("deviceKey") {
			return nil, unauthorized(pairAgain)
		}
		key, err := deviceKey(b)
		if err != nil {
			return nil, err
		}
		device := findDevice(app, key)
		if device == nil || device.User() != user.Id {
			return nil, unauthorized("This PC is no longer paired with an account.")
		}
		if b.set("previousSessionId") {
			previous, err := ownSession(app, user.Id, b.str("previousSessionId"))
			if err != nil {
				return nil, err
			}
			if err := endSession(app, previous); err != nil {
				return nil, err
			}
		}
		// A PC runs one Odyle at a time, so its new session replaces the ones it left open (a
		// restart, an update, a crash). Their readings are not marked stale: a restarted app
		// takes its character over within seconds, and otherwise the missing heartbeat turns
		// it stale.
		old, err := list(app, "publisher_sessions", "device = {:device}", dbx.Params{"device": device.Id})
		if err != nil {
			return nil, err
		}
		for _, s := range old {
			if err := app.Delete(s); err != nil {
				return nil, err
			}
		}
		s, err := newAs[ReaderSession](app, "publisher_sessions")
		if err != nil {
			return nil, err
		}
		s.Set("user", user.Id)
		s.Set("device", device.Id)
		s.Contacted()
		s.Set("appVersion", appVersion(b["appVersion"]))
		if err := app.Save(s); err != nil {
			return nil, err
		}
		return map[string]any{"sessionId": s.Id, "sequence": 0, "readerPaused": readSettings(app).ReaderPaused, "shareLocation": user.GetBool("shareLocation"), "pvpStats": user.GetBool("pvpStats"), "shareTeammates": shareTeammates(user)}, nil
	})
}

// character saves a character's identity before its first game reading. This route
// cannot supply energy, confidence, ownership, timestamps or a reader session. Only a
// paired PC's app saves one (pairedRequest).
func character(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if _, err := pairedRequest(e); err != nil {
			return nil, err
		}
		for key := range b {
			if key != "characterName" && key != "server" && key != "region" {
				return nil, badRequest("Only character name, server and region may be saved here.")
			}
		}
		data, err := characterIdentity(b)
		if err != nil {
			return nil, err
		}
		if data, err = currentServer(app, user.Id, data); err != nil {
			return nil, err
		}
		existing, err := sameCharacter(app, user.Id, data)
		if err != nil {
			return nil, err
		}
		if len(existing) > 0 {
			return map[string]any{"character": existing[0]}, nil
		}
		c, err := newCharacter(app, user.Id)
		if err != nil {
			return nil, err
		}
		c.SetIdentity(data)
		c.Set("confirmed", false)
		c.SetValid(false)
		if err := app.Save(c); err != nil {
			return nil, err
		}
		if err := shareNew(app, c); err != nil {
			return nil, err
		}
		return map[string]any{"character": c}, nil
	})
}

// noOdyle marks one of the account's characters as having no Odyle yet: its Windows app
// read a complete snapshot of it without the Odyle record, which the game adds at level 22
// (odyle-windows#6). A character with a verified reading has Odyle, so it stays as it is;
// the next verified reading clears the mark (Character.Read). Apps send this on its own,
// after saving the character, so a server without the action only answers 404.
func noOdyle(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		if c.Confirmed() || c.GetBool("odyleLocked") {
			return map[string]any{"character": c}, nil
		}
		c.Set("odyleLocked", true)
		if err := app.Save(c); err != nil {
			return nil, err
		}
		return map[string]any{"character": c}, nil
	})
}

// mainCharacter marks one of the account's characters as its main (main: true), clearing
// the mark of the one before, or clears it (main: false). Rooms hear of both characters
// over realtime (characterFields).
func mainCharacter(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		main, ok := b.boolean("main")
		if !ok {
			return nil, badRequest("Main must be true or false.")
		}
		if main {
			before, err := charactersWhere(app, "user = {:user} && main = true && id != {:id}", dbx.Params{"user": user.Id, "id": c.Id})
			if err != nil {
				return nil, err
			}
			for _, other := range before {
				other.Set("main", false)
				if err := app.Save(other); err != nil {
					return nil, err
				}
			}
		}
		if c.GetBool("main") != main {
			c.Set("main", main)
			if err := app.Save(c); err != nil {
				return nil, err
			}
		}
		return map[string]any{"character": c}, nil
	})
}

// sameCharacter finds the account's character of an identity. On a server the book names
// (servers.go) it is the character with that server id and name, whatever name the server had
// when it was saved, so a renamed server keeps its characters; the next save names it as the
// identity does. Otherwise it is the character saved under that region, server name and name
// while the server had no id, which takes the id at its next save once the book names it.
func sameCharacter(app core.App, userId string, data identity) ([]*Character, error) {
	if id := serversOf(app).id(data.region, data.server); id > 0 {
		found, err := charactersWhere(app, "user = {:user} && serverId = {:server} && characterName = {:name}", dbx.Params{"user": userId, "server": id, "name": data.characterName})
		if err != nil || len(found) > 0 {
			return found, err
		}
	}
	return charactersWhere(app, "user = {:user} && serverId = 0 && region = {:region} && server = {:server} && characterName = {:name}", dbx.Params{"user": userId, "region": data.region, "server": data.server, "name": data.characterName})
}

// report saves a reading of the Windows app. While superusers pause packet readers
// (Server controls) every reading is refused with 503, and apps stop capturing until it
// is off.
func report(e *core.RequestEvent) error {
	if ok, wait := allowReading(e.App, e.Auth.Id, time.Now()); !ok {
		return tooManyReadings(e, wait)
	}
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if readSettings(app).ReaderPaused {
			return nil, unavailable("Packet readers are paused by the server operators.")
		}
		session, err := ownSession(app, user.Id, b.str("sessionId"))
		if err != nil {
			return nil, err
		}
		// Only the paired PC that opened the session sends its readings: a session opened
		// before device keys, or a request with another token, is a 401. The app of that PC
		// signs in again with its device key and repeats the reading once.
		if device, err := pairedRequest(e); err != nil || session.Device() != device {
			return nil, unauthorized(pairAgain)
		}
		// Only a reading from the account's own open session names its adapter on the
		// monitor and in the operator's alerts (seenAdapters).
		e.Set(ownReadingKey, true)
		data, err := validReading(b, session.Id, session.Sequence(), acceptedAdapters(app))
		if err != nil {
			return nil, err
		}
		var character *Character
		created := false
		if b.set("characterId") {
			if character, err = ownCharacter(app, user.Id, b.str("characterId")); err != nil {
				return nil, err
			}
		} else {
			if data.identity, err = currentServer(app, user.Id, data.identity); err != nil {
				return nil, err
			}
			existing, err := sameCharacter(app, user.Id, data.identity)
			if err != nil {
				return nil, err
			}
			if len(existing) > 0 {
				character = existing[0]
			} else if character, err = newCharacter(app, user.Id); err != nil {
				return nil, err
			} else {
				created = true
			}
			// Only a lookup without characterId may name a character; an existing one
			// keeps the identity the game gave it.
			character.SetIdentity(data.identity)
		}
		// A login reading checks the Odyle clock against the reading before it.
		before, prevAt := viewOf[Character](character.Original()), character.GetDateTime("lastReadingAt").Time()
		// Every change (the first reading included) is also kept in the character's history,
		// with the adapter that decoded it.
		changed := character.Read(data, session.Id)
		checkClock(app, before, prevAt, data, time.Now())
		if err := app.Save(character); err != nil {
			return nil, err
		}
		// A character the reader saw first reaches the rooms that share new characters.
		if created {
			if err := shareNew(app, character); err != nil {
				return nil, err
			}
		}
		if changed {
			point, err := newRecord(app, "character_readings")
			if err != nil {
				return nil, err
			}
			point.Set("character", character.Id)
			point.Set("value", data.value)
			point.Set("adapter", data.parserVersion)
			point.Set("parts", data.partsValue())
			point.Set("kind", data.kind)
			point.Set("delta", data.delta)
			if err := app.Save(point); err != nil {
				return nil, err
			}
		}
		session.Set("sequence", data.sequence)
		session.Contacted()
		if err := app.Save(session); err != nil {
			return nil, err
		}
		// The slot machine (#107): the first accepted reading of the day earns its account a spin.
		if err := grantDailySpin(app, character, time.Now()); err != nil {
			return nil, err
		}
		// Achievements (achievements.go): the day the reader read, a spend or an item, a first reading.
		if changed {
			countReading(app, character.User(), data.kind, data.delta, before.Value(), data.value, !before.Confirmed(), time.Now())
		} else {
			countReading(app, character.User(), "", 0, 0, 0, false, time.Now())
		}
		// Rooms and the owner hear of the character from its record hooks (realtime.go).
		return map[string]any{"character": character, "serverNow": now()}, nil
	})
}

func sharing(e *core.RequestEvent) error {
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
		// Sharing is per character: one (characterId), or several of the account's at once
		// (characterIds, the room page's Add all).
		targets, err := sharedTargets(app, user.Id, b)
		if err != nil {
			return nil, err
		}
		next := []string{}
		for _, id := range m.Shared(app) {
			if !slices.Contains(targets, id) {
				next = append(next, id)
			}
		}
		if enabled {
			next = append(next, targets...)
		}
		if err := setShared(app, m, next); err != nil {
			return nil, err
		}
		// In the order kept: one shared already stays where it was.
		next = m.Shared(app)
		*affected = append(*affected, m.Room())
		if enabled {
			achieved(app, user.Id, nil, true)
		}
		return map[string]any{"sharedCharacters": next}, nil
	})
}

// heartbeat is presence only: the session is in contact and the character it reads is
// seen. Both are kept in memory and written every ten seconds (presence.go); the
// character's rooms and its owner hear of it over realtime, without a snapshot. The
// answer tells the app whether packet readers are paused; heartbeats work either way,
// but while they are paused a heartbeat no longer keeps a reading live, so the
// readings of apps that keep capturing turn stale.
func heartbeat(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		if b.set("sessionId") {
			session, err := ownSession(e.App, e.Auth.Id, b.str("sessionId"))
			if err != nil {
				return err
			}
			var read *Character
			if b.set("characterId") {
				c, err := ownCharacter(e.App, e.Auth.Id, b.str("characterId"))
				if err != nil {
					return err
				}
				if c.ReadingSession() == session.Id && !readSettings(e.App).ReaderPaused {
					read = c
				}
			}
			beat(e.App, session, read, time.Now())
			noteReader(e.App, session.Id, b, time.Now())
		}
		return e.JSON(200, map[string]any{"serverNow": now(), "readerPaused": readSettings(e.App).ReaderPaused, "shareLocation": e.Auth.GetBool("shareLocation"), "pvpStats": e.Auth.GetBool("pvpStats"), "shareTeammates": shareTeammates(e.Auth)})
	})
}

func invalidate(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		if b.set("sessionId") && c.ReadingSession() != b.str("sessionId") {
			return nil, nil
		}
		c.SetValid(false)
		// What the party did while nothing was read is unknown (groups.go).
		c.Set("gameGroup", nil)
		return nil, app.Save(c)
	})
}

// sharedTargets are the characters a sharing request names: characterId, or characterIds, a
// list of up to 50 of the account's own characters. One of them is required; a character of
// another account, or one that no longer exists, refuses the whole request.
func sharedTargets(app core.App, userId string, b body) ([]string, error) {
	if b.set("characterId") {
		c, err := ownCharacter(app, userId, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		return []string{c.Id}, nil
	}
	listed, ok := b["characterIds"].([]any)
	if !ok || len(listed) == 0 || len(listed) > 50 {
		return nil, badRequest("Choose the characters to share.")
	}
	targets := []string{}
	for _, raw := range listed {
		id, _ := raw.(string)
		c, err := ownCharacter(app, userId, id)
		if err != nil {
			return nil, err
		}
		if !slices.Contains(targets, c.Id) {
			targets = append(targets, c.Id)
		}
	}
	return targets, nil
}
