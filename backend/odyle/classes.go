package odyle

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Class and level (#25): characters keep what the official search lists for them (the portrait
// job's lookup, portraits.go): the official id with the search region and server id that find its
// armory profile, the level and the class id (PLAYNC's pcId). The class's name comes from PLAYNC's
// own character pages: each profile the armory reads gives a pcId with its class name, kept in
// game_classes, so the class of every character with that id is named without another request.
// Players never set or change any of it (R1).

// Class icons: PLAYNC's character pages show each class's emblem, named by the class's own
// name (static-aion2/characters/img/class/class_icon_chanter.png; the Spiritmaster is
// ELEMENTALIST there), and list every class id with both names (/api/gameinfo/pcdata).
// learnClasses reads that list once at start and with the nightly armory job, names the
// class ids and keeps the emblems with the armory's images (armoryimages.go), so the
// dashboard shows them from the Odyle server. Paused with the armory.

const classIconBase = "https://assets.playnccdn.com/static-aion2/characters/img/class/"

func classIconsURL() string {
	if v := os.Getenv("PLAYNC_CLASS_ICONS_URL"); v != "" {
		return v
	}
	return classIconBase
}

var classCodes = regexp.MustCompile(`^[A-Za-z]{2,30}$`)

// learnClassesFor asks PLAYNC for its classes when the armory read a profile of a class whose
// emblem the server does not keep yet, at most once an hour.
func learnClassesFor(app core.App, class string) {
	if class == "" || classIcons(app)[class] != "" {
		return
	}
	w := stateOf(app).armory
	w.mu.Lock()
	due := time.Since(w.classesTried) > time.Hour
	if due {
		w.classesTried = time.Now()
	}
	w.mu.Unlock()
	if !due {
		return
	}
	if err := learnClasses(app); err != nil {
		warn(app, "Odyle could not read PLAYNC's classes", "error", message(err))
	}
}

// learnClasses asks PLAYNC for its classes, names their ids and keeps their emblems.
func learnClasses(app core.App) error {
	if readSettings(app).ArmoryPaused {
		return nil
	}
	res, err := send(call{method: "GET", url: armoryURL() + "/en-us/api/gameinfo/pcdata?lang=en", headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 15 * time.Second, limit: 1 << 20})
	if err != nil {
		return err
	}
	if res.status != 200 {
		return fmt.Errorf("PLAYNC answered %d for its classes.", res.status)
	}
	answer, _ := res.json().(map[string]any)
	list := jsonList(answer["pcDataList"])
	if len(list) == 0 {
		return errors.New("PLAYNC listed no classes.")
	}
	dir := imageDir(app)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	kept := map[string]bool{}
	for _, c := range list[:min(len(list), 200)] {
		id, code, name := whole(c["id"]), jsonText(c, "className", 30), jsonText(c, "classText", 40)
		if id <= 0 || name == "" || !classCodes.MatchString(code) {
			continue
		}
		if err := learnClass(app, id, name); err != nil {
			return err
		}
		icon := "class_icon_" + strings.ToLower(code) + ".png"
		if _, done := kept[icon]; !done {
			kept[icon] = keepClassIcon(app, dir, icon)
		}
		if kept[icon] {
			if _, err := app.DB().NewQuery("UPDATE game_classes SET icon = {:icon} WHERE pcId = {:id} AND icon != {:icon}").Bind(dbx.Params{"icon": icon, "id": id}).Execute(); err != nil {
				return err
			}
		}
	}
	return nil
}

// keepClassIcon makes sure the server keeps a class's emblem, shrunk like the game's icons.
func keepClassIcon(app core.App, dir, icon string) bool {
	if _, err := os.Stat(filepath.Join(dir, icon)); err == nil {
		return true
	}
	res, err := send(call{method: "GET", url: classIconsURL() + icon, headers: map[string]string{"user-agent": userAgent}, timeout: 15 * time.Second, limit: iconLimit})
	if err != nil || res.status != 200 || !bytes.HasPrefix(res.body, pngSignature) {
		return false
	}
	shrunk, err := shrinkIcon(res.body)
	if err == nil {
		err = writeImage(dir, icon, shrunk)
	}
	if err != nil {
		warn(app, "Odyle could not keep a class icon", "icon", icon, "error", message(err))
		return false
	}
	return true
}

// gameClass is a class id's name and the file name of its emblem ("" while not kept).
type gameClass struct {
	Id   int64  `db:"pcId"`
	Name string `db:"name"`
	Icon string `db:"icon"`
}

// gameClasses are the classes the server knows, by class id.
func gameClasses(app core.App) map[int64]gameClass {
	rows := []gameClass{}
	out := map[int64]gameClass{}
	if err := app.DB().NewQuery("SELECT pcId, name, icon FROM game_classes").All(&rows); err != nil {
		return out
	}
	for _, r := range rows {
		out[r.Id] = r
	}
	return out
}

// classIcons names each class's emblem by the class's name, for the classes the server
// keeps one of: { "Chanter": "class_icon_chanter.png" }.
func classIcons(app core.App) map[string]string {
	out := map[string]string{}
	for _, c := range gameClasses(app) {
		if c.Icon != "" {
			out[c.Name] = c.Icon
		}
	}
	return out
}

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
