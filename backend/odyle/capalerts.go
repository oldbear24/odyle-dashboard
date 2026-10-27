package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Cap alerts: the odyle-cap-alerts job (hourly at :05, after each regeneration tick) projects
// the natural pool of every character of the accounts that turned them on (notifications.go,
// kinds.cap) with the Odyle clock, and tells the owner once when it will be full within their
// number of ticks (capTicks, one by default: "spend before the next tick") and once when it is
// full and losing each tick, if it got there without the first. A pool that dropped again
// starts over. The state is kept per character (capAlert, hidden from every answer), so a
// restart does not repeat an alert. Alerts go to the owner only, on the account's topic (its
// Windows apps and open dashboards, by their channels) and by Web Push; never to a room or a
// Discord channel. In quiet hours none is sent; one still due comes after them. Characters
// not read for 30 days are left alone.
type capAlert struct {
	CharacterId   string `json:"characterId"`
	CharacterName string `json:"characterName"`
	State         string `json:"state"` // soon or full
	Base          int64  `json:"base"`  // the natural pool now, as projected
	Cap           int64  `json:"cap"`
	Settled       bool   `json:"settled"` // false: the cap may be a larger one
	Tick          int64  `json:"tick"`
	At            string `json:"at,omitempty"` // when the pool is full (soon)
}

const capAlertsFor = 30 * 24 * time.Hour

// capState projects a character's natural pool to the moment and says whether it is full
// ("full"), within capTicks ticks of its cap ("soon") or neither ("").
func capState(c *Character, rules clockRules, capTicks int64, at time.Time) (string, capAlert) {
	base, _, ok := c.naturalParts()
	from := c.GetDateTime("lastReadingAt").Time()
	if !ok || from.IsZero() || at.Sub(from) > capAlertsFor || len(rules.TickHours) == 0 {
		return "", capAlert{}
	}
	caps := capsFor(c.GetInt64("answeredCap"), c.GetInt64("naturalMax"), rules.Caps)
	if len(caps) == 0 {
		return "", capAlert{}
	}
	limit, tick := caps[0], tickFor(c.GetInt64("regenTick"), rules)
	now := projectBase(base, int64(len(clockTicks(from, at, rules.TickHours, 60*8))), tick, limit)
	alert := capAlert{CharacterId: c.Id, CharacterName: c.Name(), Base: now, Cap: limit, Settled: len(caps) == 1, Tick: tick}
	if now >= limit {
		alert.State = "full"
		return "full", alert
	}
	left := (limit - now + tick - 1) / tick
	if left > capTicks {
		return "", capAlert{}
	}
	due := clockTicks(at, at.Add(120*24*time.Hour), rules.TickHours, int(left))
	if len(due) == 0 {
		return "", capAlert{}
	}
	alert.State, alert.At = "soon", iso(due[len(due)-1])
	return "soon", alert
}

// capAlerts is the odyle-cap-alerts job.
func capAlerts(app core.App) (result, error) {
	rules := loadSettings(app).Clock
	if rules.Paused {
		return result{Skipped: "clock"}, nil
	}
	ids := []struct {
		Id string `db:"id"`
	}{}
	if err := app.DB().NewQuery("SELECT id FROM users WHERE json_extract(notifications, '$.kinds.cap') = 1").All(&ids); err != nil {
		return result{}, err
	}
	at, out := time.Now(), result{}
	for _, row := range ids {
		user, err := app.FindRecordById("users", row.Id)
		if err != nil {
			continue
		}
		n := notificationsOf(user)
		if !n.Kinds.Cap || n.quietAt(at) {
			continue
		}
		found, err := app.FindAllRecords("characters", dbx.HashExp{"user": user.Id})
		if err != nil {
			out.fail(err.Error())
			continue
		}
		for _, c := range views[Character](found) {
			state, alert := capState(c, rules, *n.CapTicks, at)
			before := c.GetString("capAlert")
			if state == before {
				continue
			}
			// Only the first of soon and full is told; a pool below the threshold starts over.
			if state != "" && before == "" {
				changes(app).user(app, user.Id, func(news *userNews) { news.capAlerts = append(news.capAlerts, alert) })
				pushCapAlert(app, user, n, alert)
				out.Done++
			}
			// Only this field: a reading saved meanwhile keeps its own.
			if _, err := app.DB().NewQuery("UPDATE characters SET capAlert = {:state} WHERE id = {:id}").Bind(dbx.Params{"state": state, "id": c.Id}).Execute(); err != nil {
				out.fail(err.Error())
			}
		}
	}
	return out, nil
}

// pushCapAlert sends the alert by Web Push when the account wants that (push.go).
var pushCapAlert = func(core.App, *core.Record, notificationSettings, capAlert) {}
