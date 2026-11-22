package odyle

import (
	"strconv"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// daysOf is a number of days as a duration.
func daysOf(days int64) time.Duration { return time.Duration(days) * 24 * time.Hour }

// historyDays is the period a history request asks for (?days=), 1 day up to as long as
// the history is kept; 30 days, or all that is kept when that is less, when it asks for none.
func historyDays(e *core.RequestEvent, kept int64) int64 {
	days := min(defaultKeptDays, kept)
	if asked, err := strconv.ParseInt(e.Request.URL.Query().Get("days"), 10, 64); err == nil {
		days = max(1, min(asked, kept))
	}
	return days
}

// readableCharacter is the character a history request names, when the account may read it:
// its owner and members of rooms it is shared in may, like its current value.
func readableCharacter(e *core.RequestEvent) (*Character, error) {
	c, err := findAs[Character](e.App, "characters", e.Request.PathValue("id"))
	if err != nil {
		return nil, notFound("This character no longer exists.")
	}
	return c, seenBy(e.App, c, e.Auth.Id)
}

// history is a character's Odyle over the asked period (30 days unless ?days= asks for
// another, up to keepDays, how long Game settings keep it), oldest first. hourlyBefore is
// when changes start being listed one by one, thinnedTo what is kept of those before it.
func history(e *core.RequestEvent) error {
	return run(e, func() error {
		c, err := readableCharacter(e)
		if err != nil {
			return err
		}
		rules := readSettings(e.App)
		days := historyDays(e, rules.HistoryDays)
		readings, hourlyBefore, err := historyOf(e.App, c.Id, days)
		if err != nil {
			return err
		}
		var thinned any
		if hourlyBefore != "" {
			thinned = hourlyBefore
		}
		// The cap facts the clock needs (#42): the history's By week estimates the hours at the cap.
		return e.JSON(200, map[string]any{"character": map[string]any{"id": c.Id, "characterName": c.Name(), "value": c.Value(), "confirmed": c.Confirmed(), "level": c.GetInt64("level"), "className": c.GetString("className"), "answeredCap": c.GetInt64("answeredCap"), "naturalMax": c.GetInt64("naturalMax"), "regenTick": c.GetInt64("regenTick")}, "clock": rules.Clock, "readings": readings, "hourlyBefore": thinned, "thinnedTo": thinnedTo(days), "days": days, "keepDays": rules.HistoryDays, "serverNow": now()})
	})
}

// historyExact is how many of a character's latest changes its history lists one by
// one. Before the oldest of them, the period continues as the last change of each hour
// (each day for periods over historyHourly days), so a busy character keeps the start of
// its period: an answer of 30 days holds at most 1,721 points (30 days touch 721 hours),
// one of a year 1,366.
const historyExact, historyHourly = 1000, 31

// thinnedTo is what a history of days keeps of its earlier changes: each hour's or each day's last.
func thinnedTo(days int64) string {
	if days > historyHourly {
		return "day"
	}
	return "hour"
}

// historyOf is a character's changes of the last days, oldest first, and the time of
// the oldest change listed one by one when earlier ones were thinned to one an hour or
// a day (thinnedTo; empty when every change is listed).
func historyOf(app core.App, id string, days int64) ([]any, string, error) {
	since, bucket := ago(daysOf(days)), map[string]int{"hour": 13, "day": 10}[thinnedTo(days)]
	found, err := app.FindRecordsByFilter("character_readings", "character = {:id} && created >= {:since}", "-created", historyExact+1, 0, dbx.Params{"id": id, "since": since})
	if err != nil {
		return nil, "", err
	}
	points, readings, hourlyBefore := views[HistoryPoint](found), []any{}, ""
	if len(points) > historyExact {
		points = points[:historyExact]
		hourlyBefore = points[historyExact-1].At()
		// The bare value and adapter come from the row of MAX(created), each hour's (day's) last change.
		var hours []struct {
			Value   int64  `db:"value"`
			Adapter string `db:"adapter"`
			Kind    string `db:"kind"`
			Delta   int64  `db:"delta"`
			Parts   string `db:"parts"`
			At      string `db:"at"`
		}
		if err := app.DB().NewQuery("SELECT value, adapter, kind, delta, COALESCE(parts, 'null') AS parts, MAX(created) AS at FROM character_readings WHERE character = {:id} AND created >= {:since} AND created < {:before} GROUP BY substr(created, 1, {:bucket}) ORDER BY at").
			Bind(dbx.Params{"id": id, "since": since, "before": hourlyBefore, "bucket": bucket}).All(&hours); err != nil {
			return nil, "", err
		}
		for _, h := range hours {
			readings = append(readings, historyJSON(h.Value, h.At, h.Adapter, h.Kind, h.Delta, h.Parts))
		}
	}
	for i := len(points) - 1; i >= 0; i-- {
		readings = append(readings, points[i].JSON())
	}
	return readings, hourlyBefore, nil
}

// pageOf reads which page of a list a request asks for (?page=, 1 to a million) and how many
// items a page holds (?perPage=, 1 to 100, else fallback).
func pageOf(e *core.RequestEvent, fallback int) (page, perPage int) {
	q := e.Request.URL.Query()
	page, perPage = 1, fallback
	if n, err := strconv.Atoi(q.Get("page")); err == nil && n > 1 && n <= 1000000 {
		page = n
	}
	if n, err := strconv.Atoi(q.Get("perPage")); err == nil && n >= 1 && n <= 100 {
		perPage = n
	}
	return page, perPage
}

// pages is how many pages total items fill, at least one.
func pages(total, perPage int) int { return max(1, (total+perPage-1)/perPage) }

// historyChanges is one page of a character's changes over the asked period, newest first,
// each one by one (GET /api/odyle/history/{id}/changes?days=&page=&perPage=, 20 a page): the
// list of the history dialog, which pages through every change the chart may show thinned.
// change is how much each one moved the value from the change before it, null for the
// first of the period.
func historyChanges(e *core.RequestEvent) error {
	return run(e, func() error {
		c, err := readableCharacter(e)
		if err != nil {
			return err
		}
		kept := readSettings(e.App).HistoryDays
		days := historyDays(e, kept)
		page, perPage := pageOf(e, 20)
		params := dbx.Params{"id": c.Id, "since": ago(daysOf(days))}
		total, err := e.App.CountRecords("character_readings", dbx.NewExp("character = {:id} AND created >= {:since}", params))
		if err != nil {
			return err
		}
		// One more than the page: the change before its last one.
		found, err := e.App.FindRecordsByFilter("character_readings", "character = {:id} && created >= {:since}", "-created", perPage+1, (page-1)*perPage, params)
		if err != nil {
			return err
		}
		points, changes := views[HistoryPoint](found), []any{}
		for i, p := range points[:min(len(points), perPage)] {
			j := p.JSON()
			j["change"] = nil
			if i+1 < len(points) {
				j["change"] = p.Value() - points[i+1].Value()
			}
			changes = append(changes, j)
		}
		return e.JSON(200, map[string]any{"changes": changes, "page": page, "perPage": perPage, "total": total, "pages": pages(int(total), perPage), "days": days, "keepDays": kept, "serverNow": now()})
	})
}
