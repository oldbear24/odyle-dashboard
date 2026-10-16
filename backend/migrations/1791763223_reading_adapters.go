package migrations

import "github.com/pocketbase/pocketbase/core"

// Each history point records the packet adapter that decoded it (the reading's
// parserVersion), so points of a decoder later found to misread can be told apart.
// Points saved before carry their character's latest adapter: until now only
// global-reference-v1 and names superusers added under Server controls were accepted.
func init() {
	register("1791763223_reading_adapters.go", func(app core.App) error {
		readings, err := app.FindCollectionByNameOrId("character_readings")
		if err != nil {
			return err
		}
		readings.Fields.Add(field(&core.TextField{}, m{"name": "adapter", "max": 80}))
		if err := app.Save(readings); err != nil {
			return err
		}
		// The integration tests start an older database without the characters' adapter
		// (1791763203_packet_only applied later); it has none to copy.
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil || characters.Fields.GetByName("parserVersion") == nil {
			return err
		}
		_, err = app.DB().NewQuery("UPDATE character_readings SET adapter = COALESCE((SELECT parserVersion FROM characters WHERE characters.id = character_readings.character), '')").Execute()
		return err
	}, func(app core.App) error {
		return removeFields(app, "character_readings", "adapter")
	})
}
