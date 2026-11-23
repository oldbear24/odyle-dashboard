package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// How a character progressed (the Progress panel of its profile, src/armoryhistory.js):
// armory_history keeps one point a UTC day for each character the armory keeps, its combat power,
// item level and level as PLAYNC's pages listed them the last time that day. Every reading of a
// character's combat power passes through keepRank (ranks.go), a reader's lookup and the scout's
// checks and builds alike, which writes the point. Nothing in it is typed in by players (R1).

const historyKeep = 180 // the days of points kept, and the most a profile shows

// historyDay is t's UTC day as armory_history keeps it.
func historyDay(t time.Time) string { return t.UTC().Format("2006-01-02") + " 00:00:00.000Z" }

// keepHistory writes today's point of a character, or updates it with the reading now: one raw
// upsert, so a busy lookup or scout races no other writer of the row.
func keepHistory(app core.App, serverId int, characterId string, p armoryProfile) error {
	if p.CombatPower <= 0 {
		return nil
	}
	at := now()
	_, err := app.DB().NewQuery("INSERT INTO armory_history (serverId, characterId, day, combatPower, itemLevel, level, created, updated) " +
		"VALUES ({:server}, {:id}, {:day}, {:power}, {:itemLevel}, {:level}, {:at}, {:at}) " +
		"ON CONFLICT (serverId, characterId, day) DO UPDATE SET combatPower = excluded.combatPower, itemLevel = excluded.itemLevel, level = excluded.level, updated = excluded.updated").
		Bind(dbx.Params{"server": serverId, "id": characterId, "day": historyDay(time.Now()), "power": p.CombatPower, "itemLevel": p.ItemLevel, "level": p.Level, "at": at}).Execute()
	return err
}

// forgetHistory deletes a character's points (it was hidden).
func forgetHistory(app core.App, serverId int, characterId string) error {
	_, err := app.DB().NewQuery("DELETE FROM armory_history WHERE serverId = {:server} AND characterId = {:id}").
		Bind(dbx.Params{"server": serverId, "id": characterId}).Execute()
	return err
}

// cleanHistory deletes the points older than historyKeep days, and those of the characters the
// armory no longer keeps shown: in neither the top players (armory_ranks) nor the profiles, or
// hidden in either.
func cleanHistory(app core.App) (int, error) {
	res, err := app.DB().NewQuery("DELETE FROM armory_history WHERE day < {:before} " +
		"OR NOT EXISTS (SELECT 1 FROM armory_ranks r WHERE r.serverId = armory_history.serverId AND r.characterId = armory_history.characterId) " +
		"AND NOT EXISTS (SELECT 1 FROM armory_profiles p WHERE p.serverId = armory_history.serverId AND p.characterId = armory_history.characterId) " +
		"OR EXISTS (SELECT 1 FROM armory_ranks r WHERE r.serverId = armory_history.serverId AND r.characterId = armory_history.characterId AND r.hidden = TRUE) " +
		"OR EXISTS (SELECT 1 FROM armory_profiles p WHERE p.serverId = armory_history.serverId AND p.characterId = armory_history.characterId AND p.hidden = TRUE)").
		Bind(dbx.Params{"before": historyDay(time.Now().AddDate(0, 0, -historyKeep))}).Execute()
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// armoryPoint is a day of a character's history, as the armory route sends it.
type armoryPoint struct {
	Day         string `db:"day" json:"day"`
	CombatPower int64  `db:"combatPower" json:"combatPower"`
	ItemLevel   int64  `db:"itemLevel" json:"itemLevel"`
	Level       int64  `db:"level" json:"level"`
}

// armoryHistoryOf is a character's last historyKeep points, the oldest first, read from the index of
// its days.
func armoryHistoryOf(app core.App, serverId int, characterId string) ([]armoryPoint, error) {
	points := []armoryPoint{}
	err := app.DB().NewQuery("SELECT day, combatPower, itemLevel, level FROM (SELECT substr(day, 1, 10) AS day, combatPower, itemLevel, level FROM armory_history " +
		"WHERE serverId = {:server} AND characterId = {:id} ORDER BY armory_history.day DESC LIMIT {:limit}) ORDER BY day").
		Bind(dbx.Params{"server": serverId, "id": characterId, "limit": historyKeep}).All(&points)
	return points, err
}

// watchArmoryRanks deletes a character's history when a superuser hides its row among the top
// players (hiding its profile does too, watchArmoryProfiles); keepRank writes none for it then.
func watchArmoryRanks(app core.App) {
	hide := func(e *core.RecordEvent) error {
		if e.Record.GetBool("hidden") {
			if err := forgetHistory(e.App, e.Record.GetInt("serverId"), e.Record.GetString("characterId")); err != nil {
				return err
			}
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("armory_ranks").BindFunc(hide)
	app.OnRecordAfterUpdateSuccess("armory_ranks").BindFunc(hide)
}
