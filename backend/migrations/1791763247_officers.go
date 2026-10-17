package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// Officers (#43): a fourth membership role the owner grants under Room settings. Officers run the
// room with its owner (invite links, every planned run, clearing a dungeon off everyone's wishlist
// and Discord reminders) and play like players; installed Windows apps treat every role but viewer
// as a player, so they count officers as before. Going back makes officers players again.
func init() {
	register("1791763247_officers.go", func(app core.App) error {
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		role, _ := members.Fields.GetByName("role").(*core.SelectField)
		if role == nil || slices.Contains(role.Values, "officer") {
			return nil
		}
		role.Values = append(role.Values, "officer")
		return app.Save(members)
	}, func(app core.App) error {
		if _, err := app.DB().NewQuery("UPDATE room_members SET role = 'reporter' WHERE role = 'officer'").Execute(); err != nil {
			return err
		}
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		if role, _ := members.Fields.GetByName("role").(*core.SelectField); role != nil {
			role.Values = slices.DeleteFunc(role.Values, func(v string) bool { return v == "officer" })
		}
		return app.Save(members)
	})
}
