package odyle

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// What goes out by Web Push (push.go): its texts in English or Czech, the subscription
// actions and the odyle-push job, which sends planned-run reminders.

// pushTexts are the push messages in each language; a subscription without one gets English.
var pushTexts = map[string]map[string]string{
	"en": {
		"run":       "%s starts in %s",
		"soon":      "%s caps soon",
		"soonBody":  "Its natural pool is full in about %d h; each tick of %d after that is lost.",
		"reachBody": "Its natural pool reaches %d in about %d h, full if that is its cap.",
		"full":      "%s is losing Odyle",
		"fullBody":  "Its natural pool is full: each tick of %d is lost until you spend some.",
		"atCapBody": "Its natural pool is at %d: if that is its cap, each tick of %d is lost.",
		"test":      "Odyle notifications work",
		"testBody":  "This device shows run reminders and cap alerts with the dashboard closed.",
		"minutes":   "%d min",
		"hours":     "%d h",
		"hoursMins": "%d h %d min",
		"ready":     "%s: the party is ready",
		"readyBody": "All %d going can claim a cube · %s",
		"call":      "%s calls the party to %s",
		"callBody":  "%s · starts in about %d min",
	},
	"cs": {
		"run":       "%s začíná za %s",
		"soon":      "%s brzy dosáhne stropu",
		"soonBody":  "Přirozená zásoba bude plná zhruba za %d h; každých %d potom propadá.",
		"reachBody": "Přirozená zásoba dosáhne %d zhruba za %d h, plná, pokud je to její strop.",
		"full":      "%s přichází o Odyle",
		"fullBody":  "Přirozená zásoba je plná: každých %d propadá, dokud něco neutratíš.",
		"atCapBody": "Přirozená zásoba je na %d: pokud je to její strop, každých %d propadá.",
		"test":      "Oznámení Odyle fungují",
		"testBody":  "Toto zařízení ukáže připomínky runů a upozornění na strop i se zavřeným dashboardem.",
		"minutes":   "%d min",
		"hours":     "%d h",
		"hoursMins": "%d h %d min",
		"ready":     "%s: parta je připravená",
		"readyBody": "Všech %d jdoucích si vezme kostku · %s",
		"call":      "%s svolává partu na %s",
		"callBody":  "%s · začíná zhruba za %d min",
	},
}

// partyReadyPush words a party-ready notice; its tag is the one open dashboards use.
func partyReadyPush(language string, n partyNotice) pushMessage {
	return pushMessage{Title: pushText(language, "ready", n.Dungeon), Body: pushText(language, "readyBody", n.Of, n.Room), Tag: "ready-" + n.RunId + "@" + n.StartsAt, Page: "#/room/" + n.RoomId}
}

// callPush words a call to a run (Run now); its tag is the one open dashboards use for invites.
func callPush(language string, n runInvite, at time.Time) pushMessage {
	minutes := 0
	if start, ok := parseDate(n.StartsAt); ok {
		minutes = max(0, int(math.Ceil(start.Sub(at).Minutes())))
	}
	return pushMessage{Title: pushText(language, "call", n.By, n.Dungeon), Body: pushText(language, "callBody", n.Room, minutes), Tag: "invite-" + n.RunId, Page: "#/room/" + n.RoomId}
}

func pushText(language, key string, args ...any) string {
	texts, ok := pushTexts[language]
	if !ok {
		texts = pushTexts["en"]
	}
	return fmt.Sprintf(texts[key], args...)
}

// capAlertPush words a cap alert; its tag is the one open dashboards use, so a browser shows it once.
func capAlertPush(language string, a capAlert, at time.Time) pushMessage {
	message := pushMessage{Tag: "cap-" + a.CharacterId + "-" + a.State, Page: "#/"}
	if a.State == "soon" {
		hours := 1
		if full, err := time.Parse(isoLayout, a.At); err == nil {
			hours = max(1, int(math.Ceil(full.Sub(at).Hours())))
		}
		message.Title = pushText(language, "soon", a.CharacterName)
		if a.Settled {
			message.Body = pushText(language, "soonBody", hours, a.Tick)
		} else {
			message.Body = pushText(language, "reachBody", a.Cap, hours)
		}
		return message
	}
	message.Title = pushText(language, "full", a.CharacterName)
	if a.Settled {
		message.Body = pushText(language, "fullBody", a.Tick)
	} else {
		message.Body = pushText(language, "atCapBody", a.Cap, a.Tick)
	}
	return message
}

