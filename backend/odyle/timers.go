package odyle

import (
	"fmt"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The timers page (/timers, src/timers.js): when the game's daily and weekly resets come, when
// the natural Odyle pool gains its next tick and how long one takes to fill, the weekly
// maintenance and what a cube of each dungeon costs. Open to anyone, signed in or not, and
// listed for search engines: it shows only the game rules superusers keep under Game settings,
// nothing of any account or character.

// gameRules is the public answer of GET /api/odyle/game.
func gameRules(app core.App) map[string]any {
	rules := readSettings(app)
	return map[string]any{
		"resets":       map[string]any{"dailyResetHour": rules.DailyResetHour, "weeklyResetDay": rules.WeeklyResetDay},
		"clock":        rules.Clock,
		"maintenance":  maintenanceOf(rules),
		"odylePerCube": rules.OdylePerCube,
		"catalog":      rules.Dungeons,
		"serverNow":    now(),
	}
}

// GET /api/odyle/game: the game rules for the timers page.
func gameRoute(e *core.RequestEvent) error {
	return e.JSON(200, gameRules(e.App))
}

// hourList names UTC hours as the timers page's text for readers without JavaScript does:
// "01:00, 04:00 and 07:00 UTC".
func hourList(hours []int64) string {
	names := make([]string, len(hours))
	for i, h := range hours {
		names[i] = fmt.Sprintf("%02d:00", h)
	}
	if len(names) < 2 {
		return strings.Join(names, "") + " UTC"
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1] + " UTC"
}

// timersText is what the timers page says before the dashboard runs, from the game rules.
func timersText(rules settings) string {
	day := capitalized(rules.WeeklyResetDay)
	text := fmt.Sprintf("The daily reset comes at %02d:00 UTC, the weekly reset on %s at the same hour.", rules.DailyResetHour, day)
	if !rules.Clock.Paused && len(rules.Clock.TickHours) > 0 {
		text += fmt.Sprintf(" The natural Odyle pool gains %d at %s.", rules.Clock.Tick, hourList(rules.Clock.TickHours))
	}
	return text
}
