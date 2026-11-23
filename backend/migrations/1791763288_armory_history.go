package migrations

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// armory_history: how each character the armory keeps progressed, for the Progress panel of its
// profile (backend/odyle/armoryhistory.go). A row is a character (server id and PLAYNC's
// character id) on one UTC day, with its combat power, item level and level as PLAYNC's pages
// listed them the last time the armory read them that day: a reader's lookup and the scout's
// checks write it. The nightly clean-up deletes the days older than 180 and the characters the
// armory no longer keeps, and hiding a character deletes its days. No API rules: only the public
// armory route reads it.
//
// It starts with one day for each character the top players know (armory_ranks), the day it was
// last checked, so the panel shows that reading at once.
func init() {
	register("1791763288_armory_history.go", armoryHistoryUp, armoryHistoryDown)
}

func armoryHistoryUp(app core.App) error {
	if err := app.Save(collection(m{"name": "armory_history", "type": "base", "fields": fields(
		m{"name": "serverId", "type": "number", "required": true, "onlyInt": true, "min": 1000, "max": 2999},
		m{"name": "characterId", "type": "text", "required": true, "max": 100},
		m{"name": "day", "type": "date", "required": true},
		m{"name": "combatPower", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "itemLevel", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "level", "type": "number", "onlyInt": true, "min": 0},
		dates(),
	), "indexes": []string{
		"CREATE UNIQUE INDEX idx_armory_history_day ON armory_history (serverId, characterId, day)",
		"CREATE INDEX idx_armory_history_old ON armory_history (day)",
	}})); err != nil {
		return err
	}
	at := time.Now().UTC().Format("2006-01-02 15:04:05.000Z")
	_, err := app.DB().NewQuery("INSERT INTO armory_history (serverId, characterId, day, combatPower, itemLevel, level, created, updated) " +
		"SELECT r.serverId, r.characterId, substr(r.checkedAt, 1, 10) || ' 00:00:00.000Z', r.combatPower, r.itemLevel, r.level, {:at}, {:at} FROM armory_ranks r " +
		"WHERE r.hidden = FALSE AND r.checkedAt != '' AND r.combatPower > 0 " +
		"AND NOT EXISTS (SELECT 1 FROM armory_profiles p WHERE p.serverId = r.serverId AND p.characterId = r.characterId AND p.hidden = TRUE) " +
		"ON CONFLICT DO NOTHING").Bind(dbx.Params{"at": at}).Execute()
	return err
}

func armoryHistoryDown(app core.App) error {
	return deleteCollections(app, "armory_history")
}
