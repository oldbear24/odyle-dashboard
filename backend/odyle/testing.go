//go:build odyletest

package odyle

// The disposable test backend of tests/integration.test.mjs and tests/ui.test.mjs
// (go build -tags odyletest). It approves only the synthetic test-fixture-v1 adapter
// and adds /__test__ routes that issue synthetic accounts and stand in for a superuser
// editing records, the scheduled jobs and the passing of time. None of this is in the
// production build: there is no password login, test sign-in or Discord bypass.

import (
	"strconv"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

var verifiedAdapters = []string{"test-fixture-v1"}

func init() { testFixtures = fixtures }

func fixture(se *core.ServeEvent, path string, handle func(e *core.RequestEvent, b body) (any, error)) {
	se.Router.POST("/__test__/"+path, func(e *core.RequestEvent) error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		out, err := handle(e, b)
		if err != nil {
			return badRequest(err.Error())
		}
		return e.JSON(200, out)
	})
}

func save(app core.App, collection string, values map[string]any) (*core.Record, error) {
	record, err := newRecord(app, collection)
	if err != nil {
		return nil, err
	}
	for k, v := range values {
		record.Set(k, v)
	}
	return record, app.Save(record)
}

func fixtures(se *core.ServeEvent) {
	// Synthetic accounts, found again by their display name.
	fixture(se, "account", func(e *core.RequestEvent, b body) (any, error) {
		user, err := e.App.FindFirstRecordByData("users", "displayName", b["name"])
		if err != nil {
			if user, err = newRecord(e.App, "users"); err != nil {
				return nil, err
			}
			user.SetEmail(security.RandomString(20) + "@test.invalid")
			user.SetPassword(security.RandomString(48))
			user.Set("displayName", b["name"])
			if err := e.App.Save(user); err != nil {
				return nil, err
			}
		}
		token, err := user.NewAuthToken()
		return map[string]any{"token": token, "record": user}, err
	})
	// An operator signed in to the PocketBase dashboard, with the given password if any.
	fixture(se, "superuser", func(e *core.RequestEvent, b body) (any, error) {
		su, err := e.App.FindAuthRecordByEmail(core.CollectionNameSuperusers, "operator@test.invalid")
		if err != nil {
			if su, err = newRecord(e.App, core.CollectionNameSuperusers); err != nil {
				return nil, err
			}
			su.SetEmail("operator@test.invalid")
			su.SetPassword(security.RandomString(48))
		}
		if password, ok := b.text("password"); ok {
			su.SetPassword(password)
		}
		if err := e.App.Save(su); err != nil {
			return nil, err
		}
		token, err := su.NewAuthToken()
		return map[string]any{"token": token}, err
	})
	// Discord sign-in against the tests' stand-in for Discord's OAuth endpoints.
	fixture(se, "oauth-provider", func(e *core.RequestEvent, b body) (any, error) {
		users, err := e.App.FindCollectionByNameOrId("users")
		if err != nil {
			return nil, err
		}
		base, _ := b.text("url")
		users.OAuth2.Enabled = true
		users.OAuth2.Providers = []core.OAuth2ProviderConfig{{Name: "discord", ClientId: "test-application", ClientSecret: "test-only-secret", TokenURL: base + "/token", UserInfoURL: base + "/user"}}
		return map[string]any{"success": true}, e.App.Save(users)
	})
	// The scheduled jobs, run now, once the portrait lookups of newly saved characters are
	// done, so the job finds what they did.
	for path, work := range map[string]func(core.App) (result, error){"refresh-portraits": refreshPortraits, "retention": retention, "remind": remindRuns} {
		fixture(se, path, func(e *core.RequestEvent, _ body) (any, error) {
			stateOf(e.App).portraits.wait()
			_, err := work(e.App)
			return map[string]any{}, err
		})
	}
	// Runs the expiry job and reports which of the given invite codes it kept.
	fixture(se, "cleanup", func(e *core.RequestEvent, b body) (any, error) {
		if _, err := cleanup(e.App); err != nil {
			return nil, err
		}
		kept := []string{}
		codes, _ := b["codes"].([]any)
		for _, raw := range codes {
			code, _ := raw.(string)
			if _, err := e.App.FindFirstRecordByData("room_invites", "digest", security.SHA256(code)); err == nil {
				kept = append(kept, code)
			}
		}
		return map[string]any{"kept": kept}, nil
	})
	fixture(se, "devices", func(e *core.RequestEvent, b body) (any, error) {
		kept := []bool{}
		keys, _ := b["keys"].([]any)
		for _, raw := range keys {
			key, _ := raw.(string)
			_, err := e.App.FindFirstRecordByData("desktop_devices", "digest", security.SHA256(key))
			kept = append(kept, err == nil)
		}
		return map[string]any{"kept": kept}, nil
	})
	// A superuser editing odyle_settings in the PocketBase dashboard.
	setting := func(e *core.RequestEvent, values map[string]any) (any, error) {
		record := findSettings(e.App)
		for k, v := range values {
			record.Set(k, v)
		}
		return map[string]any{}, e.App.Save(record)
	}
	fixture(se, "odyle-per-cube", func(e *core.RequestEvent, b body) (any, error) {
		return setting(e, map[string]any{"odylePerCube": b["value"]})
	})
	fixture(se, "reset-times", func(e *core.RequestEvent, b body) (any, error) {
		return setting(e, map[string]any{"dailyResetHour": b["hour"], "weeklyResetDay": b["day"]})
	})
	// Records written directly, so the tests keep their rate-limit budget.
	fixture(se, "member", func(e *core.RequestEvent, b body) (any, error) {
		return save(e.App, "room_members", map[string]any{"room": b["room"], "user": b["user"], "role": b["role"], "sharedCharacters": []string{}})
	})
	fixture(se, "characters", func(e *core.RequestEvent, b body) (any, error) {
		for i := 0; i < count(b["count"]); i++ {
			if _, err := save(e.App, "characters", map[string]any{"user": b["user"], "characterName": "Bulk" + strconv.Itoa(i), "server": "Lumiel", "region": "GLOBAL_EU"}); err != nil {
				return nil, err
			}
		}
		return map[string]any{}, nil
	})
	fixture(se, "rooms", func(e *core.RequestEvent, b body) (any, error) {
		role := "owner"
		if b.set("role") {
			role = b.str("role")
		}
		for i := 0; i < count(b["count"]); i++ {
			room, err := save(e.App, "party_rooms", map[string]any{"owner": b["user"], "name": "Bulk " + strconv.Itoa(i), "cost": 40})
			if err != nil {
				return nil, err
			}
			if _, err := save(e.App, "room_members", map[string]any{"room": room.Id, "user": b["user"], "role": role}); err != nil {
				return nil, err
			}
			if b.set("role") {
				room.Set("owner", b["other"])
				if err := e.App.Save(room); err != nil {
					return nil, err
				}
			}
		}
		return map[string]any{}, nil
	})
	// Data of the first releases, before the upgrade migrations the tests skip at first.
	fixture(se, "legacy", func(e *core.RequestEvent, b body) (any, error) {
		return save(e.App, "characters", map[string]any{"user": b["user"], "characterName": "Legacy", "server": "EU", "region": "GLOBAL_EU", "value": 123, "confirmed": true, "valid": true, "source": "manual", "lastReadingAt": "2026-10-12 12:00:00.000Z"})
	})
	fixture(se, "legacy-room", func(e *core.RequestEvent, b body) (any, error) {
		room, err := save(e.App, "party_rooms", map[string]any{"owner": b["user"], "name": "Legacy room", "cost": 40})
		if err != nil {
			return nil, err
		}
		_, err = save(e.App, "room_members", map[string]any{"room": room.Id, "user": b["user"], "role": "owner", "sharing": true})
		return room, err
	})
	// The passing of time: an aged account, portrait check, invite, reading or run.
	fixture(se, "inactive", func(e *core.RequestEvent, b body) (any, error) {
		user, err := e.App.FindRecordById("users", b.str("user"))
		if err != nil {
			return nil, err
		}
		user.Set("lastActiveAt", time.Now().Add(-time.Duration(count(b["days"]))*24*time.Hour).UTC().Format(isoLayout))
		return map[string]any{}, e.App.Save(user)
	})
	fixture(se, "age-portrait", func(e *core.RequestEvent, b body) (any, error) {
		c, err := e.App.FindRecordById("characters", b.str("id"))
		if err != nil {
			return nil, err
		}
		c.Set("portraitCheckedAt", time.Now().Add(-48*time.Hour).UTC().Format(isoLayout))
		return map[string]any{}, e.App.Save(c)
	})
	fixture(se, "expire-invite", func(e *core.RequestEvent, b body) (any, error) {
		code, _ := b.text("code")
		invite, err := e.App.FindFirstRecordByData("room_invites", "digest", security.SHA256(code))
		if err != nil {
			return nil, err
		}
		invite.Set("expiresAt", time.Now().Add(-time.Minute).UTC().Format(isoLayout))
		return map[string]any{}, e.App.Save(invite)
	})
	fixture(se, "age", func(e *core.RequestEvent, b body) (any, error) {
		update := "UPDATE character_readings SET created = {:at} WHERE id = {:id}"
		if b.str("collection") == "room_runs" {
			update = "UPDATE room_runs SET startsAt = {:at} WHERE id = {:id}"
		}
		_, err := e.App.DB().NewQuery(update).Bind(dbx.Params{"at": ago(time.Duration(count(b["days"])) * 24 * time.Hour), "id": b.str("id")}).Execute()
		return map[string]any{}, err
	})
	fixture(se, "readings", func(e *core.RequestEvent, b body) (any, error) {
		readings, err := e.App.FindRecordsByFilter("character_readings", "character = {:id}", "created", 0, 0, dbx.Params{"id": b.str("id")})
		return ids(readings), err
	})
}
