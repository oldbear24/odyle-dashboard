package odyle

import (
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// Runs outside Odyle (#35): a run can carry the link of its event elsewhere (Raid-Helper, Apollo,
// a Discord scheduled event), and each account can have a private calendar feed of the runs it
// is going to, for Google, Outlook or Apple Calendar to subscribe to. The feed's address holds a
// random token; only its digest is kept (users.calendarDigest), the request is not written to the
// activity log when it succeeds, and making a new address or stopping the feed ends the old one.
// The feed lists dungeon, room and time, never notes.

// eventLink checks a run's event link: an https address up to 300 characters, or "" for none.
func eventLink(value any) (string, error) {
	s, _ := value.(string)
	link := trim(s)
	if link == "" {
		return "", nil
	}
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || length(link) > 300 {
		return "", badRequest("An event link is an https address of up to 300 characters.")
	}
	return link, nil
}

// POST /api/odyle/calendar { enabled }: true makes a new feed address (any earlier one stops
// working) and answers its path once; false stops the feed.
func calendarFeed(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		on, ok := b.boolean("enabled")
		if !ok {
			return nil, badRequest("Send enabled: true or false.")
		}
		record, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		if !on {
			record.Set("calendarDigest", "")
			record.Set("calendarSince", "")
			return map[string]any{"calendar": map[string]any{"on": false}}, app.Save(record)
		}
		token := security.RandomString(40)
		record.Set("calendarDigest", security.SHA256(token))
		record.Set("calendarSince", now())
		if err := app.Save(record); err != nil {
			return nil, err
		}
		return map[string]any{"calendar": map[string]any{"on": true, "since": record.GetString("calendarSince")}, "path": "/api/odyle/calendar/" + token + ".ics"}, nil
	})
}

// calendarState is what Account & data shows of the feed.
func calendarState(user *core.Record) map[string]any {
	if user.GetString("calendarDigest") == "" {
		return map[string]any{"on": false}
	}
	return map[string]any{"on": true, "since": user.GetString("calendarSince")}
}

// icsText escapes a text value (RFC 5545) and icsLine folds a line at 75 octets.
func icsText(s string) string {
	return strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`).Replace(s)
}

func icsLine(line string) string {
	var b strings.Builder
	size := 0
	for _, r := range line {
		n := len(string(r))
		if size+n > 75 {
			b.WriteString("\r\n ")
			size = 1
		}
		b.WriteRune(r)
		size += n
	}
	return b.String()
}

func icsTime(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// GET /api/odyle/calendar/{file}: the feed of the account whose token the file names
// ("<token>.ics"): the runs it goes to from a day ago to 30 days ahead, refreshed hourly.
func calendarFile(e *core.RequestEvent) error {
	token := strings.TrimSuffix(e.Request.PathValue("file"), ".ics")
	if len(token) < 20 || len(token) > 80 {
		return notFound("This calendar does not exist.")
	}
	users, err := e.App.FindRecordsByFilter("users", "calendarDigest = {:digest}", "", 1, 0, dbx.Params{"digest": security.SHA256(token)})
	if err != nil || len(users) == 0 {
		return notFound("This calendar does not exist.")
	}
	user := users[0]
	memberships, err := membershipsWhere(e.App, "user = {:user}", dbx.Params{"user": user.Id})
	if err != nil {
		return err
	}
	mine, roomIds := map[string]string{}, []string{}
	for _, m := range memberships {
		mine[m.Room()] = m.Id
		roomIds = append(roomIds, m.Room())
	}
	lines := []string{"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Odyle//Runs feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Odyle runs", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"}
	at := time.Now()
	if len(roomIds) > 0 {
		rooms, err := roomsByID(e.App, roomIds)
		if err != nil {
			return err
		}
		found, err := e.App.FindAllRecords("room_runs", dbx.In("room", anys(roomIds)...), dbx.NewExp("startsAt > {:since} AND startsAt <= {:until}", dbx.Params{"since": stamp(at.Add(-24 * time.Hour)), "until": stamp(at.Add(30 * 24 * time.Hour))}))
		if err != nil {
			return err
		}
		for _, r := range views[Run](found) {
			start, ok := parseDate(r.StartsAt())
			if !ok || !contains(r.Attendees(), mine[r.Room()]) {
				continue
			}
			summary := r.Dungeon()
			if room := rooms[r.Room()]; room != nil {
				summary += " · " + room.Name()
			}
			event := []string{"BEGIN:VEVENT", "UID:" + r.Id + "@odyle", "DTSTAMP:" + icsTime(at), "DTSTART:" + icsTime(start), "DTEND:" + icsTime(start.Add(time.Hour)), "SUMMARY:" + icsText(summary)}
			if link := roomLink(e.App, r.Room()); link != "" {
				event = append(event, "URL:"+link)
			}
			if link := r.GetString("link"); link != "" {
				event = append(event, "DESCRIPTION:"+icsText(link))
			}
			lines = append(lines, append(event, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:"+icsText(summary), "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT")...)
		}
	}
	lines = append(lines, "END:VCALENDAR")
	for i, l := range lines {
		lines[i] = icsLine(l)
	}
	e.Response.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	e.Response.Header().Set("Cache-Control", "private, max-age=600")
	return e.String(200, strings.Join(lines, "\r\n")+"\r\n")
}
