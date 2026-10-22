package odyle

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Validation of what clients send. Failures are plain errors; the routes answer
// them as 400 with the message.

// text is a required free text, trimmed and without invisible characters (#55).
func text(value any, name string, max int) (string, error) {
	s, ok := value.(string)
	s = visible(s)
	if !ok || trim(s) == "" || length(trim(s)) > max {
		return "", errors.New(name + " is required (max " + strconv.Itoa(max) + " characters).")
	}
	return trim(s), nil
}

const maxSafeInteger = 9007199254740991

func integer(value any, name string, min, max int64) (int64, error) {
	f, ok := value.(float64)
	if !ok || f != math.Trunc(f) || math.IsInf(f, 0) || math.Abs(f) > maxSafeInteger || f < float64(min) || f > float64(max) {
		return 0, errors.New(name + " must be an integer between " + strconv.FormatInt(min, 10) + " and " + strconv.FormatInt(max, 10) + ".")
	}
	return int64(f), nil
}

// GLOBAL_NA is NA-East (and NA characters saved before the split), GLOBAL_NAW NA-West (odyle-windows#4).
var regions = []string{"GLOBAL_EU", "GLOBAL_NA", "GLOBAL_NAW", "GLOBAL_SA", "GLOBAL_ASIA"}

type identity struct{ characterName, server, region string }

func characterIdentity(b body) (identity, error) {
	region, _ := b.text("region")
	if !contains(regions, region) {
		return identity{}, errors.New("Select a Global region.")
	}
	name, err := text(b["characterName"], "Character", 40)
	if err != nil {
		return identity{}, err
	}
	server, err := text(b["server"], "Server", 40)
	if err != nil {
		return identity{}, err
	}
	return identity{characterName: name, server: server, region: region}, nil
}

// A wishlist dungeon is free text. Inner whitespace collapses for display and the
// lowercase form is the key, so differently typed names land in one entry.
type dungeonName struct{ dungeon, key string }

func dungeon(value any) (dungeonName, error) {
	name, err := text(value, "Dungeon", 60)
	if err != nil {
		return dungeonName{}, err
	}
	name = collapse(name)
	return dungeonName{dungeon: name, key: strings.ToLower(name)}, nil
}

// A checklist task is free text (inner whitespace collapses) with a daily or weekly
// cadence, which decides the reset that clears it.
func task(title any, cadence any) (string, string, error) {
	c, _ := cadence.(string)
	if c != "daily" && c != "weekly" {
		return "", "", errors.New("Choose a daily or weekly task.")
	}
	t, err := text(title, "Task", 60)
	if err != nil {
		return "", "", err
	}
	return collapse(t), c, nil
}

// Display names are free text shown to room members; inner whitespace collapses.
func displayName(value any) (string, error) {
	name, err := text(value, "Display name", 40)
	return collapse(name), err
}

// The optional note of a planned run: missing, null or only spaces means no note.
func note(b body, key string) (string, error) {
	v := b[key]
	if s, ok := v.(string); v == nil || (ok && trim(s) == "") {
		return "", nil
	}
	n, err := text(v, "Note", 120)
	return collapse(n), err
}

// boardText is a room's information board: free text of up to 2,000 characters whose lines
// stay, without invisible characters, the spaces that end a line or more than one empty line in
// a row. Nothing but spaces is an empty board.
func boardText(value any) (string, error) {
	s, ok := value.(string)
	if !ok {
		return "", errors.New("The board must be text.")
	}
	lines, empty := []string{}, 0
	for _, line := range strings.Split(strings.ReplaceAll(strings.ReplaceAll(visible(s), "\r\n", "\n"), "\r", "\n"), "\n") {
		line = strings.TrimRightFunc(line, isSpace)
		if line == "" {
			empty++
			continue
		}
		if empty > 0 && len(lines) > 0 {
			lines = append(lines, "")
		}
		empty = 0
		lines = append(lines, line)
	}
	board := strings.Join(lines, "\n")
	if length(board) > 2000 {
		return "", errors.New("The board can be up to 2,000 characters.")
	}
	return board, nil
}

// A planned run starts at most an hour ago (late entries) and at most 60 days ahead.
func runStart(value any, now time.Time) (string, error) {
	s, _ := value.(string)
	at, ok := parseDate(s)
	if !ok {
		return "", errors.New("Choose when the run starts.")
	}
	if at.Before(now.Add(-time.Hour)) || at.After(now.Add(60*24*time.Hour)) {
		return "", errors.New("A run can start from an hour ago up to 60 days ahead.")
	}
	return at.UTC().Format(isoLayout), nil
}

