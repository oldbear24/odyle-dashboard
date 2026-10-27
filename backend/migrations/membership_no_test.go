package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Accounts that never answered start without the membership, unless their readings already
// showed it; an answer given stays.
func TestUnansweredMembershipBecomesNo(t *testing.T) {
	app := newMigratedApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		t.Fatal(err)
	}
	account := func(name, membership string, naturalMax int64) (*core.Record, *core.Record) {
		t.Helper()
		user := core.NewRecord(users)
		user.SetEmail(name + "@test.invalid")
		user.SetPassword("password-for-tests-only")
		user.Set("displayName", name)
		user.Set("membership", membership)
		if err := app.Save(user); err != nil {
			t.Fatal(err)
		}
		c := core.NewRecord(characters)
		c.Set("user", user.Id)
		c.Set("characterName", name)
		c.Set("server", "Lumiel")
		c.Set("region", "GLOBAL_EU")
		c.Set("naturalMax", naturalMax)
		if err := app.Save(c); err != nil {
			t.Fatal(err)
		}
		return user, c
	}
	open, openChar := account("Open", "", 500)
	proven, provenChar := account("Proven", "", 700)
	member, memberChar := account("Member", "yes", 300)
	if err := membershipNo(app); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		user, character *core.Record
		membership      string
		cap             int64
	}{{open, openChar, "no", 560}, {proven, provenChar, "yes", 840}, {member, memberChar, "yes", 840}} {
		user, _ := app.FindRecordById("users", check.user.Id)
		c, _ := app.FindRecordById("characters", check.character.Id)
		if user.GetString("membership") != check.membership || c.GetInt64("answeredCap") != check.cap {
			t.Fatalf("%s: %q, cap %d", check.user.GetString("displayName"), user.GetString("membership"), c.GetInt64("answeredCap"))
		}
	}
}
