package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// cleanup is the expiry job: invite links three days after they expired (inviteGrace),
// expired pairing codes and reader sessions, pairings unused for half a year (deviceKeep), Odyle history, places and PvP events older than
// Game settings keep them (30 days by default, PvP events 90) and planned runs a day after
// they started.
func cleanup(app core.App) (result, error) {
	at := time.Now()
	done, err := purge(app, "room_invites", "expiresAt <= {:cutoff}", stamp(at.Add(-inviteGrace)))
	if err != nil {
		return result{}, err
	}
	codes, err := purge(app, "desktop_codes", "expiresAt <= {:cutoff}", stamp(at))
	if err != nil {
		return result{}, err
	}
	done += codes
	// Sessions end one by one: the characters they read turn stale.
	sessions, err := endSessions(app, "expiresAt <= {:now}", dbx.Params{"now": stamp(at)})
	if err != nil {
		return result{}, err
	}
	done += sessions
	// Pairings unused for half a year end (devices.go).
	devices, err := dropUnusedDevices(app, at)
	if err != nil {
		return result{}, err
	}
	done += devices
	// The Odyle history and the places of location sharing are kept as long as Game settings
	// say; planned runs go a day after they started.
	rules := readSettings(app)
	history, err := purge(app, "character_readings", "created < {:cutoff}", stamp(at.Add(-daysOf(rules.HistoryDays))))
	if err != nil {
		return result{}, err
	}
	if history > 0 {
		forgetWeekSpends(app) // the rooms' week (weekly.go) is read again
	}
	runs, err := purge(app, "room_runs", "startsAt < {:cutoff}", stamp(at.Add(-24*time.Hour)))
	if err != nil {
		return result{}, err
	}
	places, err := purge(app, "character_locations", "created < {:cutoff}", stamp(at.Add(-daysOf(rules.LocationDays))))
	if err != nil {
		return result{}, err
	}
	fights, err := purge(app, "character_pvp", "at < {:cutoff}", stamp(at.Add(-daysOf(rules.PvpDays))))
	if err != nil {
		return result{}, err
	}
	// The audit log keeps a year (audit.go).
	audited, err := purge(app, "odyle_audit", "created < {:cutoff}", stamp(at.Add(-daysOf(auditDays))))
	if err != nil {
		return result{}, err
	}
	return result{Done: done + history + runs + places + fights + audited}, nil
}

// Rows purge deletes per statement, and statements per run: a backlog (after a long
// stop, say) goes over a few runs instead of holding the database in one long write.
var purgeBatch, purgeBatches = 1000, 50

// purge deletes the rows of a collection that match the condition (compared with
// {:cutoff}) without loading them. It is only for the expiry job's invites, pairing
// codes, history and runs: nothing refers to them and they have no files or hooks, so
// deleting each record would add queries and change nothing else.
func purge(app core.App, collection, condition, cutoff string) (int, error) {
	query := "DELETE FROM {{" + collection + "}} WHERE [[id]] IN (SELECT [[id]] FROM {{" + collection + "}} WHERE " + condition + " LIMIT {:limit})"
	total := 0
	for range purgeBatches {
		res, err := app.DB().NewQuery(query).Bind(dbx.Params{"cutoff": cutoff, "limit": purgeBatch}).Execute()
		if err != nil {
			return total, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return total, err
		}
		total += int(n)
		if n < int64(purgeBatch) {
			break
		}
	}
	return total, nil
}

// The inactive-account clean-up deletes up to 200 accounts a night.
const retentionBatch = 200

// inactiveBefore matches accounts unused since the cutoff (stored form): by their last
// activity, or by their creation when they never used Odyle.
func inactiveBefore(cutoff string) dbx.Expression {
	return dbx.NewExp("lastActiveAt < {:cutoff} AND (lastActiveAt != '' OR created < {:cutoff})", dbx.Params{"cutoff": cutoff})
}

// retention is the nightly job that deletes accounts unused for
// odyle_settings.inactiveAccountDays days (0 keeps them), up to 200 a night, longest
// unused first. handOver passes their rooms on first.
func retention(app core.App) (result, error) {
	days := readSettings(app).InactiveAccountDays
	if days == 0 {
		return result{Skipped: "off"}, nil
	}
	out, users := result{}, []*core.Record{}
	if err := app.RecordQuery("users").AndWhere(inactiveBefore(ago(time.Duration(days)*24*time.Hour))).OrderBy("lastActiveAt ASC", "id ASC").Limit(retentionBatch).All(&users); err != nil {
		return result{}, err
	}
	for _, user := range users {
		roomIds, err := roomsFor(app, user.Id)
		if err == nil {
			err = app.Delete(user)
		}
		if err != nil {
			out.fail("Account " + user.Id + ": " + message(err))
			warn(app, "Odyle could not delete an inactive account", "user", user.Id, "error", message(err))
			continue
		}
		notify(app, roomIds)
		out.Done++
		info(app, "Odyle deleted an inactive account", "user", user.Id)
	}
	return out, nil
}

// Characters nobody has read for a year are deleted with their history (#39): no verified reading,
// no heartbeat and not saved within 365 days. Up to 500 a night, longest unread first; playing the
// character again with the reader saves it anew.
const (
	characterRetention = 365 * 24 * time.Hour
	oldCharacterBatch  = 500
)

// unreadBefore matches characters with no reading, heartbeat or creation since the cutoff (stored
// form); a field never set is empty and so before any cutoff.
func unreadBefore(cutoff string) dbx.Expression {
	return dbx.NewExp("lastSeenAt < {:cutoff} AND lastReadingAt < {:cutoff} AND created < {:cutoff}", dbx.Params{"cutoff": cutoff})
}

// oldCharacters is the nightly job that deletes characters unread for a year.
func oldCharacters(app core.App) (result, error) {
	out, characters := result{}, []*core.Record{}
	if err := app.RecordQuery("characters").AndWhere(unreadBefore(ago(characterRetention))).OrderBy("created ASC", "id ASC").Limit(oldCharacterBatch).All(&characters); err != nil {
		return result{}, err
	}
	for _, c := range characters {
		roomIds, err := roomsFor(app, c.GetString("user"))
		if err == nil {
			err = app.Delete(c)
		}
		if err != nil {
			out.fail("Character " + c.Id + ": " + message(err))
			warn(app, "Odyle could not delete a character unread for a year", "character", c.Id, "error", message(err))
			continue
		}
		notify(app, roomIds)
		out.Done++
	}
	if out.Done > 0 {
		info(app, "Odyle deleted characters unread for a year", "count", out.Done)
	}
	return out, nil
}

// retentionPreview is what the clean-up would do on its next run with the given period,
// if no account comes back before then: how many accounts are unused that long, and how
// many of them that run deletes (the rest follow on the next nights).
func retentionPreview(app core.App, days int64, at time.Time) (*object, error) {
	next, inactive := nextDaily(jobs["odyle-retention"].schedule, at), int64(0)
	if days > 0 {
		var err error
		if inactive, err = app.CountRecords("users", inactiveBefore(stamp(next.Add(-time.Duration(days)*24*time.Hour)))); err != nil {
			return nil, err
		}
	}
	return newObject().set("days", days).set("runAt", next.Format(isoLayout)).set("inactive", inactive).set("deleted", min(inactive, retentionBatch)), nil
}
