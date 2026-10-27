package migrations

import (
	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Sharing moves from one flag per membership to an explicit list of the member's own
// characters. Memberships that shared everything keep sharing every character they had
// at upgrade time.
func init() {
	register("1791763204_character_sharing.js", func(app core.App) error {
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		members.Fields.Add(field(&core.RelationField{}, m{"name": "sharedCharacters", "collectionId": characters.Id, "maxSelect": 500, "cascadeDelete": false}))
		if err := app.Save(members); err != nil {
			return err
		}
		sharing, err := app.FindRecordsByFilter("room_members", "sharing = true", "", 0, 0)
		if err != nil {
			return err
		}
		for _, member := range sharing {
			owned, err := app.FindRecordsByFilter("characters", "user = {:user}", "created", 0, 0, dbx.Params{"user": member.GetString("user")})
			if err != nil {
				return err
			}
			list := make([]string, len(owned))
			for i, c := range owned {
				list[i] = c.Id
			}
			member.Set("sharedCharacters", list)
			if err := app.Save(member); err != nil {
				return err
			}
		}
		members.Fields.RemoveByName("sharing")
		return app.Save(members)
	}, func(app core.App) error {
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		members.Fields.Add(field(&core.BoolField{}, m{"name": "sharing"}))
		if err := app.Save(members); err != nil {
			return err
		}
		all, err := app.FindRecordsByFilter("room_members", `id != ""`, "", 0, 0)
		if err != nil {
			return err
		}
		for _, member := range all {
			member.Set("sharing", len(member.GetStringSlice("sharedCharacters")) > 0)
			if err := app.Save(member); err != nil {
				return err
			}
		}
		members.Fields.RemoveByName("sharedCharacters")
		return app.Save(members)
	})
}
