package odyle

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"time"
	_ "time/tzdata" // quiet hours name IANA time zones, which a minimal container may lack

	"github.com/pocketbase/pocketbase/core"
)

// An account's notification settings, kept on the dashboard (Account & data) and followed by
// every client: which notifications (planned runs at up to three lead times, Odyle cap alerts),
// where (the Windows app's tray, browser tabs with the permission, Web Push), how many ticks
// before the natural pool's cap a cap alert comes (0: when it is full) and quiet hours, a daily
// span in the account's time zone in which none is shown. Accounts that never saved any get the
// defaults: runs 15 minutes ahead everywhere, no cap alerts (one tick ahead once on), no quiet hours.
type notificationChannels struct {
	Tray    bool `json:"tray"`
	Browser bool `json:"browser"`
	Push    bool `json:"push"`
	// Discord: a mention in the room's Discord reminder of a run the account is going to (#34);
	// off until turned on, and left out by older clients.
	Discord bool `json:"discord"`
}

type notificationKinds struct {
	Runs bool `json:"runs"`
	Cap  bool `json:"cap"`
}

// From and To are "HH:MM" (both empty: no quiet hours); a span over midnight wraps.
type quietHours struct {
	From     string `json:"from"`
	To       string `json:"to"`
	TimeZone string `json:"timeZone"`
}

type notificationSettings struct {
	Channels    notificationChannels `json:"channels"`
	LeadMinutes []int64              `json:"leadMinutes"`
	Kinds       notificationKinds    `json:"kinds"`
	CapTicks    *int64               `json:"capTicks"` // left out by older clients: 1
	Quiet       quietHours           `json:"quiet"`
	Saved       bool                 `json:"saved"` // false: the defaults, never saved
}

func defaultNotifications() notificationSettings {
	one := int64(1)
	return notificationSettings{Channels: notificationChannels{Tray: true, Browser: true, Push: true}, LeadMinutes: []int64{15}, Kinds: notificationKinds{Runs: true}, CapTicks: &one}
}

var clockTime = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// checkNotifications validates settings sent by a client; leads are kept largest first.
func checkNotifications(n notificationSettings) (notificationSettings, error) {
	n.Saved = false
	if len(n.LeadMinutes) == 0 || len(n.LeadMinutes) > 3 {
		return n, errors.New("Choose one to three reminder times.")
	}
	for i, lead := range n.LeadMinutes {
		if lead < 1 || lead > 1440 {
			return n, errors.New("Reminders come 1 minute to 24 hours before a run.")
		}
		if slices.Contains(n.LeadMinutes[:i], lead) {
			return n, errors.New("Choose different reminder times.")
		}
	}
	n.LeadMinutes = slices.Clone(n.LeadMinutes)
	slices.Sort(n.LeadMinutes)
	slices.Reverse(n.LeadMinutes)
	ticks := int64(1)
	if n.CapTicks != nil {
		ticks = *n.CapTicks
	}
	if ticks < 0 || ticks > 8 {
		return n, errors.New("Cap alerts come 0 to 8 ticks before the cap.")
	}
	n.CapTicks = &ticks
	q := n.Quiet
	switch {
	case q.From == "" && q.To == "":
		n.Quiet = quietHours{}
	case q.From == "" || q.To == "":
		return n, errors.New("Set both ends of the quiet hours, or neither.")
	case !clockTime.MatchString(q.From) || !clockTime.MatchString(q.To):
		return n, errors.New("Quiet hours are times like 22:00.")
	case q.From == q.To:
		return n, errors.New("Quiet hours need different start and end times.")
	default:
		if _, err := time.LoadLocation(q.TimeZone); err != nil || q.TimeZone == "" || len(q.TimeZone) > 64 {
			return n, errors.New("Choose a time zone for the quiet hours.")
		}
	}
	return n, nil
}

// notificationsOf reads an account's settings, or the defaults when it has none (or they
// no longer check out).
func notificationsOf(user *core.Record) notificationSettings {
	var n notificationSettings
	raw := user.GetString("notifications")
	if raw == "" || raw == "null" || json.Unmarshal([]byte(raw), &n) != nil {
		return defaultNotifications()
	}
	checked, err := checkNotifications(n)
	if err != nil {
		return defaultNotifications()
	}
	checked.Saved = true
	return checked
}

// quietAt says whether a moment falls in the account's quiet hours.
func (n notificationSettings) quietAt(at time.Time) bool {
	if n.Quiet.From == "" {
		return false
	}
	zone, err := time.LoadLocation(n.Quiet.TimeZone)
	if err != nil {
		return false
	}
	local := at.In(zone)
	minute, from, to := local.Hour()*60+local.Minute(), minutesOf(n.Quiet.From), minutesOf(n.Quiet.To)
	if from < to {
		return minute >= from && minute < to
	}
	return minute >= from || minute < to
}

func minutesOf(hhmm string) int {
	h, _ := strconv.Atoi(hhmm[:2])
	m, _ := strconv.Atoi(hhmm[3:])
	return h*60 + m
}

// POST /api/odyle/notifications saves the account's settings as a whole and tells its open
// dashboards and Windows apps at once.
func notifications(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		raw, err := json.Marshal(b)
		if err != nil {
			return nil, err
		}
		var sent notificationSettings
		if json.Unmarshal(raw, &sent) != nil {
			return nil, errors.New("Notification settings must be an object of channels, leadMinutes, kinds, capTicks and quiet.")
		}
		checked, err := checkNotifications(sent)
		if err != nil {
			return nil, err
		}
		record, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		record.Set("notifications", checked)
		if err := app.Save(record); err != nil {
			return nil, err
		}
		checked.Saved = true
		changes(app).user(app, user.Id, func(n *userNews) { n.notifications = &checked })
		return map[string]any{"notifications": checked}, nil
	})
}