// parseDate reads the date-time forms browsers send and accept: ISO 8601 with a 'T' or
// a space, optional seconds and fraction, and 'Z' or an offset (local time without
// one); a date alone is midnight UTC.
var dateForm = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$`)

func parseDate(s string) (time.Time, bool) {
	m := dateForm.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return time.Time{}, false
	}
	year, month, day, hour, minute, second, nanos := atoi(m[1]), atoi(m[2]), atoi(m[3]), atoi(m[4]), atoi(m[5]), atoi(m[6]), 0
	if m[7] != "" {
		nanos = atoi((m[7] + "000000000")[:9])
	}
	loc := time.Local
	switch {
	case m[4] == "", m[8] == "Z":
		loc = time.UTC
	case m[8] != "":
		offset := atoi(m[8][1:3])*3600 + atoi(m[8][4:6])*60
		if m[8][0] == '-' {
			offset = -offset
		}
		loc = time.FixedZone("", offset)
	}
	if month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 {
		return time.Time{}, false
	}
	t := time.Date(year, time.Month(month), day, hour, minute, second, nanos, loc)
	return t, t.Day() == day
}

func atoi(s string) int { v, _ := strconv.Atoi(s); return v }

// reading is a verified game reading: the character as the game names it, its Odyle,
// the packet adapter that decoded it and the reader session's sequence number.
type reading struct {
	identity
	value         int64
	parserVersion string
	sequence      int64
	parts         map[string]any // the game's two numbers {base, bonus}, nil when not sent
	kind          string         // what changed (readingKinds), "" when not sent
	delta         int64          // the change of the total for a regen, spend or item
}

// partsValue is the parts for a JSON field: null when the reading sent none (a nil map would be
// stored as {}).
func (r reading) partsValue() any {
	if r.parts == nil {
		return nil
	}
	return r.parts
}

// readingKinds say what a reading changed: the whole value (snapshot), nothing known before it
// (update), the natural pool's three-hourly tick (regen), a spend, or an item.
var readingKinds = []string{"snapshot", "update", "regen", "spend", "item"}

// readingParts reads what newer Windows apps send beside the total: the natural pool (base)
// and what items added (bonus), and the kind of change with its delta. Anything malformed,
// or parts that do not add up to the value, is left out rather than refused: the total is
// what counts.
func readingParts(b body, value int64) (map[string]any, string, int64) {
	var parts map[string]any
	base, baseErr := integer(b["base"], "Base", 0, 1000000)
	bonus, bonusErr := integer(b["bonus"], "Bonus", 0, 1000000)
	if baseErr == nil && bonusErr == nil && base+bonus == value {
		parts = map[string]any{"base": base, "bonus": bonus}
	}
	kind, _ := b.text("kind")
	if !contains(readingKinds, kind) {
		return parts, "", 0
	}
	delta, err := integer(b["delta"], "Delta", -1000000, 1000000)
	if err != nil || kind == "snapshot" {
		delta = 0
	}
	return parts, kind, delta
}

// validReading checks a reading of the Windows app against its reader session.
func validReading(b body, sessionId string, sequence int64, adapters []string) (reading, error) {
	if s, ok := b.text("sessionId"); !ok || s != sessionId {
		return reading{}, errors.New("Publisher session changed. Reconnect your client.")
	}
	seq, err := integer(b["sequence"], "Sequence", 1, maxSafeInteger)
	if err != nil {
		return reading{}, err
	}
	if seq <= sequence {
		return reading{}, errors.New("Outdated reading.")
	}
	if source, _ := b.text("source"); source != "packet" {
		return reading{}, errors.New("Odyle must come from game packets. Manual readings are disabled.")
	}
	parserVersion, err := text(b["parserVersion"], "Packet adapter", 80)
	if err != nil {
		return reading{}, err
	}
	if !contains(adapters, parserVersion) {
		return reading{}, errors.New("This packet adapter has not been validated for Global. No reading was saved.")
	}
	if !b.isTrue("confirmed") {
		return reading{}, errors.New("A verified packet observation is required.")
	}
	region, _ := b.text("region")
	if !contains(regions, region) {
		return reading{}, errors.New("Select a Global region.")
	}
	value, err := integer(b["value"], "Odyle", 0, 1000000)
	if err != nil {
		return reading{}, err
	}
	name, err := text(b["characterName"], "Character", 40)
	if err != nil {
		return reading{}, err
	}
	server, err := text(b["server"], "Server", 40)
	if err != nil {
		return reading{}, err
	}
	parts, kind, delta := readingParts(b, value)
	return reading{identity: identity{characterName: name, server: server, region: region}, value: value, sequence: seq, parserVersion: parserVersion, parts: parts, kind: kind, delta: delta}, nil
}
