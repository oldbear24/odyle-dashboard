package migrations

import "github.com/pocketbase/pocketbase/core"

// Accounts change their profile only through POST /api/odyle/profile, which checks the
// display name. The users collection's own update API also accepted names of only
// spaces and let an account move its lastActiveAt into the future, out of reach of the
// inactive-account clean-up. Only the backend writes users records now.
func init() {
	register("1791763218_profile_lock.js", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.UpdateRule = nil
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		self := "id = @request.auth.id"
		users.UpdateRule = &self
		return app.Save(users)
	})
}
