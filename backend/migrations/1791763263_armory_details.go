package migrations

import "github.com/pocketbase/pocketbase/core"

// The armory keeps everything PLAYNC's character pages list (backend/odyle/armory.go): each
// item's details, the skills, titles, skins and the Daevanion boards' nodes. A full profile
// is some 100 KB, so armory_profiles.profile takes up to 1 MB. Its images are files in
// pb_data/armory_images (armoryimages.go), not records.
func init() {
	size := func(maxSize int64) func(app core.App) error {
		return func(app core.App) error {
			profiles, err := app.FindCollectionByNameOrId("armory_profiles")
			if err != nil {
				return err
			}
			if f, ok := profiles.Fields.GetByName("profile").(*core.JSONField); ok {
				f.MaxSize = maxSize
			}
			return app.Save(profiles)
		}
	}
	register("1791763263_armory_details.go", size(1_000_000), size(100_000))
}
