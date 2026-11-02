package odyle

import (
	"strconv"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Your week in Odyle (/week, src/week.js): a reset week of the account's own characters summed
// up as the history's By week does (src/history.js weeklyLedger): what they spent and about how
// many cubes, what regenerated and what items added, what their natural pools lost at the cap,
// the days the reader read and the achievements reached, beside the week before. Only the account
// sees it; the page draws a picture and a text to share, made in the browser and sent nowhere
// unless the player posts them.

// weekLimit is how many reset weeks back the page goes at most; the history kept decides first.
const weekLimit = 12

// weeksBack is how many whole reset weeks before this one the history still holds.
func weeksBack(rules settings) int {
	return int(min(weekLimit, max(0, (rules.HistoryDays-7)/7)))
}

// GET /api/odyle/week?week=<n>: the account's reset week n weeks back (0, this week so far; without
// n, this week or, while it is under two days old, the one before): each of its characters read
// in that week with its readings of the week and the week before, from the last reading before
// them, and what the page counts them with.
func weekRoute(e *core.RequestEvent) error {
	return run(e, func() error {
		rules, at := readSettings(e.App), time.Now()
		current := weekStart(at, rules.DailyResetHour, rules.WeeklyResetDay)
		// Without a week, this one, or the one before while this one is under two days old.
		back, err := 0, error(nil)
		if asked := e.Request.URL.Query().Get("week"); asked != "" {
			back, err = strconv.Atoi(asked)
		} else if at.Sub(current) < 48*time.Hour && weeksBack(rules) > 0 {
			back = 1
		}
		if err != nil || back < 0 || back > weeksBack(rules) {
			return badRequest("That week is no longer kept.")
		}
		from := current.AddDate(0, 0, -7*back)
		until, since := from.AddDate(0, 0, 7), from.AddDate(0, 0, -7)
		owned, err := charactersWhere(e.App, "user = {:user}", dbx.Params{"user": e.Auth.Id})
		if err != nil {
			return err
		}
		characters := []any{}
		for _, c := range owned {
			records, err := e.App.FindRecordsByFilter("character_readings", "character = {:id} && created >= {:start} && created < {:until}", "created", 0, 0, dbx.Params{"id": c.Id, "start": stamp(since), "until": stamp(until)})
			if err != nil {
				return err
			}
			found, inWeek := views[HistoryPoint](records), false
			for _, p := range found {
				if p.At() >= stamp(from) {
					inWeek = true
				}
			}
			if !inWeek {
				continue
			}
			// The reading the two weeks start from.
			before, err := e.App.FindRecordsByFilter("character_readings", "character = {:id} && created < {:start}", "-created", 1, 0, dbx.Params{"id": c.Id, "start": stamp(since)})
			if err != nil {
				return err
			}
			points := append(views[HistoryPoint](before), found...)
			readings := make([]any, len(points))
			for i, p := range points {
				readings[i] = p.JSON()
			}
			characters = append(characters, map[string]any{"id": c.Id, "characterName": c.Name(), "server": c.Server(), "region": c.Region(), "className": c.GetString("className"), "level": c.GetInt("level"), "main": c.GetBool("main"),
				"answeredCap": c.GetInt64("answeredCap"), "naturalMax": c.GetInt64("naturalMax"), "regenTick": c.GetInt64("regenTick"), "readings": readings})
		}
		reached := []any{}
		for id, when := range progressOf(e.Auth).Unlocked {
			if when >= stamp(from) && when < stamp(until) {
				reached = append(reached, map[string]any{"id": id, "at": when})
			}
		}
		historyFrom := at.Add(-daysOf(rules.HistoryDays))
		return e.JSON(200, map[string]any{
			"week":         map[string]any{"from": stamp(from), "until": stamp(until), "back": back, "weeks": weeksBack(rules), "complete": !until.After(at), "previousKept": !since.Before(historyFrom)},
			"characters":   characters,
			"achievements": reached,
			"clock":        rules.Clock,
			"resets":       map[string]any{"dailyResetHour": rules.DailyResetHour, "weeklyResetDay": rules.WeeklyResetDay},
			"odylePerCube": rules.OdylePerCube,
			"serverNow":    now(),
		})
	})
}
