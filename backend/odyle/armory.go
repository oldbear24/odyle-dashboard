package odyle

import (
	"errors"
	"maps"
	"os"
	"regexp"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory (#67): anyone, signed in or not, looks up an AION 2 Global character and sees
// everything PLAYNC's official character pages list for it: gear with each item's details,
// combat power, item level, stats, skills, titles, skins and Daevanion boards
// (/api/character/info, /equipment, /equipment/item and /daevanion/detail on
// aion2.plaync.com, docs/armory.md), with the game's icons and the character's portrait kept
// on the Odyle server (armoryimages.go). Nothing in it is typed in or changed by players (R1)
// and no game packets are involved (R3).
//
// Profiles are kept in armory_profiles. A reader gets the kept copy at once, with its age;
// a profile not kept yet, older than armoryRefresh or kept in an older shape waits in one
// server-wide queue that asks PLAYNC for one profile at a time (its pages armoryStep apart),
// armoryPace apart, so a reader may wait and the page says for how long. The queue takes armoryQueueSize profiles, at most
// armoryPerAddress from one address; PLAYNC refusing the server (403, 429) stops it for a
// while. Superusers pause it under Server controls and keep a profile out for good with
// its hidden switch (Collections → armory_profiles); profiles nobody opened for 30 days
// are deleted.

const (
	armoryRefresh       = 6 * time.Hour       // a kept profile older than this is fetched again when opened
	armoryReaderRefresh = 15 * time.Minute    // a reader's Refresh counts once the profile is this old
	armoryKeep          = 30 * 24 * time.Hour // profiles nobody opened this long are deleted
	armoryQueueSize     = 100
	armoryPerAddress    = 3
	armoryMissing       = time.Hour        // a character PLAYNC does not list is not asked for again before
	armoryRetry         = 10 * time.Minute // a failed lookup is not tried again before
	armoryBlocked       = 10 * time.Minute // PLAYNC refused the server without saying how long
	armorySearchKeep    = 10 * time.Minute // a search's results are kept this long
	armoryIncomplete    = time.Hour        // a kept profile missing some details is fetched again when opened after this
)

// armoryPace is the time between two profile lookups, armoryStep between the pages of one
// lookup (info, equipment, then each item's and each open board's details) and
// armorySearchGap between two searches, server-wide; the test build shortens them.
var armoryPace, armoryStep, armorySearchGap = 5 * time.Second, 250 * time.Millisecond, time.Second

// armoryTook is how long a lookup is taken to last until the first one ends: PLAYNC answers
// each page in one to two seconds, and a character at the level cap has some 30 of them.
const armoryTook = 40 * time.Second

func armoryURL() string {
	if v := os.Getenv("PLAYNC_ARMORY_URL"); v != "" {
		return v
	}
	return "https://aion2.plaync.com"
}

// PLAYNC's character ids are URL-safe Base64 with padding.
var armoryIds = regexp.MustCompile(`^[A-Za-z0-9_-]{8,90}={0,2}$`)

// armoryVersion is the shape of the kept profiles: one kept in an older shape (without item
// details, skills, titles, skins, boards' nodes or images) is fetched again when opened.
const armoryVersion = 2

// The profile the armory keeps and shows, read from PLAYNC's answers: what the official
// pages list publicly, from the profile and stats to every equipped item with its details,
// the skins, skills, titles and Daevanion boards. Images are kept by file name (Portrait,
// Icon: armoryimages.go); rankings and the official pages' own texts are left out.
type armoryProfile struct {
	pcId         int64
	portraitLink string
	Version      int           `json:"v"`
	Name         string        `json:"name"`
	Level        int64         `json:"level"`
	Class        string        `json:"class"`
	Race         string        `json:"race"`
	Gender       string        `json:"gender"`
	Server       string        `json:"server"`
	Title        string        `json:"title"`
	TitleGrade   string        `json:"titleGrade"`
	Legion       string        `json:"legion"` // PLAYNC's profile.regionName, which its own pages call the guild's name
	CombatPower  int64         `json:"combatPower"`
	ItemLevel    int64         `json:"itemLevel"`
	Portrait     string        `json:"portrait"`
	Stats        []armoryStat  `json:"stats"`
	Gear         []armoryGear  `json:"gear"`
	Skins        []armorySkin  `json:"skins"`
	Skills       []armorySkill `json:"skills"`
	Titles       armoryTitles  `json:"titles"`
	Boards       []armoryBoard `json:"boards"`
	// Missing counts the item and board pages that failed when it was read, whose details it
	// lacks; a profile missing some is fetched again sooner (armoryIncomplete).
	Missing int `json:"missingDetails,omitempty"`
}

// A stat: the six primary ones (STR, DEX, INT, CON, AGI, WIS) or a deity's ("Justice",
// deity "Nezekan"), with what it gives ("Attack increase +2.6%").
type armoryStat struct {
	Type    string   `json:"type"`
	Name    string   `json:"name"`
	Deity   string   `json:"deity,omitempty"`
	Value   int64    `json:"value"`
	Primary bool     `json:"primary"`
	Effects []string `json:"effects"`
}

// An equipped item by PLAYNC's slot name (MainHand, Earring1, Arcana3…, and Wings and Pet),
// with its details as the official item page lists them for this character.
type armoryGear struct {
	Slot    string      `json:"slot"`
	Name    string      `json:"name"`
	Grade   string      `json:"grade"`
	Enchant int64       `json:"enchant"`
	Exceed  int64       `json:"exceed"`
	Level   int64       `json:"level,omitempty"`
	Icon    string      `json:"icon,omitempty"`
	Detail  *armoryItem `json:"detail,omitempty"`
	id      int64
	order   int64
}

// armoryItem is an item's details: its type, level and limits, its stats (main, soul binding),
// the manastones and godstones engraved in it, the skills it raises and its set.
type armoryItem struct {
	Category   string           `json:"category"`
	Kind       string           `json:"kind"`
	ItemLevel  int64            `json:"itemLevel"`
	MaxEnchant int64            `json:"maxEnchant"`
	MaxExceed  int64            `json:"maxExceed"`
	EquipLevel int64            `json:"equipLevel"`
	Race       string           `json:"race"`
	Classes    []string         `json:"classes"`
	Main       []armoryLine     `json:"main"`
	Sub        []armoryLine     `json:"sub"`
	SubCount   int64            `json:"subCount"`
	SoulBind   string           `json:"soulBind"`
	SubSkills  []armorySubSkill `json:"subSkills"`
	StoneSlots int64            `json:"stoneSlots"`
	Stones     []armoryStone    `json:"stones"`
	GodSlots   int64            `json:"godSlots"`
	GodStones  []armoryStone    `json:"godStones"`
	Set        *armorySet       `json:"set,omitempty"`
	Desc       string           `json:"desc,omitempty"`
	Sources    []string         `json:"sources"`
	Skins      []string         `json:"skins"`
	Tradable   bool             `json:"tradable"`
	Storable   bool             `json:"storable"`
}

// A stat line of an item: "Attack 315 ~ 630 (+174)"; an exceed line has only its extra.
type armoryLine struct {
	Name   string `json:"name"`
	Min    string `json:"min,omitempty"`
	Value  string `json:"value"`
	Extra  string `json:"extra,omitempty"`
	Exceed bool   `json:"exceed,omitempty"`
}

type armorySubSkill struct {
	Name  string `json:"name"`
	Level int64  `json:"level"`
	Icon  string `json:"icon,omitempty"`
}

// A manastone ("Attack +10") or a godstone (with what it does).
type armoryStone struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
	Grade string `json:"grade"`
	Desc  string `json:"desc,omitempty"`
	Icon  string `json:"icon,omitempty"`
}

// An item's set: its pieces (those equipped marked) and the effects of 2, 3… pieces.
type armorySet struct {
	Name     string           `json:"name"`
	Equipped int64            `json:"equipped"`
	Items    []armorySetItem  `json:"items"`
	Bonuses  []armorySetBonus `json:"bonuses"`
}

type armorySetItem struct {
	Name     string `json:"name"`
	Grade    string `json:"grade"`
	Equipped bool   `json:"equipped"`
}

type armorySetBonus struct {
	Count   int64    `json:"count"`
	Effects []string `json:"effects"`
}

// A skin (an appearance over an equipped item or the wings).
type armorySkin struct {
	Slot  string `json:"slot"`
	Name  string `json:"name"`
	Grade string `json:"grade"`
	Icon  string `json:"icon,omitempty"`
	order int64
}

// A skill: Active, Passive or Dp (stigma), its level, whether the character learned it
// and has it on its bar.
type armorySkill struct {
	Name      string `json:"name"`
	Category  string `json:"category"`
	Level     int64  `json:"level"`
	NeedLevel int64  `json:"needLevel"`
	Acquired  bool   `json:"acquired"`
	Equipped  bool   `json:"equipped"`
	Icon      string `json:"icon,omitempty"`
}

// The titles the character owns, and the one it wears in each category (Attack, Defense, Etc).
type armoryTitles struct {
	Owned    int64         `json:"owned"`
	Total    int64         `json:"total"`
	Equipped []armoryTitle `json:"equipped"`
}

type armoryTitle struct {
	Category string   `json:"category"`
	Name     string   `json:"name"`
	Grade    string   `json:"grade"`
	Owned    int64    `json:"owned"`
	Total    int64    `json:"total"`
	Effects  []string `json:"effects"`
	Stats    []string `json:"stats"`
}

// A Daevanion board, how many of its nodes are open and, once any is, its nodes by row and
// column with what the open ones give.
type armoryBoard struct {
	Id           int64        `json:"id"`
	Name         string       `json:"name"`
	Open         int64        `json:"open"`
	Total        int64        `json:"total"`
	Icon         string       `json:"icon,omitempty"`
	Nodes        []armoryNode `json:"nodes"`
	StatEffects  []string     `json:"statEffects"`
	SkillEffects []string     `json:"skillEffects"`
}

// A board node: row, column, grade, type (Stat, SkillLevel, Start…), open, and its effect or
// (without one, or for other types) name, in short keys: a board has up to 150 nodes.
type armoryNode struct {
	Row    int64  `json:"r"`
	Col    int64  `json:"c"`
	Grade  string `json:"g"`
	Type   string `json:"t"`
	Open   bool   `json:"o,omitempty"`
	Name   string `json:"n,omitempty"`
	Effect string `json:"e,omitempty"`
}

// cleanArmory is a job: profiles nobody opened for 30 days are deleted, hidden ones kept, the
// characters below their class's top checked more than 30 days ago forgotten (ranks.go), and then
// the images no kept profile or top player names (armoryimages.go).
func cleanArmory(app core.App) (result, error) {
	res, err := app.DB().NewQuery("DELETE FROM armory_profiles WHERE hidden = FALSE AND viewedAt < {:before}").Bind(dbx.Params{"before": ago(armoryKeep)}).Execute()
	if err != nil {
		return result{}, err
	}
	deleted, _ := res.RowsAffected()
	forgotten, err := cleanRanks(app)
	if err != nil {
		return result{Done: int(deleted)}, err
	}
	deleted += int64(forgotten)
	if _, err := cleanArmoryImages(app); err != nil {
		return result{Done: int(deleted)}, err
	}
	return result{Done: int(deleted)}, nil
}

// armoryNight is the nightly odyle-armory job: it forgets the profiles and images nobody
// needs any more (cleanArmory) and reads PLAYNC's classes (classes.go) and servers (servers.go)
// again.
func armoryNight(app core.App) (result, error) {
	out, err := cleanArmory(app)
	if err != nil {
		return out, err
	}
	return out, errors.Join(learnClasses(app), learnServers(app))
}

// armoryStatus is the armory's part of the Server status page, with its queue: the lookups
// running and waiting, readers' and the scout's, by character (named as the armory knows it),
// without the addresses that asked.
func armoryStatus(app core.App) map[string]any {
	w := stateOf(app).armory
	w.mu.Lock()
	queue := []map[string]any{}
	runs := slices.Collect(maps.Values(w.running))
	slices.SortFunc(runs, func(a, b *armoryRun) int { return a.startedAt.Compare(b.startedAt) })
	for _, r := range runs {
		progress, _ := r.track.read()
		queue = append(queue, map[string]any{"state": "fetching", "scout": r.job.auto, "region": r.job.region, "serverId": r.job.serverId, "characterId": r.job.characterId, "since": isoTime(r.startedAt), "progress": progress})
	}
	readers, scouts, readersWaiting, scoutsWaiting := w.counts()
	for i, j := range w.waiting {
		queue = append(queue, map[string]any{"state": "queued", "scout": j.auto, "region": j.region, "serverId": j.serverId, "characterId": j.characterId, "since": isoTime(j.queuedAt), "position": i + 1})
	}
	out := map[string]any{"waiting": len(w.waiting), "fetching": len(w.running) > 0, "running": len(w.running), "done": w.done, "failed": w.failed, "lastAt": isoTime(w.lastAt), "lastError": w.lastError,
		"lastErrorAt": isoTime(w.errorAt), "blockedUntil": "", "lanes": map[string]any{"readers": w.readerLanes, "scouts": w.scoutLanes},
		"readers": map[string]any{"running": readers, "waiting": readersWaiting}, "scouts": map[string]any{"running": scouts, "waiting": scoutsWaiting}}
	if w.blocked.After(time.Now()) {
		out["blockedUntil"] = isoTime(w.blocked)
	}
	w.mu.Unlock()
	// The characters' names, as their profiles or the top players keep them.
	for _, q := range queue {
		var name string
		_ = app.DB().NewQuery("SELECT name FROM armory_profiles WHERE serverId = {:server} AND characterId = {:id} AND name != '' UNION ALL SELECT name FROM armory_ranks WHERE serverId = {:server} AND characterId = {:id} AND name != '' LIMIT 1").
			Bind(dbx.Params{"server": q["serverId"], "id": q["characterId"]}).Row(&name)
		q["name"], q["server"] = name, serversOf(app).inRegion(q["region"].(string), q["serverId"].(int))
	}
	out["queue"] = queue
	var kept, hidden int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles").Row(&kept)
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles WHERE hidden = TRUE").Row(&hidden)
	out["profiles"], out["hidden"], out["paused"] = kept, hidden, readSettings(app).ArmoryPaused
	// The kept images (imagestore.go), with their files in S3 storage (imagesOffHost) or on the
	// data volume.
	var images int
	var imageBytes int64
	_ = app.DB().NewQuery("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM "+armoryImagesCollection).Row(&images, &imageBytes)
	out["images"], out["imageBytes"], out["imagesOffHost"] = images, imageBytes, app.Settings().S3.Enabled
	// The top players (ranks.go): characters known, and those whose gear is.
	var ranked, built int
	_ = app.DB().NewQuery("SELECT COUNT(*), COALESCE(SUM(builtAt != ''), 0) FROM armory_ranks WHERE hidden = FALSE").Row(&ranked, &built)
	out["ranked"], out["built"] = ranked, built
	out["scout"] = scoutStatus(app)
	return out
}
