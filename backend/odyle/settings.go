package odyle

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// Server-wide game rules and server controls, kept in the single odyle_settings record.
// Superusers edit them on the dashboard's Odyle pages (backend/admin) or under
// Collections → odyle_settings. Launch defaults: 40 Odyle per cube, resets at 07:00 UTC
// and weekly on Wednesday (the Global service), inactive accounts are kept for good and
// the dungeon catalog is empty, so wishlists and runs take any name. No announcement,
// nothing paused (packet readers included), and the packet adapters of protocols.go
// are the accepted ones.

var weekDays = []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"}
var levels = []string{"info", "warning"}

type adapterLists struct {
	Extra    []string `json:"extra"`
	Disabled []string `json:"disabled"`
}

// A dungeon of the catalog: what opening one of its cubes costs (0: the server-wide Odyle
// per cube), how many players its party has (4, 5, 10 or 20; 0 when not set), a category
// to group it by and whether its cost is still unconfirmed for Global. Superusers keep
// these game rules; they are never character data.
type dungeonEntry struct {
	Name        string `json:"name"`
	Cost        int64  `json:"cost"`
	PartySize   int64  `json:"partySize"`
	Category    string `json:"category"`
	Unconfirmed bool   `json:"unconfirmed"`
}

var partySizes = []int64{0, 4, 5, 10, 20}

// The Odyle clock's game rules: the natural pool regenerates at fixed UTC hours by tick Odyle
// (unless a character's own regeneration readings showed another size) up to the smallest
// cap its readings fit under (560, or 840 with the membership). Clients project from them
// and never store the result; paused hides every estimate. Superusers keep them; a game
// patch that moves the schedule is fixed here without a release.
type clockRules struct {
	TickHours []int64 `json:"tickHours"`
	Tick      int64   `json:"tick"`
	Caps      []int64 `json:"caps"`
	Paused    bool    `json:"paused"`
}

func defaultClock() clockRules {
	return clockRules{TickHours: []int64{1, 4, 7, 10, 13, 16, 19, 22}, Tick: 15, Caps: []int64{560, 840}}
}

// clockSettings checks the clock's rules: 1 to 24 different UTC hours, a tick of 1 to 1000
// Odyle and 1 to 4 caps of 1 to 1,000,000, each larger than the one before.
func clockSettings(value any) (clockRules, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return clockRules{}, errors.New("The Odyle clock must be an object.")
	}
	var c clockRules
	if json.Unmarshal(raw, &c) != nil {
		return clockRules{}, errors.New("The Odyle clock must be an object with tickHours, tick, caps and paused.")
	}
	if len(c.TickHours) == 0 || len(c.TickHours) > 24 {
		return clockRules{}, errors.New("The regeneration happens at 1 to 24 UTC hours.")
	}
	seen := map[int64]bool{}
	for _, h := range c.TickHours {
		if h < 0 || h > 23 || seen[h] {
			return clockRules{}, errors.New("Regeneration hours are different whole UTC hours from 0 to 23.")
		}
		seen[h] = true
	}
	slices.Sort(c.TickHours)
	if c.Tick < 1 || c.Tick > 1000 {
		return clockRules{}, errors.New("A regeneration tick is 1 to 1000 Odyle.")
	}
	if len(c.Caps) == 0 || len(c.Caps) > 4 {
		return clockRules{}, errors.New("The natural pool has 1 to 4 caps.")
	}
	for i, cap := range c.Caps {
		if cap < 1 || cap > 1000000 || i > 0 && cap <= c.Caps[i-1] {
			return clockRules{}, errors.New("Caps are 1 to 1,000,000 Odyle, each larger than the one before.")
		}
	}
	return c, nil
}

type settings struct {
	OdylePerCube        int64          `json:"odylePerCube"`
	DailyResetHour      int64          `json:"dailyResetHour"`
	WeeklyResetDay      string         `json:"weeklyResetDay"`
	InactiveAccountDays int64          `json:"inactiveAccountDays"`
	Dungeons            []dungeonEntry `json:"catalog"`
	Announcement        string         `json:"announcement"`
	AnnouncementLevel   string         `json:"announcementLevel"`
	PortraitsPaused     bool           `json:"portraitsPaused"`
	RemindersPaused     bool           `json:"remindersPaused"`
	PairingPaused       bool           `json:"pairingPaused"`
	ReaderPaused        bool           `json:"readerPaused"`
	Adapters            adapterLists   `json:"adapters"`
	Clock               clockRules     `json:"clock"`
}

