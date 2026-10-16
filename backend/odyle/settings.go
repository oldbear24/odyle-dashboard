package odyle

import (
	"errors"
	"regexp"
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

type settings struct {
	OdylePerCube        int64        `json:"odylePerCube"`
	DailyResetHour      int64        `json:"dailyResetHour"`
	WeeklyResetDay      string       `json:"weeklyResetDay"`
	InactiveAccountDays int64        `json:"inactiveAccountDays"`
	Dungeons            []string     `json:"dungeons"`
	Announcement        string       `json:"announcement"`
	AnnouncementLevel   string       `json:"announcementLevel"`
	PortraitsPaused     bool         `json:"portraitsPaused"`
	RemindersPaused     bool         `json:"remindersPaused"`
	PairingPaused       bool         `json:"pairingPaused"`
	ReaderPaused        bool         `json:"readerPaused"`
	Adapters            adapterLists `json:"adapters"`
}

func defaultSettings() settings {
	return settings{OdylePerCube: 40, DailyResetHour: 7, WeeklyResetDay: "wednesday", Dungeons: []string{}, AnnouncementLevel: "info", Adapters: adapterLists{Extra: []string{}, Disabled: []string{}}}
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
		Dungeons: stringList(parseJSON(s.GetString("dungeons"), "[]")), Announcement: s.GetString("announcement"), AnnouncementLevel: s.GetString("announcementLevel"),
		PortraitsPaused: s.GetBool("portraitsPaused"), RemindersPaused: s.GetBool("remindersPaused"), PairingPaused: s.GetBool("pairingPaused"), ReaderPaused: s.GetBool("readerPaused")}
	if out.OdylePerCube == 0 {
		out.OdylePerCube = 40
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

// catalog keeps the first spelling of each dungeon; names match regardless of case and spacing.
func catalog(value any) ([]string, error) {
	names, ok := value.([]any)
	if !ok {
		return nil, errors.New("Dungeons must be a list of names.")
	}
	seen, out := map[string]bool{}, []string{}
	for _, name := range names {
		d, err := dungeon(name)
		if err != nil {
			return nil, err
		}
		if !seen[d.key] {
			seen[d.key] = true
			out = append(out, d.dungeon)
		}
	}
	if len(out) > 200 {
		return nil, errors.New("The dungeon list can hold up to 200 names.")
	}
	return out, nil
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
		if next.InactiveAccountDays, err = integer(b["inactiveAccountDays"], "Inactive account days", 0, 3650); err != nil {
			return settings{}, err
		}
		if next.InactiveAccountDays > 0 && next.InactiveAccountDays < 30 {
			return settings{}, errors.New("Delete inactive accounts after 30 days or more, or 0 to keep them.")
		}
	}
	if b.has("dungeons") {
		if next.Dungeons, err = catalog(b["dungeons"]); err != nil {
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
	names := readSettings(app).Dungeons
	if len(names) == 0 {
		return &d, nil
	}
	for _, name := range names {
		listed, err := dungeon(name)
		if err != nil {
			return nil, err
		}
		if listed.key == d.key {
			return &dungeonName{dungeon: name, key: d.key}, nil
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
