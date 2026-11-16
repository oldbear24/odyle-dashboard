package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Lookups that read a whole table without an index: the calendar feed finds its account by
// the token's digest at every poll, and the data export, the achievements and deleting an
// account find the rooms an account owns and the invite links it made. The digest index
// takes the accounts without a feed (an empty digest) too: SQLite uses an index limited to
// non-empty digests only for a query that names a literal digest.
var ownerIndexes = []struct{ collection, name, column string }{
	{"users", "idx_users_calendar", "calendarDigest"},
	{"party_rooms", "idx_party_rooms_owner", "owner"},
	{"room_invites", "idx_room_invites_creator", "createdBy"},
}

func init() {
	register("1791763273_lookup_indexes.go", func(app core.App) error {
		for _, index := range ownerIndexes {
			c, err := app.FindCollectionByNameOrId(index.collection)
			if err != nil {
				return err
			}
			c.AddIndex(index.name, false, "`"+index.column+"`", "")
			if err := app.Save(c); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		for _, index := range ownerIndexes {
			c, err := app.FindCollectionByNameOrId(index.collection)
			if err != nil {
				return err
			}
			c.RemoveIndex(index.name)
			if err := app.Save(c); err != nil {
				return err
			}
		}
		return nil
	})
}
