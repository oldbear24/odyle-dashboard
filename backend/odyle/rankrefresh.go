package odyle

import (
	"math"
	"strconv"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Keeping the top players current. The scout reads the gear of a class's top players again once
// it is scoutRebuild old (scout.go) and a reader's lookup keeps the row it opens current
// (keepRank), so on their own a top player's combat power could be two weeks old, and a character
// just below the top who grew past it would wait for the scout's searches to meet it again (they
// pass over a character checked in the last rankKeep). On top of that:
//
//   - The scout reads the info page of each character within its class's top rankLimit+rankMargin
//     again once its combat power is topRecheck old, the strongest first, one page a step, before
//     the characters Odyle's accounts play, the names and the searches: some 2,000 of its 7,000
//     pages a day, so the order of the top players and the characters about to enter it are at
//     most topRecheck old.
//   - A refresh of every character the armory knows: from ranksRefreshAt (odyle_settings) on,
//     every row read before it counts as old (staleBefore). The scout reads the info pages of the
//     top players first, then of every other character, the strongest first, and nothing else
//     until none is left (some 7,000 a day: the top of every class within the first day); the gear
//     of the top players and of the characters below the top read before it is read again too, as
//     old gear is (pendingBuilds, pendingPeers). A superuser starts one under Server status (after
//     a game patch) and may stop it; the server starts one by itself on a big change, at most once
//     in refreshQuiet: a character above the highest level the armory knew (the level cap rose,
//     noticeLevel), or at least driftShare of the last driftWindow top players re-read for their
//     age with their combat power changed by driftChange or more since the reading before, which
//     was topRecheck to twice that old (a patch that changed how combat power counts, or gear
//     everyone got: drifted).

const (
	topRecheck   = 3 * 24 * time.Hour // a top player's combat power is read again after
	rankMargin   = 250                // the characters below a class's top read as often, who may enter it
	recheckRetry = 6 * time.Hour      // a character whose re-reading failed is tried again after
	driftWindow  = 40                 // the last top players re-read that tell a big change
	driftShare   = 0.5                // the share of them that must have changed
	driftChange  = 0.05               // by this much or more, up or down
	refreshQuiet = 7 * 24 * time.Hour // the server starts no refresh within this of the last
)

// What started a refresh, as ranksRefreshWhy keeps it: a superuser, the level cap
// (refreshLevel + the level) or the top players' combat power (refreshPower + the percent
// that changed).
const (
	refreshByHand = "hand"
	refreshLevel  = "level:"
	refreshPower  = "power:"
)

// staleBefore is the stored form of the moment before which a row counts as old: d ago, or the
// start of a refresh after it.
func staleBefore(app core.App, d time.Duration) string {
	old := time.Now().Add(-d)
	if at := readSettings(app).refreshAt; at.After(old) {
		old = at
	}
	return stamp(old)
}

// startRefresh starts a refresh of every character the armory knows now, for why. It writes
// the two fields alone, so a superuser saving Server controls meanwhile keeps theirs.
func startRefresh(app core.App, why string) error {
	if err := markRefresh(app, stamp(time.Now()), why); err != nil {
		return err
	}
	s := stateOf(app).scout
	s.mu.Lock()
	s.drift = nil
	s.mu.Unlock()
	info(app, "The armory refreshes every character it knows", "why", why)
	return nil
}

// stopRefresh ends the refresh: rows read before it no longer count as old.
func stopRefresh(app core.App) error {
	if err := markRefresh(app, "", ""); err != nil {
		return err
	}
	info(app, "The armory's refresh was stopped")
	return nil
}

// markRefresh writes ranksRefreshAt and ranksRefreshWhy, keeping the settings first when none are
// kept yet.
func markRefresh(app core.App, at, why string) error {
	write := func() (int64, error) {
		res, err := app.DB().NewQuery("UPDATE odyle_settings SET ranksRefreshAt = {:at}, ranksRefreshWhy = {:why}").Bind(dbx.Params{"at": at, "why": why}).Execute()
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	}
	n, err := write()
	if err == nil && n == 0 {
		if _, err = writeSettings(app, body{}); err == nil {
			_, err = write()
		}
	}
	stateOf(app).settings.drop()
	return err
}

// noticeLevel starts a refresh when a character is above the highest level the armory knew: the
// level cap rose, and the level and combat power of every character it keeps are old. Before it
// knows rankLimit characters it starts none: the first ones a fresh server reads tell no cap.
func noticeLevel(app core.App, level int64) {
	s := stateOf(app).scout
	s.mu.Lock()
	known := s.topLevel
	s.mu.Unlock()
	if known == 0 {
		var kept int
		if err := app.DB().NewQuery("SELECT COALESCE(MAX(level), 0), COUNT(*) FROM armory_ranks WHERE hidden = FALSE").Row(&known, &kept); err != nil || kept < rankLimit {
			return
		}
	}
	s.mu.Lock()
	known = max(known, s.topLevel)
	s.topLevel = max(known, level)
	s.mu.Unlock()
	if level > known {
		if err := startRefresh(app, refreshLevel+strconv.FormatInt(level, 10)); err != nil {
			warn(app, "Odyle could not start a refresh of the top players", "error", message(err))
		}
	}
}

// drifted counts how a top player's combat power changed since its reading before toward a big
// change, and starts a refresh once at least driftShare of the last driftWindow changed by
// driftChange or more, unless one started less than refreshQuiet ago.
func (s *armoryScout) drifted(app core.App, before, after int64) {
	if before <= 0 || after <= 0 {
		return
	}
	s.mu.Lock()
	s.drift = append(s.drift, math.Abs(float64(after-before))/float64(before))
	if len(s.drift) > driftWindow {
		s.drift = s.drift[len(s.drift)-driftWindow:]
	}
	changed := 0
	for _, c := range s.drift {
		if c >= driftChange {
			changed++
		}
	}
	full := len(s.drift) == driftWindow
	s.mu.Unlock()
	if !full || float64(changed) < driftShare*driftWindow {
		return
	}
	if at := readSettings(app).refreshAt; !at.IsZero() && time.Since(at) < refreshQuiet {
		return
	}
	if err := startRefresh(app, refreshPower+strconv.Itoa(changed*100/driftWindow)); err != nil {
		warn(app, "Odyle could not start a refresh of the top players", "error", message(err))
	}
}

// recheck is a character whose combat power the scout reads again: its combat power before, and
// whether the change counts toward a big change (drifted).
type recheck struct {
	hit   scoutHit
	power int64
	drift bool
}

// nextRecheck is the next character whose combat power the scout reads again: one within its
// class's top rankLimit+rankMargin read topRecheck ago or before the refresh, the strongest first;
// else, while a refresh runs, any character read before it, the strongest first. One the scout
// tried in the last recheckRetry is passed over. A top player re-read for its age alone, whose
// reading before is at most twice topRecheck old, counts toward a big change.
func (s *armoryScout) nextRecheck(app core.App) (recheck, bool, error) {
	mark := readSettings(app).refreshAt
	old, recent := staleBefore(app, topRecheck), ago(2*topRecheck)
	top, err := topRows(app, rankLimit+rankMargin)
	if err != nil {
		return recheck{}, false, err
	}
	due := []recheck{}
	for _, r := range top {
		if r.CheckedAt < old {
			drift := r.Place <= rankLimit && r.CheckedAt >= recent && (mark.IsZero() || r.CheckedAt >= stamp(mark))
			due = append(due, recheck{hit: scoutHit{characterId: r.Id}, power: r.CombatPower, drift: drift})
		}
	}
	if !mark.IsZero() {
		rest := []string{}
		if err := app.DB().NewQuery("SELECT id FROM armory_ranks WHERE hidden = FALSE AND checkedAt < {:mark} ORDER BY combatPower DESC, id LIMIT {:picks}").
			Bind(dbx.Params{"mark": stamp(mark), "picks": scoutHits}).Column(&rest); err != nil {
			return recheck{}, false, err
		}
		for _, id := range rest {
			due = append(due, recheck{hit: scoutHit{characterId: id}})
		}
	}
	// due holds row ids so far: the first not tried lately, with its character.
	s.mu.Lock()
	picked := -1
	for i, d := range due {
		if s.try("recheck|"+d.hit.characterId, recheckRetry) {
			picked = i
			break
		}
	}
	s.mu.Unlock()
	if picked < 0 {
		return recheck{}, false, nil
	}
	next := due[picked]
	var row struct {
		Region      string `db:"region"`
		ServerId    int    `db:"serverId"`
		CharacterId string `db:"characterId"`
	}
	if err := app.DB().Select("region", "serverId", "characterId").From("armory_ranks").Where(dbx.HashExp{"id": next.hit.characterId}).One(&row); err != nil {
		if isNoRows(err) {
			return recheck{}, false, nil
		}
		return recheck{}, false, err
	}
	if !armoryIds.MatchString(row.CharacterId) || row.Region == "" {
		return recheck{}, false, nil
	}
	next.hit = scoutHit{region: row.Region, serverId: row.ServerId, characterId: row.CharacterId}
	return next, true, nil
}

// refreshStatus is the re-reading's part of Server status: how many characters within their
// class's top rankLimit+rankMargin are due to be re-read (rechecks) and how often each is
// (recheckDays), and the refresh, nil before the first: when it started, by whom (by: hand,
// level or power, with the level or the percent of the top players that changed), what it still
// reads (top: top players and rows: all characters read before it; gear: top players whose gear
// was read before it) and whether it is done.
func refreshStatus(app core.App) map[string]any {
	current := readSettings(app)
	out := map[string]any{"rechecks": 0, "recheckDays": int(topRecheck / (24 * time.Hour)), "refresh": nil}
	old := staleBefore(app, topRecheck)
	top, err := topRows(app, rankLimit+rankMargin)
	if err != nil {
		return out
	}
	rechecks := 0
	for _, r := range top {
		if r.CheckedAt < old {
			rechecks++
		}
	}
	out["rechecks"] = rechecks
	if current.refreshAt.IsZero() {
		return out
	}
	mark := stamp(current.refreshAt)
	stale, gear := 0, 0
	for _, r := range top {
		if r.Place > rankLimit {
			continue
		}
		if r.CheckedAt < mark {
			stale++
		}
		if r.BuiltAt < mark {
			gear++
		}
	}
	var rows int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_ranks WHERE hidden = FALSE AND checkedAt < {:mark}").Bind(dbx.Params{"mark": mark}).Row(&rows)
	refresh := map[string]any{"at": isoTime(current.refreshAt), "by": current.refreshWhy, "top": stale, "rows": rows, "gear": gear, "done": rows == 0 && gear == 0}
	if level, ok := strings.CutPrefix(current.refreshWhy, refreshLevel); ok {
		refresh["by"], refresh["level"] = "level", atoi(level)
	} else if share, ok := strings.CutPrefix(current.refreshWhy, refreshPower); ok {
		refresh["by"], refresh["share"] = "power", atoi(share)
	}
	out["refresh"] = refresh
	return out
}

// refreshRoute answers POST /api/odyle/admin/armory-refresh (Server status → Refresh every
// character): a refresh of every character the armory knows starts now. DELETE stops the one
// running. Both go to the audit log and answer the re-reading's status.
func refreshRoute(e *core.RequestEvent) error {
	stop := e.Request.Method == "DELETE"
	if stop {
		if err := stopRefresh(e.App); err != nil {
			return err
		}
		noted(e.App, e.Auth, auditRefresh, "Stopped the refresh of every character the armory knows", map[string]any{"action": "stop"})
	} else {
		if err := startRefresh(e.App, refreshByHand); err != nil {
			return err
		}
		noted(e.App, e.Auth, auditRefresh, "Started a refresh of every character the armory knows", map[string]any{"action": "start"})
	}
	return e.JSON(200, refreshStatus(e.App))
}
