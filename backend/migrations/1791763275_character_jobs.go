package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The background jobs' bookkeeping of a character moves off the character into character_jobs,
// one row a character: the portrait job's last lookup, the misses of the official search in
// a row and the portrait's digest (backend/odyle/portraits.go), the cap alert last told
// (capalerts.go) and the day the character last earned a spin (slots.go). The fields were
// hidden from every answer, and each job wrote the whole character, which also ran its record
// hooks. No API rules: only the backend reads and writes them. A character's row goes with it.
var jobFields = []string{"portraitCheckedAt", "portraitHash", "portraitMisses", "capAlert", "spinDay"}

func init() {
	register("1791763275_character_jobs.go", characterJobsUp, characterJobsDown)
}

func characterJobsUp(app core.App) error {
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		return err
	}
	jobs := collection(m{"name": "character_jobs", "type": "base", "fields": fields(
		m{"name": "character", "type": "relation", "collectionId": characters.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
		m{"name": "portraitCheckedAt", "type": "date"},
		m{"name": "portraitHash", "type": "text", "max": 64},
		m{"name": "portraitMisses", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "capAlert", "type": "text", "max": 10},
		m{"name": "spinDay", "type": "text", "max": 10},
	), "indexes": []string{
		"CREATE UNIQUE INDEX idx_character_jobs_character ON character_jobs (character)",
		"CREATE INDEX idx_character_jobs_portrait ON character_jobs (portraitCheckedAt)",
	}})
	if err := app.Save(jobs); err != nil {
		return err
	}
	if _, err := app.DB().NewQuery("INSERT INTO character_jobs (character, portraitCheckedAt, portraitHash, portraitMisses, capAlert, spinDay) " +
		"SELECT id, portraitCheckedAt, portraitHash, portraitMisses, capAlert, spinDay FROM characters " +
		"WHERE portraitCheckedAt != '' OR portraitHash != '' OR portraitMisses != 0 OR capAlert != '' OR spinDay != ''").Execute(); err != nil {
		return err
	}
	characters.RemoveIndex("idx_characters_portrait")
	for _, name := range jobFields {
		characters.Fields.RemoveByName(name)
	}
	return app.Save(characters)
}

func characterJobsDown(app core.App) error {
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		return err
	}
	characters.Fields.Add(
		field(&core.DateField{}, m{"name": "portraitCheckedAt", "hidden": true}),
		field(&core.TextField{}, m{"name": "portraitHash", "max": 64, "hidden": true}),
		field(&core.NumberField{}, m{"name": "portraitMisses", "onlyInt": true, "min": 0, "hidden": true}),
		field(&core.TextField{}, m{"name": "capAlert", "max": 10, "hidden": true}),
		field(&core.TextField{}, m{"name": "spinDay", "max": 10, "hidden": true}),
	)
	characters.AddIndex("idx_characters_portrait", false, "`portraitCheckedAt`", "")
	if err := app.Save(characters); err != nil {
		return err
	}
	if _, err := app.DB().NewQuery("UPDATE characters SET portraitCheckedAt = j.portraitCheckedAt, portraitHash = j.portraitHash, portraitMisses = j.portraitMisses, " +
		"capAlert = j.capAlert, spinDay = j.spinDay FROM character_jobs j WHERE j.character = characters.id").Execute(); err != nil {
		return err
	}
	return deleteCollections(app, "character_jobs")
}
