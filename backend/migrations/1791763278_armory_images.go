package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The armory's images become records of armory_images, kept by PocketBase's file storage like
// the characters' portraits (on the data volume, or in S3 storage while it is on): an image's
// name (PLAYNC's file name of an icon, portrait-<hash> of a portrait, class_icon_<class> of a
// class's emblem), its file and its size. Superusers browse, search and delete them under
// Collections; the dashboard loads them from /api/odyle/armory-images/<name>, so no API rules.
// The images kept before, in pb_data/armory_images or under armory_images/ in S3 storage, are
// turned into records by the backend once it serves (backend/odyle/imagestore.go).
func init() {
	register("1791763278_armory_images.go", func(app core.App) error {
		return app.Save(collection(m{"name": "armory_images", "type": "base", "fields": fields(
			m{"name": "name", "type": "text", "required": true, "max": 110, "pattern": `^[A-Za-z0-9_-]{1,100}\.(?:png|jpg|webp)$`},
			m{"name": "file", "type": "file", "required": true, "maxSelect": 1, "maxSize": 2 << 20, "mimeTypes": []string{"image/png", "image/jpeg", "image/webp"}},
			m{"name": "size", "type": "number", "onlyInt": true, "min": 0},
			m{"name": "created", "type": "autodate", "onCreate": true},
		), "indexes": []string{"CREATE UNIQUE INDEX idx_armory_images_name ON armory_images (name)"}}))
	}, func(app core.App) error {
		return deleteCollections(app, "armory_images")
	})
}
