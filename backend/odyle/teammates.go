package odyle

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Party and force members (POST /api/odyle/teammates, the Windows app). The app reads the names of
// the other members of its own character's party and force from the rosters the game server sends
// that character (groups.go keeps the groups' ids) and sends them, without their party or force,
// so the armory's scout finds strong players to check: it searches for each name on the sending
// character's server, once in rankKeep, and keeps only what PLAYNC's public pages list of the
// character it finds (scout.go). The names live in server memory only until the scout searched
// for them: never with the character or the account, and the packet list shows none (monitor.go).

// teammatesLimit is how many names one request carries at most: a force's other members.
const teammatesLimit = 48

// acceptedTeammateAdapters are the teammate adapters accepted now: Server controls switch them off
// like reading adapters.
func acceptedTeammateAdapters(app core.App) []string {
	out, disabled := []string{}, readSettings(app).Adapters.Disabled
	for _, name := range verifiedTeammateAdapters {
		if !contains(disabled, name) {
			out = append(out, name)
		}
	}
	return out
}

// teammates hands the scout the names of the players in a party or force with a character of the
// account. It answers how many it queued: none while the armory is paused, and none of a name the
// scout searched for lately or waits to. It keeps nothing in the database.
func teammates(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		app := e.App
		if readSettings(app).ReaderPaused {
			return unavailable("Packet readers are paused by the server operators.")
		}
		if _, err := ownSession(app, e.Auth.Id, b.str("sessionId")); err != nil {
			return err
		}
		c, err := ownCharacter(app, e.Auth.Id, b.str("characterId"))
		if err != nil {
			return err
		}
		if adapter, _ := b.text("adapter"); !contains(acceptedTeammateAdapters(app), adapter) {
			return badRequest("This teammate adapter is not accepted.")
		}
		raw, ok := b["names"].([]any)
		if !ok || len(raw) == 0 || len(raw) > teammatesLimit {
			return badRequest("Teammates are 1 to 48 players' names.")
		}
		own, names := strings.ToLower(c.GetString("characterName")), []scoutName{}
		for _, v := range raw {
			name, ok := v.(string)
			if !ok || !pvpName.MatchString(name) {
				return badRequest("A player's name is 1 to 40 letters or digits.")
			}
			// The members are on the character's server, as far as Odyle knows: the rosters name none.
			if strings.ToLower(name) != own {
				names = append(names, scoutName{name: name, server: c.GetString("server"), region: c.GetString("region")})
			}
		}
		queued := 0
		if !readSettings(app).ArmoryPaused {
			queued = stateOf(app).scout.enqueue(names)
		}
		return e.JSON(200, map[string]any{"queued": queued, "serverNow": now()})
	})
}