// runPush words a run reminder; its tag is the dashboard's reminder key (src/notify.js).
func runPush(language string, r *Run, room string, roomId string, lead int64, left time.Duration) pushMessage {
	minutes := max(1, int(math.Ceil(left.Minutes())))
	span := pushText(language, "minutes", minutes)
	if minutes >= 60 && minutes%60 == 0 {
		span = pushText(language, "hours", minutes/60)
	} else if minutes >= 60 {
		span = pushText(language, "hoursMins", minutes/60, minutes%60)
	}
	body := room
	if r.Note() != "" {
		body += " · " + r.Note()
	}
	return pushMessage{Title: pushText(language, "run", r.Dungeon(), span), Body: body, Tag: fmt.Sprintf("%s@%s@%d", r.Id, r.StartsAt(), lead), Page: "#/room/" + roomId}
}

// pushReminders is the odyle-push job: each account going to a planned run that wants run
// reminders by push gets one at the smallest of its reminder times the run is within, once
// per start time (room_runs.pushed), and none in its quiet hours.
func pushReminders(app core.App) (result, error) {
	at, out := time.Now(), result{}
	found, err := app.FindRecordsByFilter("room_runs", "startsAt > {:now} && startsAt <= {:until}", "startsAt", 500, 0, dbx.Params{"now": stamp(at), "until": stamp(at.Add(24 * time.Hour))})
	if err != nil || len(found) == 0 {
		return out, err
	}
	runs := views[Run](found)
	members := []string{}
	for _, r := range runs {
		members = append(members, r.Attendees()...)
	}
	memberships, err := app.FindRecordsByIds("room_members", unique(members))
	if err != nil {
		return out, err
	}
	userOf := map[string]string{}
	for _, m := range memberships {
		userOf[m.Id] = m.GetString("user")
	}
	pushing := map[string]bool{}
	rows := []struct {
		User string `db:"user"`
	}{}
	if err := app.DB().NewQuery("SELECT DISTINCT user FROM push_subscriptions").All(&rows); err != nil {
		return out, err
	}
	for _, row := range rows {
		pushing[row.User] = true
	}
	rooms, err := roomsByID(app, pluck(runs, (*Run).Room))
	if err != nil {
		return out, err
	}
	settingsOf := map[string]*notificationSettings{}
	for _, r := range runs {
		start := r.GetDateTime("startsAt").Time()
		var pushed []string
		_ = json.Unmarshal([]byte(r.GetString("pushed")), &pushed)
		changed := false
		for _, member := range r.Attendees() {
			user := userOf[member]
			if !pushing[user] {
				continue
			}
			if settingsOf[user] == nil {
				record, err := app.FindRecordById("users", user)
				if err != nil {
					continue
				}
				n := notificationsOf(record)
				settingsOf[user] = &n
			}
			n := settingsOf[user]
			if !n.Kinds.Runs || !n.Channels.Push {
				continue
			}
			left := start.Sub(at)
			key := func(lead int64) string { return fmt.Sprintf("%s|%s|%d", user, r.StartsAt(), lead) }
			var within []int64
			for _, lead := range n.LeadMinutes {
				if left <= time.Duration(lead)*time.Minute {
					within = append(within, lead)
				}
			}
			if len(within) == 0 || slices.Contains(pushed, key(slices.Min(within))) {
				continue
			}
			for _, lead := range within {
				if !slices.Contains(pushed, key(lead)) {
					pushed = append(pushed, key(lead))
				}
			}
			changed = true
			if n.quietAt(at) {
				continue
			}
			room := ""
			if found := rooms[r.Room()]; found != nil {
				room = found.Name()
			}
			lead := slices.Min(within)
			sent, err := pushToAccount(app, user, *n, func(language string) pushMessage { return runPush(language, r, room, r.Room(), lead, left) }, left, true)
			if err != nil {
				out.fail("Push for run " + r.Id + " failed: " + message(err))
			}
			out.Done += sent
		}
		if !changed {
			continue
		}
		// Only reminders of the run's current start are kept.
		kept := slices.DeleteFunc(pushed, func(k string) bool { return !strings.Contains(k, "|"+r.StartsAt()+"|") })
		raw, _ := json.Marshal(kept)
		if _, err := app.DB().NewQuery("UPDATE room_runs SET pushed = {:pushed} WHERE id = {:id}").Bind(dbx.Params{"pushed": string(raw), "id": r.Id}).Execute(); err != nil {
			out.fail(err.Error())
		}
	}
	return out, nil
}

// The push actions: a browser turns push on or off for the account, or asks for a test.
const pushDevicesKept = 10

