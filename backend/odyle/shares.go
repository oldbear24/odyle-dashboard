package odyle

import (
	"slices"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Sharing (room_shares): a member shares some of their own characters in a room, one row a
// character and room with the membership and its room. Only the backend writes them: the
// sharing route, a character saved with shareNew on (shareNew) and a member made a viewer
// (role). A share goes with its membership, its room or its character. Rooms and the member's
// account hear of each share that comes or goes (watchShares).

// loadShares reads the characters the memberships share that are not read yet, in one query,
// in the order they were shared.
func loadShares(app core.App, members []*Member) error {
	byId, ids := map[string]*Member{}, []any{}
	for _, m := range members {
		if m != nil && m.shared == nil && byId[m.Id] == nil {
			byId[m.Id] = m
			ids = append(ids, m.Id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows := []struct {
		Member    string `db:"member"`
		Character string `db:"character"`
	}{}
	if err := app.DB().Select("member", "character").From("room_shares").Where(dbx.In("member", ids...)).OrderBy("rowid").All(&rows); err != nil {
		return err
	}
	read := map[string][]string{}
	for _, r := range rows {
		read[r.Member] = append(read[r.Member], r.Character)
	}
	for id, m := range byId {
		shared := read[id]
		if shared == nil {
			shared = []string{}
		}
		m.shared = &shared
	}
	return nil
}

// shareIn shares the characters in the membership's room, after the ones it shares; one it
// shares already stays where it is. The caller checks that they are the member's own.
func shareIn(app core.App, m *Member, characters ...string) error {
	if err := loadShares(app, []*Member{m}); err != nil {
		return err
	}
	collection, err := app.FindCollectionByNameOrId("room_shares")
	if err != nil {
		return err
	}
	shared := slices.Clone(*m.shared)
	for _, c := range characters {
		if contains(shared, c) {
			continue
		}
		r := core.NewRecord(collection)
		r.Set("member", m.Id)
		r.Set("room", m.Room())
		r.Set("character", c)
		if err := app.Save(r); err != nil {
			return err
		}
		shared = append(shared, c)
	}
	m.shared = &shared
	return nil
}

// setShared makes the characters the membership shares exactly these: the others stop, and the
// new ones come after those it keeps.
func setShared(app core.App, m *Member, characters []string) error {
	if err := loadShares(app, []*Member{m}); err != nil {
		return err
	}
	stopped := []any{}
	for _, c := range *m.shared {
		if !contains(characters, c) {
			stopped = append(stopped, c)
		}
	}
	if len(stopped) > 0 {
		found, err := app.FindAllRecords("room_shares", dbx.HashExp{"member": m.Id}, dbx.In("character", stopped...))
		if err != nil {
			return err
		}
		for _, r := range found {
			if err := app.Delete(r); err != nil {
				return err
			}
		}
		kept := []string{}
		for _, c := range *m.shared {
			if contains(characters, c) {
				kept = append(kept, c)
			}
		}
		m.shared = &kept
	}
	return shareIn(app, m, characters...)
}

// watchShares tells the room to fetch its snapshot again when a share comes or goes, and the
// member's account to fetch its own data; a membership deleted with its shares tells them itself.
func watchShares(app core.App) {
	shareChanged := func(e *core.RecordEvent) error {
		notify(e.App, []string{e.Record.GetString("room")})
		if m, err := e.App.FindRecordById("room_members", e.Record.GetString("member")); err == nil {
			notifyUsers(e.App, m.GetString("user"))
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("room_shares").BindFunc(shareChanged)
	app.OnRecordAfterDeleteSuccess("room_shares").BindFunc(shareChanged)
}
