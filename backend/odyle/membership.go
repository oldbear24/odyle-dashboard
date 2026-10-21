package odyle

import (
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The membership answer (#68), about the game's paid membership, not room memberships: whether
// the player's game account has it, as the player says under Account & data ("yes", "no", or ""
// while not sure). A new account starts at "no", the common case, so its clock and cap alerts
// count with the smaller cap from the first reading. It settles the natural pool's cap the Odyle
// clock uses: the largest of the rules' caps with it, the smallest without, and the inference
// from the readings (capsFor) while open. Each of the account's characters carries that cap as
// answeredCap, so rooms, realtime news and the Windows app get it with the character, never
// the answer itself. Readings stay as read; a character
// whose readings went above its answered cap is shown with a hint by the clients.

var membershipAnswers = []string{"", "yes", "no"}

// answeredCap is the cap an answer settles under the rules' caps, or 0 while it is open.
func answeredCap(membership string, caps []int64) int64 {
	if len(caps) == 0 {
		return 0
	}
	switch membership {
	case "yes":
		return caps[len(caps)-1]
	case "no":
		return caps[0]
	}
	return 0
}

// membershipAnswer saves the account's answer (POST /api/odyle/membership) and the cap it gives each
// of its characters; their rooms hear of it like any character change.
func membershipAnswer(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		answer, ok := b.text("membership")
		if !ok || !contains(membershipAnswers, answer) {
			return nil, errors.New("Answer yes, no, or leave the membership open.")
		}
		record, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		record.Set("membership", answer)
		if err := app.Save(record); err != nil {
			return nil, err
		}
		limit := answeredCap(answer, readSettings(app).Clock.Caps)
		characters, err := app.FindAllRecords("characters", dbx.HashExp{"user": user.Id})
		if err != nil {
			return nil, err
		}
		for _, c := range characters {
			if c.GetInt64("answeredCap") != limit {
				c.Set("answeredCap", limit)
				if err := app.Save(c); err != nil {
					return nil, err
				}
			}
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return map[string]any{"membership": answer}, nil
	})
}

// watchMembership starts a new account at "no", and gives a newly saved character the cap its
// account's answer settles.
func watchMembership(app core.App) {
	app.OnRecordCreate("users").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("membership") == "" {
			e.Record.Set("membership", "no")
		}
		return e.Next()
	})
	app.OnRecordCreate("characters").BindFunc(func(e *core.RecordEvent) error {
		if user, err := e.App.FindRecordById("users", e.Record.GetString("user")); err == nil {
			e.Record.Set("answeredCap", answeredCap(user.GetString("membership"), readSettings(e.App).Clock.Caps))
		}
		return e.Next()
	})
}

// settleCaps gives every character the cap its account's answer settles under new rules, after
// superusers changed the clock's caps.
func settleCaps(app core.App, caps []int64) error {
	if len(caps) == 0 {
		return nil
	}
	_, err := app.DB().NewQuery("UPDATE characters SET answeredCap = CASE (SELECT membership FROM users WHERE users.id = characters.user) WHEN 'yes' THEN {:most} WHEN 'no' THEN {:least} ELSE 0 END").
		Bind(dbx.Params{"most": caps[len(caps)-1], "least": caps[0]}).Execute()
	return err
}
