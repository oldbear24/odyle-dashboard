package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The dashboard never shows PocketBase's default account avatar, yet the owner update
// rule let every account upload one (5 MB, rewritten at will). Remove the field so the
// display name is the only profile data an account can write.
func init() {
	register("1791763208_users_avatar.js", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if users.Fields.GetByName("avatar") == nil {
			return nil
		}
		users.Fields.RemoveByName("avatar")
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.FileField{}, m{"name": "avatar", "maxSelect": 1, "maxSize": 0, "mimeTypes": []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"}}))
		return app.Save(users)
	})
}
