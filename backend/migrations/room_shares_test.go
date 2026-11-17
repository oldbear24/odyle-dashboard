package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The characters a membership shares move from its list into room_shares in their order, and
// back; an id of a character that is gone or another account's stays behind.
func TestSharesMoveIntoRoomShares(t *testing.T) {
	app := newMigratedApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	account := func(name string) *core.Record {
		u := core.NewRecord(users)
		u.SetEmail(name + "@test.invalid")
		u.SetPassword("password-for-tests-only")
		u.Set("displayName", name)
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
		return u
	}
	owner, other := account("Owner"), account("Other")
	if err := roomSharesDown(app); err != nil {
		t.Fatal(err)
	}
	save := func(name string, values map[string]any) *core.Record {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		for k, v := range values {
			r.Set(k, v)
		}
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	room := save("party_rooms", map[string]any{"owner": owner.Id, "name": "Room", "cost": 40})
	a := save("characters", map[string]any{"user": owner.Id, "characterName": "A", "server": "Lumiel", "region": "GLOBAL_EU"})
	b := save("characters", map[string]any{"user": owner.Id, "characterName": "B", "server": "Lumiel", "region": "GLOBAL_EU"})
	foreign := save("characters", map[string]any{"user": other.Id, "characterName": "C", "server": "Lumiel", "region": "GLOBAL_EU"})
	member := save("room_members", map[string]any{"room": room.Id, "user": owner.Id, "role": "owner", "sharedCharacters": []string{b.Id, a.Id, foreign.Id}})
	save("room_members", map[string]any{"room": room.Id, "user": other.Id, "role": "viewer"})

	if err := roomSharesUp(app); err != nil {
		t.Fatal(err)
	}
	rows := []struct {
		Member    string `db:"member"`
		Room      string `db:"room"`
		Character string `db:"character"`
	}{}
	if err := app.DB().NewQuery("SELECT member, room, character FROM room_shares ORDER BY rowid").All(&rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Character != b.Id || rows[1].Character != a.Id || rows[0].Member != member.Id || rows[0].Room != room.Id {
		t.Fatalf("room_shares holds %+v", rows)
	}
	if err := roomSharesDown(app); err != nil {
		t.Fatal(err)
	}
	back, err := app.FindRecordById("room_members", member.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := back.GetStringSlice("sharedCharacters"); len(got) != 2 || got[0] != b.Id || got[1] != a.Id {
		t.Fatalf("the membership came back sharing %v", got)
	}
	if err := roomSharesUp(app); err != nil {
		t.Fatal(err)
	}
}
