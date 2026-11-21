package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Indexes for two cascades (#184): deleting a character looks up its tasks by user_tasks.character,
// and deleting a room its Discord posts by discord_posts.room. Both read the whole table before;
// idx_user_tasks_scope leads with user and idx_discord_posts_run with run.
func init() {
	register("1791763284_cascade_indexes.go", func(app core.App) error {
		return cascadeIndexes(app, true)
	}, func(app core.App) error {
		return cascadeIndexes(app, false)
	})
}

func cascadeIndexes(app core.App, add bool) error {
	for _, index := range []struct{ collection, name, column string }{
		{"user_tasks", "idx_user_tasks_character", "character"},
		{"discord_posts", "idx_discord_posts_room", "room"},
	} {
		c, err := app.FindCollectionByNameOrId(index.collection)
		if err != nil {
			return err
		}
		if add {
			c.AddIndex(index.name, false, index.column, "")
		} else {
			c.RemoveIndex(index.name)
		}
		if err := app.Save(c); err != nil {
			return err
		}
	}
	return nil
}
