package migrations

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
)

// The dungeon catalog lists entries instead of names: each dungeon has its own Odyle cost
// per cube (0: the server-wide Odyle per cube), party size (0 when not set), category and
// whether its cost is unconfirmed. Saved names become entries with nothing else set, so
// rooms keep counting them at Odyle per cube; the field grows to hold 200 entries.
func init() {
	register("1791763229_catalog_entries.go", func(app core.App) error {
		return convertCatalog(app, 200000, func(item any) any {
			if name, ok := item.(string); ok {
				return m{"name": name, "cost": 0, "partySize": 0, "category": "", "unconfirmed": false}
			}
			return item
		})
	}, func(app core.App) error {
		return convertCatalog(app, 20000, func(item any) any {
			if entry, ok := item.(map[string]any); ok {
				return entry["name"]
			}
			return item
		})
	})
}

func convertCatalog(app core.App, maxSize int64, convert func(item any) any) error {
	settings, err := app.FindCollectionByNameOrId("odyle_settings")
	if err != nil {
		return err
	}
	if f, ok := settings.Fields.GetByName("dungeons").(*core.JSONField); ok && maxSize > f.MaxSize {
		f.MaxSize = maxSize
		if err := app.Save(settings); err != nil {
			return err
		}
	}
	records, err := app.FindAllRecords("odyle_settings")
	if err != nil {
		return err
	}
	for _, r := range records {
		var items []any
		if json.Unmarshal([]byte(r.GetString("dungeons")), &items) != nil {
			continue
		}
		converted := make([]any, len(items))
		for i, item := range items {
			converted[i] = convert(item)
		}
		r.Set("dungeons", converted)
		if err := app.Save(r); err != nil {
			return err
		}
	}
	if f, ok := settings.Fields.GetByName("dungeons").(*core.JSONField); ok && maxSize < f.MaxSize {
		f.MaxSize = maxSize
		return app.Save(settings)
	}
	return nil
}
