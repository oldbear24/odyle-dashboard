package odyle

import (
	"regexp"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// In-game groups. The Windows app reads the party and the force (an alliance of parties) its
// own character is in from the rosters the game server sends that character, and sends the ids
// the game gives them (POST /api/odyle/game-group); never who else is in them. The latest pair is
// characters.gameGroup, null outside both; rooms see it with the shared character, and the room
// page puts players whose live characters share a party or a force together. A reading that
// ends clears it (invalidate), since the app cannot tell what happened to the party meanwhile.

// The game's ids, as the app sends them: eight bytes as 16 lowercase hexadecimal digits.
var groupId = regexp.MustCompile(`^[0-9a-f]{16}$`)

// acceptedGroupAdapters are the group adapters stored now: Server controls switch them off like
// reading adapters.
func acceptedGroupAdapters(app core.App) []string {
	out, disabled := []string{}, readSettings(app).Adapters.Disabled
	for _, name := range verifiedGroupAdapters {
		if !contains(disabled, name) {
			out = append(out, name)
		}
	}
	return out
}

type gameGroup struct {
	Party string `json:"party,omitempty"`
	Force string `json:"force,omitempty"`
	At    string `json:"at"`
}

// groupIdOf reads one of the ids: "" when it is left out or null.
func groupIdOf(b body, key, wrong string) (string, error) {
	v, ok := b[key]
	if !ok || v == nil {
		return "", nil
	}
	if s, ok := v.(string); ok && groupId.MatchString(s) {
		return s, nil
	}
	return "", badRequest(wrong)
}

// gameGroupOf is the character's stored group, the zero group without one.
func gameGroupOf(c *Character) gameGroup {
	var g gameGroup
	_ = c.UnmarshalJSONField("gameGroup", &g)
	return g
}

// group stores the party and force the game says a character of the account is in (POST
// /api/odyle/game-group, the Windows app). The same pair again changes nothing.
func group(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if readSettings(app).ReaderPaused {
			return nil, unavailable("Packet readers are paused by the server operators.")
		}
		if _, err := ownSession(app, user.Id, b.str("sessionId")); err != nil {
			return nil, err
		}
		c, err := ownCharacter(app, user.Id, b.str("characterId"))
		if err != nil {
			return nil, err
		}
		if adapter, _ := b.text("adapter"); !contains(acceptedGroupAdapters(app), adapter) {
			return nil, badRequest("This group adapter is not accepted.")
		}
		party, err := groupIdOf(b, "party", "A party id is 16 hexadecimal digits or null.")
		if err != nil {
			return nil, err
		}
		force, err := groupIdOf(b, "force", "A force id is 16 hexadecimal digits or null.")
		if err != nil {
			return nil, err
		}
		answer := map[string]any{"serverNow": now()}
		if was := gameGroupOf(c); was.Party == party && was.Force == force {
			return answer, nil
		}
		// Rooms and the owner hear of it with the character (realtime.go).
		if party == "" && force == "" {
			c.Set("gameGroup", nil)
		} else {
			c.Set("gameGroup", gameGroup{Party: party, Force: force, At: stamp(time.Now())})
		}
		return answer, app.Save(c)
	})
}