func pushSubscribe(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		endpoint, _ := b.text("endpoint")
		link, err := url.Parse(endpoint)
		if endpoint == "" || len(endpoint) > 1000 || err != nil || !pushEndpointAllowed(link) {
			return nil, errors.New("This browser's push service is not supported.")
		}
		keys, _ := b["keys"].(map[string]any)
		p256dh, _ := keys["p256dh"].(string)
		auth, _ := keys["auth"].(string)
		point, err1 := b64.DecodeString(strings.TrimRight(p256dh, "="))
		secret, err2 := b64.DecodeString(strings.TrimRight(auth, "="))
		if err1 != nil || err2 != nil || len(point) != 65 || point[0] != 4 || len(secret) != 16 {
			return nil, errors.New("The push subscription's keys are not valid.")
		}
		language, _ := b.text("language")
		if language != "cs" {
			language = "en"
		}
		device, _ := b.text("device")
		device = cut(collapse(trim(device)), 60)
		// A browser has one endpoint; turned on by another account, it moves here.
		sub, err := app.FindFirstRecordByData("push_subscriptions", "endpoint", endpoint)
		if err != nil {
			collection, err := app.FindCollectionByNameOrId("push_subscriptions")
			if err != nil {
				return nil, err
			}
			sub = core.NewRecord(collection)
			sub.Set("endpoint", endpoint)
		}
		sub.Set("user", user.Id)
		sub.Set("p256dh", b64.EncodeToString(point))
		sub.Set("auth", b64.EncodeToString(secret))
		sub.Set("language", language)
		sub.Set("device", device)
		if err := app.Save(sub); err != nil {
			return nil, err
		}
		// The oldest go beyond ten devices.
		all, err := app.FindRecordsByFilter("push_subscriptions", "user = {:user}", "-created", 0, 0, dbx.Params{"user": user.Id})
		if err != nil {
			return nil, err
		}
		for _, old := range all[min(len(all), pushDevicesKept):] {
			if err := app.Delete(old); err != nil {
				return nil, err
			}
		}
		notifyUsers(app, user.Id)
		return map[string]any{"push": pushState(app, user.Id)}, nil
	})
}

func pushUnsubscribe(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		endpoint, _ := b.text("endpoint")
		if _, err := app.DB().NewQuery("DELETE FROM push_subscriptions WHERE user = {:user} AND endpoint = {:endpoint}").Bind(dbx.Params{"user": user.Id, "endpoint": endpoint}).Execute(); err != nil {
			return nil, err
		}
		notifyUsers(app, user.Id)
		return map[string]any{"push": pushState(app, user.Id)}, nil
	})
}

// pushTest runs outside a transaction: it waits for the push services, and a device they
// forgot is removed for good.
func pushTest(e *core.RequestEvent) error {
	return run(e, func() error {
		n := defaultNotifications() // a test goes to every device, whatever the settings
		sent, err := pushToAccount(e.App, e.Auth.Id, n, func(language string) pushMessage {
			return pushMessage{Title: pushText(language, "test"), Body: pushText(language, "testBody"), Tag: "test", Page: "#/account"}
		}, 10*time.Minute, true)
		if sent == 0 {
			if err != nil {
				warn(e.App, "Odyle test push failed", "user", e.Auth.Id, "error", message(err))
			}
			return badRequest("No device of this account takes push notifications. Turn them on in this browser first.")
		}
		return e.JSON(200, map[string]any{"sent": sent, "push": pushState(e.App, e.Auth.Id)})
	})
}

// pushState is what the account page shows: the key browsers subscribe with ("" when the
// server has none) and the account's devices with push on.
func pushState(app core.App, user string) map[string]any {
	publicKey := ""
	if key, err := vapid(app); err == nil {
		publicKey = b64.EncodeToString(key.public)
	} else {
		warn(app, "Odyle has no VAPID key for Web Push", "error", message(err))
	}
	devices := []any{}
	if subs, err := app.FindRecordsByFilter("push_subscriptions", "user = {:user}", "-created", 0, 0, dbx.Params{"user": user}); err == nil {
		for _, s := range subs {
			devices = append(devices, map[string]any{"id": s.Id, "device": s.GetString("device"), "created": s.GetString("created"), "lastOkAt": s.GetString("lastOkAt")})
		}
	}
	return map[string]any{"publicKey": publicKey, "devices": devices}
}

// pushExport lists the account's push devices for its data export.
func pushExport(app core.App, user string) []any {
	out := []any{}
	if subs, err := app.FindRecordsByFilter("push_subscriptions", "user = {:user}", "created", 0, 0, dbx.Params{"user": user}); err == nil {
		for _, s := range subs {
			out = append(out, map[string]any{"device": s.GetString("device"), "language": s.GetString("language"), "endpoint": s.GetString("endpoint"), "created": s.GetString("created"), "lastOkAt": s.GetString("lastOkAt")})
		}
	}
	return out
}
