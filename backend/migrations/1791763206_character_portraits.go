package migrations

import "github.com/pocketbase/pocketbase/core"

// The character's official AION 2 portrait, downloaded by the backend
// (odyle/portraits.go). Players cannot set it: the collection keeps no update rule and
// no route writes this field. Files are served from unguessable URLs that only the
// owner and rooms the character is shared in receive.
func init() {
	register("1791763206_character_portraits.js", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.FileField{}, m{"name": "portrait", "maxSelect": 1, "maxSize": 524288, "mimeTypes": []string{"image/jpeg", "image/png", "image/webp"}, "protected": false}))
		characters.Fields.Add(field(&core.DateField{}, m{"name": "portraitCheckedAt", "hidden": true}))
		characters.Fields.Add(field(&core.TextField{}, m{"name": "portraitHash", "max": 64, "hidden": true}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "portrait", "portraitCheckedAt", "portraitHash")
	})
}
