package odyle

import (
	"encoding/json"
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Typed views of the records Odyle reads and writes (PocketBase record proxies), so the
// compiler checks the field names and types the code uses. A view wraps the record it was
// made from: app.Save(view) saves that record with every record hook, and the record's
// own methods (Id, PublicExport, Set, …) stay available. The collections are created by
// the migrations (backend/migrations). Times read as they are stored ('2026-10-13
// 21:40:00.000Z'), which is also how answers carry them; timeOf reads one as a time.

// viewOf wraps a record into its typed view, for example viewOf[Character](e.Record).
func viewOf[T any, P interface {
	*T
	core.RecordProxy
}](r *core.Record) P {
	p := P(new(T))
	p.SetProxyRecord(r)
	return p
}

// views wraps records into their typed view.
func views[T any, P interface {
	*T
	core.RecordProxy
}](records []*core.Record) []P {
	out := make([]P, len(records))
	for i, r := range records {
		out[i] = viewOf[T, P](r)
	}
	return out
}

// findAs loads one record of a collection into its typed view.
func findAs[T any, P interface {
	*T
	core.RecordProxy
}](app core.App, collection, id string) (P, error) {
	r, err := app.FindRecordById(collection, id)
	if err != nil {
		return nil, err
	}
	return viewOf[T, P](r), nil
}

// firstAs finds the record of a collection whose field has the value, in its typed view.
func firstAs[T any, P interface {
	*T
	core.RecordProxy
}](app core.App, collection, field string, value any) (P, error) {
	r, err := app.FindFirstRecordByData(collection, field, value)
	if err != nil {
		return nil, err
	}
	return viewOf[T, P](r), nil
}

// whereAs finds up to 500 records of a collection by filter, in id order (list), in their typed view.
func whereAs[T any, P interface {
	*T
	core.RecordProxy
}](app core.App, collection, filter string, params dbx.Params) ([]P, error) {
	found, err := list(app, collection, filter, params)
	return views[T, P](found), err
}

// allAs finds every record of a collection by filter, oldest first (all), in their typed view.
func allAs[T any, P interface {
	*T
	core.RecordProxy
}](app core.App, collection, filter string, params dbx.Params) ([]P, error) {
	found, err := all(app, collection, filter, params)
	return views[T, P](found), err
}

// newAs starts a new record of a collection in its typed view.
func newAs[T any, P interface {
	*T
	core.RecordProxy
}](app core.App, collection string) (P, error) {
	r, err := newRecord(app, collection)
	if err != nil {
		return nil, err
	}
	return viewOf[T, P](r), nil
}

// timeOf reads a stored time; an empty one is the zero time.
func timeOf(stored string) time.Time {
	at, _ := types.ParseDateTime(stored)
	return at.Time()
}

// Account is an Odyle account (users, PocketBase's auth collection).
type Account struct{ core.BaseRecordProxy }

func (a *Account) DisplayName() string  { return a.GetString("displayName") }
func (a *Account) LastActiveAt() string { return a.GetString("lastActiveAt") }
func (a *Account) Created() string      { return a.GetString("created") }

func (a *Account) SetDisplayName(name string) { a.Set("displayName", name) }

// MarkActive notes that the account used Odyle now (see touch).
func (a *Account) MarkActive() { a.Set("lastActiveAt", now()) }

// Character is a saved game character of an account (characters).
type Character struct{ core.BaseRecordProxy }

func (c *Character) User() string           { return c.GetString("user") }
func (c *Character) Name() string           { return c.GetString("characterName") }
func (c *Character) Server() string         { return c.GetString("server") }
func (c *Character) Region() string         { return c.GetString("region") }
func (c *Character) Value() int64           { return c.GetInt64("value") }
func (c *Character) Confirmed() bool        { return c.GetBool("confirmed") }
func (c *Character) Valid() bool            { return c.GetBool("valid") }
func (c *Character) ParserVersion() string  { return c.GetString("parserVersion") }
func (c *Character) ReadingSession() string { return c.GetString("readingSession") }
func (c *Character) LastSeenAt() string     { return c.GetString("lastSeenAt") }
func (c *Character) LastReadingAt() string  { return c.GetString("lastReadingAt") }
func (c *Character) Portrait() string       { return c.GetString("portrait") }
func (c *Character) PortraitHash() string   { return c.GetString("portraitHash") }
func (c *Character) Created() string        { return c.GetString("created") }

func (c *Character) SetUser(id string) { c.Set("user", id) }
func (c *Character) SetIdentity(i identity) {
	c.Set("characterName", i.characterName)
	c.Set("server", i.server)
	c.Set("region", i.region)
}
func (c *Character) SetValid(valid bool) { c.Set("valid", valid) }

// SetPortrait stores the game's portrait (a file to upload) with its image's digest.
func (c *Character) SetPortrait(file any, hash string) {
	c.Set("portrait", file)
	c.Set("portraitHash", hash)
}

// PortraitChecked notes a portrait lookup now, whatever it found.
func (c *Character) PortraitChecked() { c.Set("portraitCheckedAt", now()) }

// PortraitMisses counts the lookups in a row the official search did not list the character.
func (c *Character) PortraitMisses() int { return c.GetInt("portraitMisses") }

// PortraitListed notes whether the official search listed the character: the portrait
// job tries again later each time it did not.
func (c *Character) PortraitListed(listed bool) {
	if listed {
		c.Set("portraitMisses", 0)
	} else {
		c.Set("portraitMisses", c.PortraitMisses()+1)
	}
}

// SetLastSeenAt shows a later heartbeat in an answer (present); it is written separately.
func (c *Character) SetLastSeenAt(at time.Time) {
	if when, err := types.ParseDateTime(at); err == nil {
		c.Set("lastSeenAt", when)
	}
}

// Read stores a verified game reading that a reader session sent and answers whether
// the value changed (a first reading included). lastReadingAt marks the last change, so
// a value sent again unchanged (the reader resumed after a pause) keeps its time;
// lastSeenAt is now either way.
func (c *Character) Read(r reading, session string) (changed bool) {
	changed = !c.Confirmed() || c.Value() != r.value
	if changed {
		c.Set("lastReadingAt", now())
	}
	c.Set("value", r.value)
	// The game's two numbers, or none when this reading did not send them.
	c.Set("parts", r.partsValue())
	c.learn(r)
	c.Set("confirmed", true)
	// A reading shows the character has Odyle after all (odyle-windows#6).
	c.Set("odyleLocked", false)
	c.SetValid(true)
	c.Set("source", "packet")
	c.Set("parserVersion", r.parserVersion)
	c.Set("lastSeenAt", now())
	c.Set("readingSession", session)
	return changed
}

// learn keeps what the character's readings showed about its natural pool, for the Odyle
// clock: the size of its last regeneration tick, and its fullest natural pool of the last
// 30 days (an older one gives way to the next reading), which tells clients its cap.
func (c *Character) learn(r reading) {
	if r.kind == "regen" && r.delta > 0 && r.delta <= 1000 {
		c.Set("regenTick", r.delta)
	}
	base, ok := r.parts["base"].(int64)
	if !ok {
		return
	}
	if base > c.GetInt64("naturalMax") || c.GetDateTime("naturalMaxAt").Time().Before(time.Now().Add(-30*24*time.Hour)) {
		c.Set("naturalMax", base)
		c.Set("naturalMaxAt", now())
	}
}

// HistoryPoint is one change of a character's Odyle (character_readings), with the
// packet adapter that decoded it.
type HistoryPoint struct{ core.BaseRecordProxy }

func (p *HistoryPoint) Character() string { return p.GetString("character") }
func (p *HistoryPoint) Value() int64      { return p.GetInt64("value") }
func (p *HistoryPoint) Adapter() string   { return p.GetString("adapter") }
func (p *HistoryPoint) At() string        { return p.GetString("created") }
func (p *HistoryPoint) Kind() string      { return p.GetString("kind") }
func (p *HistoryPoint) Delta() int64      { return p.GetInt64("delta") }
func (p *HistoryPoint) Parts() string     { return p.GetString("parts") }

// JSON is the point as history answers and the data export carry it.
func (p *HistoryPoint) JSON() map[string]any {
	return historyJSON(p.Value(), p.At(), p.Adapter(), p.Kind(), p.Delta(), p.Parts())
}

// historyJSON is a history point: its total, time and adapter, and from newer Windows apps
// the game's two numbers (parts, or null), what changed (kind, "" when not known) and the
// change of the total (delta, for a regen, spend or item; null otherwise).
func historyJSON(value int64, at, adapter, kind string, delta int64, parts string) map[string]any {
	var change any
	if kind == "regen" || kind == "spend" || kind == "item" {
		change = delta
	}
	return map[string]any{"value": value, "at": at, "adapter": adapter, "kind": kind, "delta": change, "parts": parseJSON(parts, "null")}
}

// Member is an account's membership of a room (room_members): its role and the
// characters it shares there.
type Member struct{ core.BaseRecordProxy }

func (m *Member) User() string                 { return m.GetString("user") }
func (m *Member) Room() string                 { return m.GetString("room") }
func (m *Member) Role() string                 { return m.GetString("role") }
func (m *Member) Shared() []string             { return stringSlice(m.Record, "sharedCharacters") }
func (m *Member) Shares(character string) bool { return contains(m.Shared(), character) }
func (m *Member) Created() string              { return m.GetString("created") }

func (m *Member) SetRole(role string)           { m.Set("role", role) }
func (m *Member) SetShared(characters []string) { m.Set("sharedCharacters", characters) }

// Room is a party room (party_rooms).
type Room struct{ core.BaseRecordProxy }

func (r *Room) Owner() string           { return r.GetString("owner") }
func (r *Room) Name() string            { return r.GetString("name") }
func (r *Room) DiscordWebhook() string  { return r.GetString("discordWebhook") }
func (r *Room) DiscordLanguage() string { return r.GetString("discordLanguage") }
func (r *Room) DiscordStartPost() bool  { return r.GetBool("discordStartPost") }

// DiscordLeads are the room's reminder times before a run in minutes, largest first; 15 until chosen.
func (r *Room) DiscordLeads() []int64 {
	var saved []int64
	_ = json.Unmarshal([]byte(r.GetString("discordLeads")), &saved)
	leads := []int64{}
	for _, lead := range saved {
		if slices.Contains(discordLeadChoices, lead) && !slices.Contains(leads, lead) && len(leads) < 3 {
			leads = append(leads, lead)
		}
	}
	if len(leads) == 0 {
		return []int64{15}
	}
	slices.Sort(leads)
	slices.Reverse(leads)
	return leads
}

func (r *Room) SetOwner(user string) { r.Set("owner", user) }
func (r *Room) SetName(name string)  { r.Set("name", name) }

// SetDiscord connects a channel webhook in a language, or disconnects it ("").
func (r *Room) SetDiscord(webhook, language string) {
	r.Set("discordWebhook", webhook)
	if language != "" {
		r.Set("discordLanguage", language)
	}
}

// Invite is a room's invite link for a role (room_invites); only its code's digest is
// stored. Links made before 1791763231 have no maker, label or use limit.
type Invite struct{ core.BaseRecordProxy }

func (i *Invite) Room() string         { return i.GetString("room") }
func (i *Invite) Role() string         { return i.GetString("role") }
func (i *Invite) ExpiresAt() time.Time { return i.GetDateTime("expiresAt").Time() }
func (i *Invite) CreatedBy() string    { return i.GetString("createdBy") }
func (i *Invite) Label() string        { return i.GetString("label") }
func (i *Invite) MaxUses() int64       { return i.GetInt64("maxUses") }
func (i *Invite) Uses() int64          { return i.GetInt64("uses") }
func (i *Invite) Created() string      { return i.GetString("created") }

// Open reports whether the link still lets someone join: not expired and, when it has
// a use limit, not used up.
func (i *Invite) Open(at time.Time) bool {
	return i.ExpiresAt().After(at) && (i.MaxUses() == 0 || i.Uses() < i.MaxUses())
}

// JSON is a link as its room owner's list shows it: never its code or digest.
func (i *Invite) JSON() map[string]any {
	return map[string]any{"id": i.Id, "role": i.Role(), "label": i.Label(), "expiresAt": i.GetString("expiresAt"), "maxUses": i.MaxUses(), "uses": i.Uses(), "created": i.Created()}
}

// PairingCode is a short-lived code that pairs a Windows app with an account
// (desktop_codes); only its digest is stored.
type PairingCode struct{ core.BaseRecordProxy }

func (p *PairingCode) User() string         { return p.GetString("user") }
func (p *PairingCode) ExpiresAt() time.Time { return p.GetDateTime("expiresAt").Time() }

// ReaderSession is a Windows app's reader session (publisher_sessions): its last
// reading's sequence and when it expires.
type ReaderSession struct{ core.BaseRecordProxy }

func (s *ReaderSession) User() string         { return s.GetString("user") }
func (s *ReaderSession) Device() string       { return s.GetString("device") }
func (s *ReaderSession) Sequence() int64      { return s.GetInt64("sequence") }
func (s *ReaderSession) AppVersion() string   { return s.GetString("appVersion") }
func (s *ReaderSession) ExpiresAt() time.Time { return s.GetDateTime("expiresAt").Time() }
func (s *ReaderSession) Created() string      { return s.GetString("created") }
func (s *ReaderSession) Updated() string      { return s.GetString("updated") } // the last stored contact

// Extend keeps the session for a day after its last contact.
func (s *ReaderSession) Extend() { s.Set("expiresAt", expiry(86400)) }

// Run is a planned run of a room (room_runs); planner and attendees are memberships.
type Run struct{ core.BaseRecordProxy }

func (r *Run) Room() string        { return r.GetString("room") }
func (r *Run) Dungeon() string     { return r.GetString("dungeon") }
func (r *Run) StartsAt() string    { return r.GetString("startsAt") }
func (r *Run) Note() string        { return r.GetString("note") }
func (r *Run) PlannedBy() string   { return r.GetString("plannedBy") }
func (r *Run) Attendees() []string { return stringSlice(r.Record, "attendees") }

func (r *Run) SetDungeon(name string)        { r.Set("dungeon", name) }
func (r *Run) SetNote(note string)           { r.Set("note", note) }
func (r *Run) SetAttendees(members []string) { r.Set("attendees", members) }

// SetStart moves the run; Discord announces it again (remindRuns).
func (r *Run) SetStart(startsAt string) {
	r.Set("startsAt", startsAt)
	r.Set("remindedAt", "")
}

// Reminded notes that Discord announced the run.
func (r *Run) Reminded() { r.Set("remindedAt", now()) }

// Picks maps a membership to the character it brings to the run.
func (r *Run) Picks() map[string]string {
	var picks map[string]string
	_ = json.Unmarshal([]byte(r.GetString("picks")), &picks)
	if picks == nil { // none saved: JSON null
		picks = map[string]string{}
	}
	return picks
}

// Wish is a member's entry on a room's dungeon wishlist (room_wishes); key groups the
// entries of one dungeon however its name was typed.
type Wish struct{ core.BaseRecordProxy }

func (w *Wish) Room() string    { return w.GetString("room") }
func (w *Wish) Member() string  { return w.GetString("member") }
func (w *Wish) Dungeon() string { return w.GetString("dungeon") }
func (w *Wish) Key() string     { return w.GetString("key") }
func (w *Wish) Created() string { return w.GetString("created") }

// Task is a daily or weekly task of an account's checklist (user_tasks).
type Task struct{ core.BaseRecordProxy }

func (t *Task) User() string    { return t.GetString("user") }
func (t *Task) Cadence() string { return t.GetString("cadence") }
func (t *Task) Position() int   { return t.GetInt("position") }

// Character is the character whose list the task is on, or "" for the account's own.
func (t *Task) Character() string { return t.GetString("character") }

func (t *Task) SetTitle(title string)    { t.Set("title", title) }
func (t *Task) SetPosition(position int) { t.Set("position", position) }

// SetDone checks the task now or clears it; clients show it done until the next reset.
func (t *Task) SetDone(done bool) {
	if done {
		t.Set("doneAt", now())
	} else {
		t.Set("doneAt", "")
	}
}

// Device is a paired Windows PC (desktop_devices); only its key's digest is stored.
type Device struct{ core.BaseRecordProxy }

func (d *Device) User() string       { return d.GetString("user") }
func (d *Device) Name() string       { return d.GetString("name") }
func (d *Device) PairedAt() string   { return d.GetString("created") }
func (d *Device) LastUsedAt() string { return d.GetString("lastUsedAt") }

func (d *Device) SetName(name string) { d.Set("name", name) }

// Used notes that the device signed in now.
func (d *Device) Used() { d.Set("lastUsedAt", now()) }

// The lookups most routes start from, typed.

func membershipsWhere(app core.App, filter string, params dbx.Params) ([]*Member, error) {
	return whereAs[Member](app, "room_members", filter, params)
}

func charactersWhere(app core.App, filter string, params dbx.Params) ([]*Character, error) {
	return whereAs[Character](app, "characters", filter, params)
}

// pluck is one value of each item, for example pluck(members, (*Member).Room).
func pluck[T any, V any](items []T, value func(T) V) []V {
	out := make([]V, len(items))
	for i, item := range items {
		out[i] = value(item)
	}
	return out
}

// byID loads the records of a collection with the given ids, by id, in their typed view.
func byID[T any, P interface {
	*T
	core.RecordProxy
}](app core.App, collection string, ids []string) (map[string]P, error) {
	out := map[string]P{}
	if len(ids) == 0 {
		return out, nil
	}
	found, err := app.FindRecordsByIds(collection, unique(ids))
	if err != nil {
		return nil, err
	}
	for _, r := range found {
		out[r.Id] = viewOf[T, P](r)
	}
	return out, nil
}

// roomsByID loads the rooms with the given ids.
func roomsByID(app core.App, ids []string) (map[string]*Room, error) {
	return byID[Room](app, "party_rooms", ids)
}

// displayNames maps account ids to the names rooms show.
func displayNames(app core.App, ids []string) (map[string]string, error) {
	accounts, err := byID[Account](app, "users", ids)
	out := make(map[string]string, len(accounts))
	for id, a := range accounts {
		out[id] = a.DisplayName()
	}
	return out, err
}
