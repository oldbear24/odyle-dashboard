package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Readings come from game packets only: characters remember the packet adapter, and
// historical manual totals are kept but no longer count as valid.
func init() {
	register("1791763203_packet_only.js", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.TextField{}, m{"name": "parserVersion", "max": 80}))
		if err := app.Save(characters); err != nil {
			return err
		}
		// Preserve historical totals while removing manual confidence.
		old, err := app.FindRecordsByFilter("characters", `source = "manual"`, "", 0, 0)
		if err != nil {
			return err
		}
		for _, record := range old {
			record.Set("valid", false)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		return removeFields(app, "characters", "parserVersion")
	})
}
