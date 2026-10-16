package odyle

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The Odyle clock on the server: the projection the dashboard (src/clock.js) and the Windows
// app make from a character's last reading, used to check the clock against login readings
// and for cap alerts. A character's natural pool gains a tick at each of the rules' UTC hours
// until its cap; items' Odyle never regenerates.

// clockTicks lists the tick times after from up to and including until, at most limit.
func clockTicks(from, until time.Time, hours []int64, limit int) []time.Time {
	out := []time.Time{}
	on := map[int]bool{}
	for _, h := range hours {
		on[int(h)] = true
	}
	for at := from.UTC().Truncate(time.Hour).Add(time.Hour); !at.After(until) && len(out) < limit; at = at.Add(time.Hour) {
		if on[at.Hour()] {
			out = append(out, at)
		}
	}
	return out
}

// capsFor lists the caps a character's fullest natural pool of the last 30 days fits under,
// smallest first: one when its readings settled it (it held more than the smaller caps),
// more while they did not.
func capsFor(naturalMax int64, caps []int64) []int64 {
	out := []int64{}
	for _, c := range caps {
		if c >= naturalMax {
			out = append(out, c)
		}
	}
	if len(out) == 0 && len(caps) > 0 {
		out = append(out, caps[len(caps)-1])
	}
	return out
}

// tickFor is the size of the character's last regeneration tick, else the rules'.
func tickFor(regenTick int64, rules clockRules) int64 {
	if regenTick > 0 {
		return regenTick
	}
	return rules.Tick
}

// projectBase is a natural pool after the given ticks: a pool at or over its cap stays.
func projectBase(base, ticks, tick, limit int64) int64 {
	if base >= limit {
		return base
	}
	return min(limit, base+ticks*tick)
}

type storedParts struct {
	Base  *int64 `json:"base"`
	Bonus *int64 `json:"bonus"`
}

// naturalPool is the natural pool of the character's last reading, if that reading sent it.
func (c *Character) naturalPool() (int64, bool) {
	var p storedParts
	if json.Unmarshal([]byte(c.GetString("parts")), &p) != nil || p.Base == nil || p.Bonus == nil {
		return 0, false
	}
	return *p.Base, true
}

// clockCheck is one login reading compared with the clock's projection.
type clockCheck struct {
	at      time.Time
	matched bool
}

const clockChecksKept = 7 * 24 * time.Hour

// checkClock compares a snapshot (what the game sends at login) after at least one tick
// with what the clock projected from the character's previous reading: the pool matches
// when it equals the projection under one of the caps the character may have. A spend
// on a PC without the reader is a miss too, so only many misses at once mean the rules
// are off (a game patch that moved the schedule).
func checkClock(app core.App, before *Character, from time.Time, r reading, at time.Time) {
	base, ok := r.parts["base"].(int64)
	if r.kind != "snapshot" || !ok {
		return
	}
	prev, ok := before.naturalPool()
	if !ok || from.IsZero() {
		return
	}
	rules := loadSettings(app).Clock
	if rules.Paused {
		return
	}
	ticks := int64(len(clockTicks(from, at, rules.TickHours, 60*8)))
	if ticks == 0 {
		return
	}
	matched := false
	for _, limit := range capsFor(before.GetInt64("naturalMax"), rules.Caps) {
		if projectBase(prev, ticks, tickFor(before.GetInt64("regenTick"), rules), limit) == base {
			matched = true
		}
	}
	h := healthOf(app)
	h.mu.Lock()
	defer h.mu.Unlock()
	kept := h.clock[:0]
	for _, c := range h.clock {
		if at.Sub(c.at) < clockChecksKept {
			kept = append(kept, c)
		}
	}
	h.clock = append(kept, clockCheck{at, matched})
}

// clockHealth counts the checks of the last 7 days and of the last 24 hours; most of at
// least 5 checks of a day missing is a problem for the operator.
func clockHealth(app core.App, at time.Time) (*object, map[string]string) {
	h := healthOf(app)
	week, matched, day, missed := 0, 0, 0, 0
	h.mu.Lock()
	for _, c := range h.clock {
		if at.Sub(c.at) >= clockChecksKept {
			continue
		}
		week++
		if c.matched {
			matched++
		}
		if at.Sub(c.at) < 24*time.Hour {
			day++
			if !c.matched {
				missed++
			}
		}
	}
	h.mu.Unlock()
	problems := map[string]string{}
	if day >= 5 && missed*2 > day {
		problems["clock"] = fmt.Sprintf("Odyle alert: %d of %d login readings in the last 24 hours did not match the Odyle clock. A game patch may have changed the regeneration: check its rules under Game settings, or hide the Odyle clock there until they are right.", missed, day)
	}
	return newObject().set("checked", week).set("matched", matched).set("checkedToday", day).set("missedToday", missed), problems
}
