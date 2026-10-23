package odyle

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Class and level (#25): characters keep what the official search lists for them (the portrait
// job's lookup, portraits.go): the official id with the search region and server id that find its
// armory profile, the level and the class id (PLAYNC's pcId). The class's name comes from PLAYNC's
// own character pages: each profile the armory reads gives a pcId with its class name, kept in
// game_classes, so the class of every character with that id is named without another request.
// Players never set or change any of it (R1).

// setOfficial keeps a search hit on the character (not saved here), with the class name already
// learned for its class id.
func setOfficial(app core.App, c *Character, hit officialHit) {
	if hit.id != "-" {
		c.Set("officialId", hit.id)
		c.Set("officialRegion", hit.region)
		c.Set("officialServerId", hit.serverId)
	}
	// A character saved as NA before the regions were told apart moves to NA-West once the search
	// finds it there, unless the account also has it under NA-West (odyle-windows#4).
	if hit.region == "naw" && c.GetString("region") == "GLOBAL_NA" {
		if _, err := app.FindFirstRecordByFilter("characters", "user = {:user} && region = 'GLOBAL_NAW' && server = {:server} && characterName = {:name}",
			dbx.Params{"user": c.GetString("user"), "server": c.GetString("server"), "name": c.GetString("characterName")}); isNoRows(err) {
			c.Set("region", "GLOBAL_NAW")
		}
	}
	c.Set("level", hit.level)
	c.Set("classId", hit.classId)
	c.Set("className", classNameOf(app, hit.classId))
}

// classNameOf is the learned name of a class id, or "".
func classNameOf(app core.App, classId int64) string {
	if classId <= 0 {
		return ""
	}
	found, err := app.FindFirstRecordByFilter("game_classes", "pcId = {:id}", dbx.Params{"id": classId})
	if err != nil {
		return ""
	}
	return found.GetString("name")
}

// learnClass keeps the class name PLAYNC's character page gave for a class id and names the
// characters with that id; a name PLAYNC changes is taken over.
func learnClass(app core.App, classId int64, name string) error {
	if classId <= 0 || name == "" {
		return nil
	}
	record, err := app.FindFirstRecordByFilter("game_classes", "pcId = {:id}", dbx.Params{"id": classId})
	if err != nil && !isNoRows(err) {
		return err
	}
	if record != nil && record.GetString("name") == name {
		return nil
	}
	if record == nil {
		collection, err := app.FindCollectionByNameOrId("game_classes")
		if err != nil {
			return err
		}
		record = core.NewRecord(collection)
		record.Set("pcId", classId)
	}
	record.Set("name", name)
	if err := app.Save(record); err != nil {
		return err
	}
	// Characters with this class id are named now; their rooms hear of it like any change.
	named, err := app.FindAllRecords("characters", dbx.HashExp{"classId": classId})
	if err != nil {
		return err
	}
	for _, c := range named {
		if c.GetString("className") == name {
			continue
		}
		// Saved from a fresh copy in a transaction: a reading saved meanwhile is kept.
		if err := app.RunInTransaction(func(tx core.App) error {
			fresh, err := tx.FindRecordById("characters", c.Id)
			if err != nil || fresh.GetString("className") == name {
				return err
			}
			fresh.Set("className", name)
			return tx.Save(fresh)
		}); err != nil && !isNoRows(err) {
			return err
		}
	}
	return nil
}