// The superuser settings answer lists the catalog's entries as `catalog` and keeps
// `dungeons` the list of names it always was, which admin pages opened before catalog
// entries still read and send back (writeSettings).
func (s settings) MarshalJSON() ([]byte, error) {
	type entries settings
	return json.Marshal(struct {
		entries
		Names []string `json:"dungeons"`
	}{entries(s), dungeonNames(s.Dungeons)})
}

func defaultSettings() settings {
	return settings{OdylePerCube: 40, DailyResetHour: 7, WeeklyResetDay: "wednesday", Dungeons: []dungeonEntry{}, AnnouncementLevel: "info", Adapters: adapterLists{Extra: []string{}, Disabled: []string{}}, Clock: defaultClock()}
}

func findSettings(app core.App) *core.Record {
	record, err := app.FindFirstRecordByFilter("odyle_settings", `id != ""`)
	if err != nil {
		return nil
	}
	return record
}

func stringList(value any) []string {
	out := []string{}
	if list, ok := value.([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

// settingsCache keeps the settings in memory: most requests and every job read them,
// and they change only when a superuser saves them. The odyle_settings hooks
// (watchSettings) drop the copy after every change, so the next read loads the record
// again, whether writeSettings saved it, a superuser edited it under Collections →
// odyle_settings or a test fixture did. A read that loaded the record before a change
// never keeps its older copy (generation).
type settingsCache struct {
	mu         sync.Mutex
	generation uint64
	value      *settings
}

func (c *settingsCache) drop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.generation++
	c.value = nil
}

// readSettings answers the current settings. Callers must not change the lists in the
// answer: they are shared with every other caller.
func readSettings(app core.App) settings {
	c := &stateOf(app).settings
	c.mu.Lock()
	if c.value != nil {
		current := *c.value
		c.mu.Unlock()
		return current
	}
	generation := c.generation
	c.mu.Unlock()
	loaded := loadSettings(app)
	c.mu.Lock()
	if c.generation == generation {
		c.value = &loaded
	}
	c.mu.Unlock()
	return loaded
}

// watchSettings drops the cached settings whenever the record or its collection
// changes, a failed change included.
func watchSettings(app core.App) {
	drop := func(e *core.RecordEvent) error { stateOf(e.App).settings.drop(); return e.Next() }
	dropFailed := func(e *core.RecordErrorEvent) error { stateOf(e.App).settings.drop(); return e.Next() }
	app.OnRecordAfterCreateSuccess("odyle_settings").BindFunc(drop)
	app.OnRecordAfterUpdateSuccess("odyle_settings").BindFunc(drop)
	app.OnRecordAfterDeleteSuccess("odyle_settings").BindFunc(drop)
	app.OnRecordAfterCreateError("odyle_settings").BindFunc(dropFailed)
	app.OnRecordAfterUpdateError("odyle_settings").BindFunc(dropFailed)
	app.OnRecordAfterDeleteError("odyle_settings").BindFunc(dropFailed)
	// A changed announcement reaches every open dashboard and running app at once.
	announce := func(e *core.RecordEvent) error {
		before, after := e.Record.Original(), e.Record
		if before.GetString("announcement") != after.GetString("announcement") || before.GetString("announcementLevel") != after.GetString("announcementLevel") {
			tellEveryone(e.App, map[string]any{"announcement": announcement(settings{Announcement: after.GetString("announcement"), AnnouncementLevel: after.GetString("announcementLevel")})})
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("odyle_settings").BindFunc(announce)
	app.OnRecordAfterUpdateSuccess("odyle_settings").BindFunc(announce)
	dropCollection := func(e *core.CollectionEvent) error { stateOf(e.App).settings.drop(); return e.Next() }
	app.OnCollectionAfterUpdateSuccess("odyle_settings").BindFunc(dropCollection)
	app.OnCollectionAfterDeleteSuccess("odyle_settings").BindFunc(dropCollection)
}

// loadSettings reads the odyle_settings record, or the defaults without one.
func loadSettings(app core.App) settings {
	s := findSettings(app)
	if s == nil {
		return defaultSettings()
	}
	out := settings{OdylePerCube: s.GetInt64("odylePerCube"), DailyResetHour: s.GetInt64("dailyResetHour"), WeeklyResetDay: s.GetString("weeklyResetDay"), InactiveAccountDays: s.GetInt64("inactiveAccountDays"),
		Dungeons: storedCatalog(parseJSON(s.GetString("dungeons"), "[]")), Announcement: s.GetString("announcement"), AnnouncementLevel: s.GetString("announcementLevel"),
		PortraitsPaused: s.GetBool("portraitsPaused"), RemindersPaused: s.GetBool("remindersPaused"), PairingPaused: s.GetBool("pairingPaused"), ReaderPaused: s.GetBool("readerPaused")}
	if out.OdylePerCube == 0 {
		out.OdylePerCube = 40
	}
	// Saved clock rules that no longer check out (or none yet) are the defaults.
	if clock, err := clockSettings(parseJSON(s.GetString("clock"), "null")); err == nil {
		out.Clock = clock
	} else {
		out.Clock = defaultClock()
	}
	if out.WeeklyResetDay == "" {
		out.WeeklyResetDay = "wednesday"
	}
	if !contains(levels, out.AnnouncementLevel) {
		out.AnnouncementLevel = "info"
	}
	lists, _ := parseJSON(s.GetString("adapters"), "{}").(map[string]any)
	out.Adapters = adapterLists{Extra: stringList(lists["extra"]), Disabled: stringList(lists["disabled"])}
	return out
}

// catalogEntry reads one dungeon of the catalog: a name alone, as the catalog was saved
// before it had entries (it costs Odyle per cube), or { name, cost?, partySize?,
// category?, unconfirmed? }.
func catalogEntry(item any) (dungeonEntry, error) {
	if name, ok := item.(string); ok {
		d, err := dungeon(name)
		return dungeonEntry{Name: d.dungeon}, err
	}
	v, ok := item.(map[string]any)
	if !ok {
		return dungeonEntry{}, errors.New("Dungeons must be a list of names.")
	}
	d, err := dungeon(v["name"])
	if err != nil {
		return dungeonEntry{}, err
	}
	entry := dungeonEntry{Name: d.dungeon}
	if v["cost"] != nil {
		if entry.Cost, err = integer(v["cost"], "Odyle cost", 0, 1000); err != nil {
			return dungeonEntry{}, err
		}
	}
	if v["partySize"] != nil {
		size, err := integer(v["partySize"], "Party size", 0, 20)
		if err != nil || !slices.Contains(partySizes, size) {
			return dungeonEntry{}, errors.New("Party size must be 4, 5, 10 or 20, or 0 when not set.")
		}
		entry.PartySize = size
	}
	if v["category"] != nil {
		category, ok := v["category"].(string)
		entry.Category = collapse(trim(category))
		if !ok || length(entry.Category) > 30 {
			return dungeonEntry{}, errors.New("A dungeon category is text of up to 30 characters.")
		}
	}
	if v["unconfirmed"] != nil {
		if entry.Unconfirmed, ok = v["unconfirmed"].(bool); !ok {
			return dungeonEntry{}, errors.New("Unconfirmed must be true or false.")
		}
	}
	return entry, nil
}

// catalog checks a dungeon catalog to save, up to 200 dungeons. A dungeon listed twice,
// regardless of case and spacing, keeps its first entry and spelling. A name alone takes
// the details `kept` holds for that dungeon (none: it costs Odyle per cube).
func catalog(value any, kept []dungeonEntry) ([]dungeonEntry, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, errors.New("Dungeons must be a list of names.")
	}
	seen, out := map[string]bool{}, []dungeonEntry{}
	for _, item := range items {
		entry, err := catalogEntry(item)
		if err != nil {
			return nil, err
		}
		if _, named := item.(string); named {
			if at := slices.IndexFunc(kept, func(k dungeonEntry) bool { return strings.EqualFold(k.Name, entry.Name) }); at >= 0 {
				entry = dungeonEntry{Name: entry.Name, Cost: kept[at].Cost, PartySize: kept[at].PartySize, Category: kept[at].Category, Unconfirmed: kept[at].Unconfirmed}
			}
		}
		if key := strings.ToLower(entry.Name); !seen[key] {
			seen[key] = true
			out = append(out, entry)
		}
	}
	if len(out) > 200 {
		return nil, errors.New("The dungeon list can hold up to 200 names.")
	}
	return out, nil
}

// storedCatalog reads the saved catalog, plain names included (a record from before
// 1791763230_catalog_entries.go, or edited under Collections); a dungeon it cannot read
// is left out.
func storedCatalog(value any) []dungeonEntry {
	out := []dungeonEntry{}
	items, _ := value.([]any)
	for _, item := range items {
		if entry, err := catalogEntry(item); err == nil {
			out = append(out, entry)
		}
	}
	return out
}

// dungeonNames are the names of the catalog, the snapshot's `dungeons`.
func dungeonNames(entries []dungeonEntry) []string {
	out := make([]string, len(entries))
	for i, entry := range entries {
		out[i] = entry.Name
	}
	return out
}

// Built-in adapters (protocols.go) stay accepted unless disabled here, so an adapter a
// deploy adds is accepted at once; extra names accept a decoder before the next deploy.
var adapterName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

func accepted(lists adapterLists) []string {
	out := []string{}
	for _, name := range verifiedAdapters {
		if !contains(lists.Disabled, name) {
			out = append(out, name)
		}
	}
	return append(out, lists.Extra...)
}

func adapterSettings(value any) (adapterLists, error) {
	v, ok := value.(map[string]any)
	extra, extraOk := v["extra"].([]any)
	disabled, disabledOk := v["disabled"].([]any)
	if !ok || !extraOk || !disabledOk {
		return adapterLists{}, errors.New("Packet adapters must list extra and disabled names.")
	}
	names := func(raw []any) ([]string, error) {
		out := []string{}
		for _, item := range raw {
			name, _ := item.(string)
			name = trim(name)
			if !adapterName.MatchString(name) {
				return nil, errors.New("Adapter names use letters, digits, dots, dashes and underscores, up to 80 characters.")
			}
			if !contains(out, name) {
				out = append(out, name)
			}
		}
		return out, nil
	}
	extraNames, err := names(extra)
	if err != nil {
		return adapterLists{}, err
	}
	disabledNames, err := names(disabled)
	if err != nil {
		return adapterLists{}, err
	}
	lists := adapterLists{Extra: []string{}, Disabled: []string{}}
	for _, name := range extraNames {
		if !contains(verifiedAdapters, name) {
			lists.Extra = append(lists.Extra, name)
		}
	}
	for _, name := range disabledNames {
		if contains(verifiedAdapters, name) {
			lists.Disabled = append(lists.Disabled, name)
		}
	}
	if len(lists.Extra) > 20 {
		return adapterLists{}, errors.New("Up to 20 extra packet adapters.")
	}
	if len(accepted(lists)) == 0 {
		return adapterLists{}, errors.New("Keep at least one packet adapter accepted, or no reading can be saved.")
	}
	return lists, nil
}

// inactiveDays checks a period after which unused accounts are deleted: 0 keeps them,
// otherwise 30 days to ten years.
func inactiveDays(value any) (int64, error) {
	days, err := integer(value, "Inactive account days", 0, 3650)
	if err != nil {
		return 0, err
	}
	if days > 0 && days < 30 {
		return 0, errors.New("Delete inactive accounts after 30 days or more, or 0 to keep them.")
	}
	return days, nil
}

// writeSettings saves the given settings (all optional) and creates the record if a
// superuser deleted it.
func writeSettings(app core.App, b body) (settings, error) {
	record := findSettings(app)
	if record == nil {
		collection, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return settings{}, err
		}
		record = core.NewRecord(collection)
	}
	next := readSettings(app)
	var err error
	if b.has("odylePerCube") {
		if next.OdylePerCube, err = integer(b["odylePerCube"], "Odyle per cube", 1, 1000); err != nil {
			return settings{}, err
		}
	}
	if b.has("dailyResetHour") {
		if next.DailyResetHour, err = integer(b["dailyResetHour"], "Daily reset hour", 0, 23); err != nil {
			return settings{}, err
		}
	}
	if b.has("weeklyResetDay") {
		day, _ := b.text("weeklyResetDay")
		if !contains(weekDays, day) {
			return settings{}, errors.New("Choose the weekly reset day (sunday to saturday).")
		}
		next.WeeklyResetDay = day
	}
	if b.has("inactiveAccountDays") {
		if next.InactiveAccountDays, err = inactiveDays(b["inactiveAccountDays"]); err != nil {
			return settings{}, err
		}
	}
	// `catalog` saves the entries as given. `dungeons`, which admin pages from before catalog
	// entries send with every save of their game settings, is a list of names: each keeps
	// the details saved for that dungeon, so such a page never wipes the costs.
	if b.has("catalog") {
		if next.Dungeons, err = catalog(b["catalog"], nil); err != nil {
			return settings{}, err
		}
	} else if b.has("dungeons") {
		if next.Dungeons, err = catalog(b["dungeons"], next.Dungeons); err != nil {
			return settings{}, err
		}
	}
	// One line of plain text; clients render it as text, never as HTML.
	if b.has("announcement") {
		text, ok := b.text("announcement")
		if !ok {
			return settings{}, errors.New("The announcement must be text.")
		}
		next.Announcement = collapse(trim(text))
		if length(next.Announcement) > 300 {
			return settings{}, errors.New("The announcement can be up to 300 characters.")
		}
	}
	if b.has("announcementLevel") {
		level, _ := b.text("announcementLevel")
		if !contains(levels, level) {
			return settings{}, errors.New("Choose info or warning for the announcement.")
		}
		next.AnnouncementLevel = level
	}
	for _, s := range []struct {
		key    string
		target *bool
	}{{"portraitsPaused", &next.PortraitsPaused}, {"remindersPaused", &next.RemindersPaused}, {"pairingPaused", &next.PairingPaused}, {"readerPaused", &next.ReaderPaused}} {
		if b.has(s.key) {
			on, ok := b.boolean(s.key)
			if !ok {
				return settings{}, errors.New("Switches must be true or false.")
			}
			*s.target = on
		}
	}
	if b.has("adapters") {
		if next.Adapters, err = adapterSettings(b["adapters"]); err != nil {
			return settings{}, err
		}
	}
	if b.has("clock") {
		if next.Clock, err = clockSettings(b["clock"]); err != nil {
			return settings{}, err
		}
	}
	record.Set("odylePerCube", next.OdylePerCube)
	record.Set("dailyResetHour", next.DailyResetHour)
	record.Set("weeklyResetDay", next.WeeklyResetDay)
	record.Set("inactiveAccountDays", next.InactiveAccountDays)
	record.Set("dungeons", next.Dungeons)
	record.Set("announcement", next.Announcement)
	record.Set("announcementLevel", next.AnnouncementLevel)
	record.Set("portraitsPaused", next.PortraitsPaused)
	record.Set("remindersPaused", next.RemindersPaused)
	record.Set("pairingPaused", next.PairingPaused)
	record.Set("readerPaused", next.ReaderPaused)
	record.Set("adapters", map[string]any{"extra": next.Adapters.Extra, "disabled": next.Adapters.Disabled})
	record.Set("clock", next.Clock)
	if err := app.Save(record); err != nil {
		return settings{}, err
	}
	return readSettings(app), nil
}

// catalogName is the catalog spelling of a dungeon, the typed one while the catalog is
// empty, or nil when a catalog exists and does not list it.
func catalogName(app core.App, typed any) (*dungeonName, error) {
	d, err := dungeon(typed)
	if err != nil {
		return nil, err
	}
	entries := readSettings(app).Dungeons
	if len(entries) == 0 {
		return &d, nil
	}
	for _, entry := range entries {
		if strings.ToLower(entry.Name) == d.key {
			return &dungeonName{dungeon: entry.Name, key: d.key}, nil
		}
	}
	return nil, nil
}

// acceptedAdapters are the packet adapters whose readings are stored now.
func acceptedAdapters(app core.App) []string { return accepted(readSettings(app).Adapters) }

// announcement is the message clients show above their pages, or nil.
func announcement(s settings) any {
	if s.Announcement == "" {
		return nil
	}
	return map[string]any{"text": s.Announcement, "level": s.AnnouncementLevel}
}
