package odyle

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Party ready (#48): the odyle-party-ready job, every minute, looks at the planned runs from an
// hour before their start to half an hour after it. Once everyone in its party (two or more; those
// waiting for a place aside) plays live with enough Odyle for a cube at the run's cost, each of
// them is told once for that start time (room_runs.readyFor), on the account's topic (its Windows
// apps and open dashboards, by their channels) and by Web Push, unless they turned it off
// (kinds.ready) or it is their quiet hours.
// Only what the room already sees counts: presence from the readers' heartbeats and the readings.

// partyNotice is what an attendee is told.
type partyNotice struct {
	RunId    string `json:"runId"`
	RoomId   string `json:"roomId"`
	Room     string `json:"room"`
	Dungeon  string `json:"dungeon"`
	StartsAt string `json:"startsAt"`
	Of       int    `json:"of"`
}

// readyNow counts the members of a run's party (runParty: those waiting for a place aside) whose
// character plays live now with enough for a cube.
func readyNow(r *Run, party []string, entries []readyEntry, users map[string]string, at time.Time, cost int64) (ready, of int) {
	picks := r.Picks()
	for _, member := range party {
		user, known := users[member]
		if !known {
			continue
		}
		of++
		if c := broughtBy(user, entries, at, picks[member]); c != nil && readyState(*c, at) == "live" && c.Value >= cost {
			ready++
		}
	}
	return ready, of
}

func partyReady(app core.App) (result, error) {
	at, out := time.Now(), result{}
	found, err := app.FindRecordsByFilter("room_runs", "startsAt > {:since} && startsAt <= {:until}", "startsAt", 200, 0,
		dbx.Params{"since": stamp(at.Add(-30 * time.Minute)), "until": stamp(at.Add(time.Hour))})
	if err != nil {
		return out, err
	}
	runs := views[Run](found)
	rooms, err := roomsByID(app, pluck(runs, (*Run).Room))
	if err != nil {
		return out, err
	}
	rules := readSettings(app)
	for _, r := range runs {
		room := rooms[r.Room()]
		party, _ := runParty(rules, r)
		if room == nil || len(party) < 2 || r.GetString("readyFor") == r.StartsAt() {
			continue
		}
		entries, users, err := roomEntries(app, room.Id)
		if err != nil {
			out.fail(err.Error())
			continue
		}
		ready, of := readyNow(r, party, entries, users, at, runCost(rules, r.Dungeon()))
		if of < 2 || ready < of {
			continue
		}
		// Marked first, with only this field: a run edited meanwhile keeps its changes, and a failed
		// delivery is not repeated every minute.
		if _, err := app.DB().NewQuery("UPDATE room_runs SET readyFor = {:start} WHERE id = {:id}").Bind(dbx.Params{"start": r.StartsAt(), "id": r.Id}).Execute(); err != nil {
			out.fail(err.Error())
			continue
		}
		notice := partyNotice{RunId: r.Id, RoomId: room.Id, Room: room.Name(), Dungeon: r.Dungeon(), StartsAt: r.StartsAt(), Of: of}
		for _, member := range party {
			user, err := app.FindRecordById("users", users[member])
			if err != nil {
				continue
			}
			n := notificationsOf(user)
			if (n.Kinds.Ready != nil && !*n.Kinds.Ready) || n.quietAt(at) {
				continue
			}
			changes(app).user(app, user.Id, func(news *userNews) { news.partyReady = append(news.partyReady, notice) })
			pushPartyReady(app, user, n, notice)
		}
		out.Done++
	}
	return out, nil
}

// pushPartyReady tells an attendee by Web Push when the account wants that (push.go).
var pushPartyReady = func(core.App, *core.Record, notificationSettings, partyNotice) {}
