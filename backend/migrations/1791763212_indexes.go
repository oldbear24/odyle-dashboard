package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Lookups the backend runs on every reading, page load and job run: an account's
// memberships and reader sessions, the characters a session read, portraits that are
// due and expired codes. Unique indexes from earlier migrations lead with another
// column, so none of these could use them.
var lookupIndexes = []struct {
	collection string
	indexes    [][2]string
}{
	{"room_members", [][2]string{{"idx_room_members_user", "user"}}},
	{"characters", [][2]string{{"idx_characters_session", "readingSession"}, {"idx_characters_portrait", "portraitCheckedAt"}}},
	{"publisher_sessions", [][2]string{{"idx_publisher_sessions_user", "user"}, {"idx_publisher_sessions_expiry", "expiresAt"}}},
	{"room_invites", [][2]string{{"idx_room_invites_room", "room"}, {"idx_room_invites_expiry", "expiresAt"}}},
	{"desktop_codes", [][2]string{{"idx_desktop_codes_user", "user"}, {"idx_desktop_codes_expiry", "expiresAt"}}},
}

func init() {
	register("1791763212_indexes.js", func(app core.App) error {
		for _, entry := range lookupIndexes {
			c, err := app.FindCollectionByNameOrId(entry.collection)
			if err != nil {
				return err
			}
			for _, index := range entry.indexes {
				c.AddIndex(index[0], false, "`"+index[1]+"`", "")
			}
			if err := app.Save(c); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		for _, entry := range lookupIndexes {
			c, err := app.FindCollectionByNameOrId(entry.collection)
			if err != nil {
				return err
			}
			for _, index := range entry.indexes {
				c.RemoveIndex(index[0])
			}
			if err := app.Save(c); err != nil {
				return err
			}
		}
		return nil
	})
}
