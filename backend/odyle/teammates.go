package odyle

import (
	"strings"
	"unicode/utf8"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Party and force members (POST /api/odyle/teammates, the Windows app). The app reads the names of
// the other members of its own character's party and force from the rosters the game server sends
// that character (groups.go keeps the groups' ids) and sends them, without their party or force,
// so the armory's scout finds strong players to check: it searches for each name on the sending
// character's server, once in rankKeep, and keeps only what PLAYNC's public pages list of the
// character it finds (scout.go). The names live in server memory only until the scout searched
// for them: never with the character or the account, and the packet list shows none (monitor.go).
// An account can turn this off (users.teammatesOff, POST /api/odyle/teammates-sharing): its apps
// are told so and its names are not queued. It is on until turned off.

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
// account. It answers whether the account shares them and how many it queued: none while the
// armory is paused or the account turned this off, and none of a name the scout searched for
// lately or waits to. It keeps nothing in the database.
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
			// A one-letter name is left out: the search cannot narrow it down, so it would cost the
			// scout every search page (the armory's lookups need two letters too).
			if strings.ToLower(name) != own && utf8.RuneCountInString(name) >= 2 {
				names = append(names, scoutName{name: name, server: c.GetString("server"), region: c.GetString("region")})
			}
		}
		if !shareTeammates(e.Auth) {
			return e.JSON(200, map[string]any{"shared": false})
		}
		queued := 0
		if !readSettings(app).ArmoryPaused {
			queued = stateOf(app).scout.enqueue(e.Auth.Id, names)
		}
		return e.JSON(200, map[string]any{"shared": true, "queued": queued, "serverNow": now()})
	})
}

// shareTeammates is whether the account's apps send its party and force members' names: on
// until the account turns it off.
func shareTeammates(user *core.Record) bool { return !user.GetBool("teammatesOff") }

// teammatesSharing turns sending party and force members' names on or off for the account (POST
// /api/odyle/teammates-sharing). Its apps learn it from their session and heartbeat answers.
func teammatesSharing(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		enabled, ok := b.boolean("enabled")
		if !ok {
			return nil, badRequest("Switches must be true or false.")
		}
		account, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		account.Set("teammatesOff", !enabled)
		if err := app.Save(account); err != nil {
			return nil, err
		}
		return map[string]any{"shareTeammates": enabled}, nil
	})
}
