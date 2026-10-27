package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Class and level from PLAYNC (backend/odyle/portraits.go, #25): the official character search the
// portrait job already asks lists each character's official id, level and class id (pcId), and
// characters keep them with the search region and server id that find its armory profile. The
// class's name is learned from PLAYNC's own character pages as the armory reads them (game_classes,
// pcId → name), so no request is added; until a class id was seen there, its name stays empty.
var knownClasses = map[int]string{
	5: "Gladiator", 6: "Gladiator", 7: "Gladiator", 8: "Gladiator",
	9: "Templar", 10: "Templar", 11: "Templar", 12: "Templar",
	13: "Ranger", 14: "Ranger", 16: "Ranger",
	17: "Assassin", 18: "Assassin", 19: "Assassin", 20: "Assassin",
	21: "Spiritmaster", 22: "Spiritmaster", 23: "Spiritmaster", 24: "Spiritmaster",
	26: "Sorcerer", 27: "Sorcerer", 28: "Sorcerer",
	29: "Cleric", 30: "Cleric", 31: "Cleric", 32: "Cleric",
	33: "Chanter", 34: "Chanter", 35: "Chanter", 36: "Chanter",
}

func init() {
	register("1791763241_class_level.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(
			field(&core.TextField{}, m{"name": "officialId", "max": 100}),
			field(&core.TextField{}, m{"name": "officialRegion", "max": 5}),
			field(&core.NumberField{}, m{"name": "officialServerId", "min": 0, "max": 9999, "onlyInt": true}),
			field(&core.NumberField{}, m{"name": "level", "min": 0, "max": 1000, "onlyInt": true}),
			field(&core.NumberField{}, m{"name": "classId", "min": 0, "max": 100000, "onlyInt": true}),
			field(&core.TextField{}, m{"name": "className", "max": 40}),
		)
		if err := app.Save(characters); err != nil {
			return err
		}
		classes := collection(m{"name": "game_classes", "type": "base", "fields": fields(
			m{"name": "pcId", "type": "number", "required": true, "onlyInt": true, "min": 1, "max": 100000},
			m{"name": "name", "type": "text", "required": true, "max": 40},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_game_classes_pc ON game_classes (pcId)"}})
		if err := app.Save(classes); err != nil {
			return err
		}
		// The class ids PLAYNC's Global character pages named on 2026-10-16 (four per class, one per
		// race and gender); ids not seen yet are learned the same way when the armory reads one.
		for pcId, name := range knownClasses {
			record := core.NewRecord(classes)
			record.Set("pcId", pcId)
			record.Set("name", name)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		if err := deleteCollections(app, "game_classes"); err != nil {
			return err
		}
		return removeFields(app, "characters", "officialId", "officialRegion", "officialServerId", "level", "classId", "className")
	})
}
