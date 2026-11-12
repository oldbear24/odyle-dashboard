package odyle

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The audit log (#55): what superusers did to Odyle, by whom and when. It records the game
// settings and server controls they saved, on the Odyle pages or under Collections →
// odyle_settings, with every value that changed and what it was before; the jobs they ran by
// hand; Update all apps now; and database vacuums. The Odyle page's Audit log lists it. Entries
// are kept in odyle_audit for a year (auditDays), then the expiry job deletes them. Only the
// server writes them: the API refuses to add, change or delete one, for superusers too.

const auditDays, auditPage = 365, 50

// What an entry records, and how the superuser did it: on the Odyle pages (their routes) or
// under Collections (PocketBase's record API).
const (
	auditSettings  = "settings"
	auditJob       = "job"
	auditUpdate    = "update-apps"
	auditVacuum    = "vacuum"
	viaOdyle       = "odyle"
	viaCollections = "collections"
)

// audit writes one entry: its kind, the superuser who did it (nil when none was signed in),
// how, a line that says what happened and the details of its kind.
func audit(app core.App, by *core.Record, kind, via, summary string, details any) error {
	collection, err := app.FindCachedCollectionByNameOrId("odyle_audit")
	if err != nil {
		return err
	}
	entry := core.NewRecord(collection)
	entry.Set("kind", kind)
	entry.Set("via", via)
	if by != nil {
		entry.Set("actor", by.Id)
		entry.Set("actorEmail", cut(by.Email(), 255))
	}
	entry.Set("summary", cut(summary, 1000))
	// Written here, not by the record: PocketBase encodes with encoding/json/v2, whose
	// omitempty drops an empty text a setting held before and keeps false and 0.
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	entry.Set("details", string(raw))
	return app.Save(entry)
}

// noted writes an entry of something already done (a job run, a vacuum): a log that fails
// only leaves a warning, since the action stands.
func noted(app core.App, by *core.Record, kind, summary string, details any) {
	if err := audit(app, by, kind, viaOdyle, summary, details); err != nil {
		warn(app, "Odyle could not write to the audit log", "kind", kind, "error", err.Error())
	}
}

// ---------------------------------------------------------------- settings

// auditFields are the settings in the order the Odyle pages show them, named as they name
// them; objects are compared field by field (clock.tick). A setting missing here is still
// recorded, after these and under its path.
var auditFields = []struct{ path, label string }{
	{"odylePerCube", "Odyle per cube"},
	{"dailyResetHour", "Daily reset (hour, UTC)"},
	{"weeklyResetDay", "Weekly reset day"},
	{"maintenance.day", "Weekly maintenance"},
	{"maintenance.hour", "Maintenance starts (hour, UTC)"},
	{"maintenance.hours", "Maintenance lasts (hours)"},
	{"inactiveAccountDays", "Delete inactive accounts after (days)"},
	{"historyDays", "Keep Odyle history (days)"},
	{"locationDays", "Keep places (days)"},
	{"pvpDays", "Keep PvP events (days)"},
	{"catalog", "Dungeon catalog"},
	{"classRoles", "Class roles"},
	{"maps", "Maps"},
	{"taskTemplates", "Global task list"},
	{"clock.tickHours", "Regeneration hours (UTC)"},
	{"clock.tick", "Odyle per tick"},
	{"clock.caps", "Natural pool caps"},
	{"clock.paused", "Hide the Odyle clock"},
	{"slots.dailySpins", "Free spins a day"},
	{"slots.perCharacter", "Spins per character read"},
	{"announcement", "Announcement"},
	{"announcementLevel", "Announcement style"},
	{"announcementFrom", "Announcement shown from"},
	{"announcementUntil", "Announcement shown until"},
	{"portraitsPaused", "Pause portrait refresh"},
	{"armoryPaused", "Pause the armory"},
	{"remindersPaused", "Pause Discord reminders"},
	{"pairingPaused", "Pause new pairings"},
	{"readerPaused", "Pause packet readers"},
	{"adapters.extra", "Also accept (packet adapters)"},
	{"adapters.disabled", "Switched-off packet adapters"},
	{"windowsBlocked", "Held-back Windows versions"},
}

// auditKeys name the entries of a list, so an entry whose details changed is one change
// rather than one removed and one added. Other lists compare their entries whole.
var auditKeys = map[string]func(map[string]any) string{
	"catalog":       func(e map[string]any) string { return strings.ToLower(fmt.Sprint(e["name"])) },
	"classRoles":    func(e map[string]any) string { return strings.ToLower(fmt.Sprint(e["class"])) },
	"maps":          func(e map[string]any) string { return fmt.Sprint(e["id"]) },
	"taskTemplates": func(e map[string]any) string { return strings.ToLower(fmt.Sprint(e["title"])) },
}

// settingChange is one setting a save changed: a value with what it was before, or the
// entries a list gained, lost and changed (with what they were) and whether the order of the
// entries it kept changed. Omitted counts the entries left out of a change too long to keep
// whole.
type settingChange struct {
	Field     string   `json:"field"`
	Label     string   `json:"label"`
	Before    any      `json:"before,omitempty"`
	After     any      `json:"after,omitempty"`
	Added     []any    `json:"added,omitempty"`
	Removed   []any    `json:"removed,omitempty"`
	Changed   []edited `json:"changed,omitempty"`
	Reordered bool     `json:"reordered,omitempty"`
	Omitted   int      `json:"omitted,omitempty"`
}

type edited struct {
	Before any `json:"before"`
	After  any `json:"after"`
}

func (c settingChange) list() bool {
	return c.Added != nil || c.Removed != nil || c.Changed != nil || c.Reordered
}

// flatten turns settings into their values by path, as the API writes them: objects one
// level deep (clock.tick), lists whole. `dungeons` is left out, the catalog's names again.
func flatten(s settings) map[string]any {
	top := map[string]any{}
	if raw, err := json.Marshal(s); err != nil || json.Unmarshal(raw, &top) != nil {
		return map[string]any{}
	}
	delete(top, "dungeons")
	out := map[string]any{}
	for key, value := range top {
		if inner, ok := value.(map[string]any); ok {
			for k, v := range inner {
				out[key+"."+k] = v
			}
			continue
		}
		out[key] = value
	}
	return out
}

func sameJSON(a, b any) bool {
	x, errA := json.Marshal(a)
	y, errB := json.Marshal(b)
	return errA == nil && errB == nil && string(x) == string(y)
}

// settingsChanges are the settings that differ between two versions, in page order.
func settingsChanges(before, after settings) []settingChange {
	was, is := flatten(before), flatten(after)
	paths, labels := []string{}, map[string]string{}
	for _, f := range auditFields {
		paths, labels[f.path] = append(paths, f.path), f.label
	}
	extra := []string{}
	for _, values := range []map[string]any{was, is} {
		for path := range values {
			if labels[path] == "" && !slices.Contains(extra, path) {
				extra = append(extra, path)
			}
		}
	}
	slices.Sort(extra)
	out := []settingChange{}
	for _, path := range append(paths, extra...) {
		a, b := was[path], is[path]
		if sameJSON(a, b) {
			continue
		}
		label := labels[path]
		if label == "" {
			label = path
		}
		listA, isListA := a.([]any)
		listB, isListB := b.([]any)
		if isListA || isListB {
			if c := listChange(path, label, listA, listB); c != nil {
				out = append(out, *c)
			}
			continue
		}
		out = append(out, settingChange{Field: path, Label: label, Before: a, After: b})
	}
	return out
}

// listChange compares the entries of a list before and after, nil when they are the same.
func listChange(path, label string, before, after []any) *settingChange {
	key := func(v any) string {
		if entry, ok := v.(map[string]any); ok && auditKeys[path] != nil {
			return auditKeys[path](entry)
		}
		raw, _ := json.Marshal(v)
		return string(raw)
	}
	// A key met again is numbered, so a list holding an entry twice still compares.
	keyed := func(list []any) ([]string, map[string]any) {
		order, by, seen := []string{}, map[string]any{}, map[string]int{}
		for _, v := range list {
			k := key(v)
			if seen[k]++; seen[k] > 1 {
				k += "\u0000" + strconv.Itoa(seen[k])
			}
			order, by[k] = append(order, k), v
		}
		return order, by
	}
	wasOrder, was := keyed(before)
	isOrder, is := keyed(after)
	c := settingChange{Field: path, Label: label}
	kept := []string{}
	for _, k := range isOrder {
		old, ok := was[k]
		if !ok {
			c.Added = append(c.Added, is[k])
			continue
		}
		kept = append(kept, k)
		if !sameJSON(old, is[k]) {
			c.Changed = append(c.Changed, edited{Before: old, After: is[k]})
		}
	}
	keptBefore := []string{}
	for _, k := range wasOrder {
		if _, ok := is[k]; ok {
			keptBefore = append(keptBefore, k)
		} else {
			c.Removed = append(c.Removed, was[k])
		}
	}
	c.Reordered = !slices.Equal(kept, keptBefore)
	if !c.list() {
		return nil
	}
	return &c
}

// shorten cuts a text to n characters, marking the cut.
func shorten(s string, n int) string {
	if length(s) <= n {
		return s
	}
	return cut(s, n-1) + "…"
}

// auditValue writes a value for a summary: switches as on and off, an empty value as none, a
// moment as its UTC date and time, other text quoted and cut to 60 characters.
func auditValue(v any) string {
	switch x := v.(type) {
	case nil:
		return "none"
	case bool:
		if x {
			return "on"
		}
		return "off"
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case string:
		if x == "" {
			return "none"
		}
		if at, err := time.Parse(isoLayout, x); err == nil {
			return at.UTC().Format("2006-01-02 15:04") + " UTC"
		}
		return "“" + shorten(x, 60) + "”"
	}
	raw, _ := json.Marshal(v)
	return shorten(string(raw), 60)
}

// plainEntries says whether a list's entries are plain values, which a summary names.
func plainEntries(lists ...[]any) bool {
	for _, list := range lists {
		for _, v := range list {
			switch v.(type) {
			case map[string]any, []any:
				return false
			}
		}
	}
	return true
}

// describe says in a few words what a change did.
func (c settingChange) describe() string {
	if !c.list() {
		if after, ok := c.After.(bool); ok {
			return c.Label + ": " + auditValue(after)
		}
		return c.Label + " " + auditValue(c.Before) + " → " + auditValue(c.After)
	}
	parts := []string{}
	if plainEntries(c.Added, c.Removed) {
		for _, v := range c.Added {
			parts = append(parts, "+"+strings.Trim(auditValue(v), "“”"))
		}
		for _, v := range c.Removed {
			parts = append(parts, "−"+strings.Trim(auditValue(v), "“”"))
		}
	} else {
		if n := len(c.Added); n > 0 {
			parts = append(parts, strconv.Itoa(n)+" added")
		}
		if n := len(c.Removed); n > 0 {
			parts = append(parts, strconv.Itoa(n)+" removed")
		}
	}
	if n := len(c.Changed); n > 0 {
		parts = append(parts, strconv.Itoa(n)+" changed")
	}
	if c.Reordered {
		parts = append(parts, "reordered")
	}
	return c.Label + ": " + strings.Join(parts, ", ")
}

// settingsSummary says in one line what a save changed: its first four changes, then how
// many more there are.
func settingsSummary(changes []settingChange) string {
	parts := []string{}
	for i, c := range changes {
		if i == 4 {
			more := len(changes) - i
			parts = append(parts, strconv.Itoa(more)+map[bool]string{true: " more change", false: " more changes"}[more == 1])
			break
		}
		parts = append(parts, c.describe())
	}
	return strings.Join(parts, " · ")
}

// auditDetailBytes is how much a settings entry keeps of its changes: more than any save of
// lists as long as they may be, unless nearly all of them are replaced at once.
const auditDetailBytes, auditKeptEntries = 400000, 20

// auditedSettings records what a save of the settings changed, by whom and how; a save that
// changed nothing records nothing.
func auditedSettings(app core.App, by *core.Record, via string, before, after settings) error {
	changes := settingsChanges(before, after)
	if len(changes) == 0 {
		return nil
	}
	summary := settingsSummary(changes)
	if raw, err := json.Marshal(changes); err != nil || len(raw) > auditDetailBytes {
		for i := range changes {
			c := &changes[i]
			for _, list := range []*[]any{&c.Added, &c.Removed} {
				if len(*list) > auditKeptEntries {
					c.Omitted += len(*list) - auditKeptEntries
					*list = (*list)[:auditKeptEntries]
				}
			}
			if len(c.Changed) > auditKeptEntries {
				c.Omitted += len(c.Changed) - auditKeptEntries
				c.Changed = c.Changed[:auditKeptEntries]
			}
		}
	}
	return audit(app, by, auditSettings, via, summary, map[string]any{"changes": changes})
}

// ---------------------------------------------------------------- other actions

// auditedJob records a job a superuser ran by hand, with what the run did.
func auditedJob(app core.App, by *core.Record, name string, out result) {
	summary := "Ran " + name + " by hand: "
	switch {
	case out.Skipped != "":
		summary += "skipped (" + out.Skipped + ")"
	case out.Failed > 0:
		summary += fmt.Sprintf("%d done, %d failed: %s", out.Done, out.Failed, out.Error)
	default:
		summary += fmt.Sprintf("%d done", out.Done)
	}
	noted(app, by, auditJob, summary, map[string]any{"job": name, "done": out.Done, "failed": out.Failed, "skipped": out.Skipped, "error": out.Error})
}

// auditedUpdate records Update all apps now: the version the apps were sent and how many
// connections heard it.
func auditedUpdate(app core.App, by *core.Record, version string, told int) {
	sent := "the newest release they find"
	if version != "" {
		sent = version
	}
	noted(app, by, auditUpdate, fmt.Sprintf("Asked every running Windows app to update now to %s: %d %s told", sent, told, map[bool]string{true: "connection", false: "connections"}[told == 1]),
		map[string]any{"version": version, "told": told})
}

// megabytes writes a size for a summary.
func megabytes(bytes int64) string {
	return strconv.FormatFloat(float64(bytes)/1e6, 'f', 1, 64) + " MB"
}

// auditedVacuum records a vacuum of one database, with the sizes before and after.
func auditedVacuum(app core.App, by *core.Record, name string, record *vacuumRecord) {
	file := databases[name].file
	summary := "Vacuumed " + file + ": " + megabytes(record.BeforeBytes) + " → " + megabytes(record.AfterBytes)
	if record.Error != "" {
		summary = "Vacuum of " + file + " failed: " + record.Error
	}
	noted(app, by, auditVacuum, summary, map[string]any{"database": name, "file": file, "ms": record.Ms, "beforeBytes": record.BeforeBytes, "afterBytes": record.AfterBytes, "error": record.Error})
}

// ---------------------------------------------------------------- reading it

// entryJSON is an entry as the audit route and the realtime records of odyle_audit name it.
func entryJSON(r *core.Record) map[string]any {
	return map[string]any{"id": r.Id, "created": r.GetString("created"), "kind": r.GetString("kind"), "via": r.GetString("via"),
		"actor": r.GetString("actor"), "actorEmail": r.GetString("actorEmail"), "summary": r.GetString("summary"), "details": parseJSON(r.GetString("details"), "{}")}
}

// matchingText matches entries whose summary, superuser email or details hold the word, in
// any case for Latin letters; wildcards in it are taken as they are.
func matchingText(word, param string) dbx.Expression {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(word) + "%"
	return dbx.NewExp("([[summary]] LIKE {:"+param+"} ESCAPE '\\' OR [[actorEmail]] LIKE {:"+param+"} ESCAPE '\\' OR [[details]] LIKE {:"+param+"} ESCAPE '\\')", dbx.Params{param: pattern})
}

// auditActors are the superusers the log names, the latest first, each with the email of
// their latest entry.
func auditActors(app core.App) ([]map[string]any, error) {
	rows := []struct {
		Actor string `db:"actor"`
		Email string `db:"actorEmail"`
		Last  string `db:"last"`
	}{}
	if err := app.DB().NewQuery("SELECT [[actor]], [[actorEmail]], MAX([[created]]) AS [[last]] FROM {{odyle_audit}} WHERE [[actor]] != '' GROUP BY [[actor]] ORDER BY [[last]] DESC LIMIT 100").All(&rows); err != nil {
		return nil, err
	}
	out := make([]map[string]any, len(rows))
	for i, row := range rows {
		out[i] = map[string]any{"id": row.Actor, "email": row.Email, "lastAt": row.Last}
	}
	return out, nil
}

// GET /api/odyle/admin/audit: the newest entries first, auditPage at a time, optionally of
// one kind (?kind=), one superuser (?actor=) or holding every word of ?q=. ?before= and
// ?beforeId=, the created and id of the last entry shown, continue with older ones.
func auditRoute(e *core.RequestEvent) error {
	query := e.Request.URL.Query()
	q := e.App.RecordQuery("odyle_audit")
	if kind := query.Get("kind"); kind != "" {
		q.AndWhere(dbx.HashExp{"kind": kind})
	}
	if actor := query.Get("actor"); actor != "" {
		q.AndWhere(dbx.HashExp{"actor": actor})
	}
	for i, word := range strings.Fields(cut(query.Get("q"), 200)) {
		q.AndWhere(matchingText(word, "q"+strconv.Itoa(i)))
	}
	if before := query.Get("before"); before != "" {
		q.AndWhere(dbx.NewExp("([[created]] < {:before} OR ([[created]] = {:before} AND [[id]] < {:beforeId}))", dbx.Params{"before": before, "beforeId": query.Get("beforeId")}))
	}
	records := []*core.Record{}
	if err := q.OrderBy("[[created]] DESC", "[[id]] DESC").Limit(auditPage + 1).All(&records); err != nil {
		return err
	}
	more := len(records) > auditPage
	if more {
		records = records[:auditPage]
	}
	entries := make([]map[string]any, len(records))
	for i, r := range records {
		entries[i] = entryJSON(r)
	}
	actors, err := auditActors(e.App)
	if err != nil {
		return err
	}
	return e.JSON(200, map[string]any{"serverNow": now(), "keptDays": auditDays, "entries": entries, "more": more, "actors": actors})
}

// lastSettingsChange is the newest entry of a settings save, for the settings pages, or nil.
func lastSettingsChange(app core.App) any {
	found, err := app.FindRecordsByFilter("odyle_audit", "kind = {:kind}", "-created", 1, 0, dbx.Params{"kind": auditSettings})
	if err != nil || len(found) == 0 {
		return nil
	}
	return entryJSON(found[0])
}

// watchAudit keeps the log the server's own and records what superusers change under
// Collections → odyle_settings, which the Odyle pages' routes do not see.
func watchAudit(app core.App) {
	refuse := func(e *core.RecordRequestEvent) error {
		return forbidden("The audit log is written by the server only: its entries cannot be added, changed or deleted.")
	}
	app.OnRecordCreateRequest("odyle_audit").BindFunc(refuse)
	app.OnRecordUpdateRequest("odyle_audit").BindFunc(refuse)
	app.OnRecordDeleteRequest("odyle_audit").BindFunc(refuse)
	// The settings in effect before and after: a record deleted, or a second one added, counts
	// as the change it makes.
	edited := func(e *core.RecordRequestEvent) error {
		before := loadSettings(e.App)
		if err := e.Next(); err != nil {
			return err
		}
		if err := auditedSettings(e.App, e.Auth, viaCollections, before, loadSettings(e.App)); err != nil {
			warn(e.App, "Odyle could not write a settings change to the audit log", "error", err.Error())
		}
		return nil
	}
	app.OnRecordCreateRequest("odyle_settings").BindFunc(edited)
	app.OnRecordUpdateRequest("odyle_settings").BindFunc(edited)
	app.OnRecordDeleteRequest("odyle_settings").BindFunc(edited)
}
