package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// What 1.0.0 stopped keeping for clients older than Odyle for Windows 0.37.0:
//   - party_rooms.cost, each room's own Odyle per cube from before the server-wide setting.
//     Every answer has reported the setting since; the room JSON keeps its `cost`, taken from it.
//   - room_runs.remindedAt, the mark of a run Discord announced before discord_posts kept every
//     post (1791763242), still written next to them until 1.0.0.
//   - reader sessions opened without a device key (apps paired before October 2026). 1.0.0 takes
//     readings only from a paired PC's session, so they end like any session: the characters they
//     read keep their values and turn stale, and their apps are told to pair again.
func init() {
	register("1791763287_old_client_fields.go", oldClientFieldsUp, oldClientFieldsDown)
}

func oldClientFieldsUp(app core.App) error {
	if err := removeFields(app, "party_rooms", "cost"); err != nil {
		return err
	}
	if err := removeFields(app, "room_runs", "remindedAt"); err != nil {
		return err
	}
	if _, err := app.DB().NewQuery("UPDATE characters SET valid = FALSE, readingSession = '' WHERE readingSession IN (SELECT id FROM publisher_sessions WHERE COALESCE(device, '') = '')").Execute(); err != nil {
		return err
	}
	_, err := app.DB().NewQuery("DELETE FROM publisher_sessions WHERE COALESCE(device, '') = ''").Execute()
	return err
}

// oldClientFieldsDown brings the fields back, every room at the server's Odyle per cube; the
// ended sessions stay ended.
func oldClientFieldsDown(app core.App) error {
	rooms, err := app.FindCollectionByNameOrId("party_rooms")
	if err != nil {
		return err
	}
	rooms.Fields.Add(field(&core.NumberField{}, m{"name": "cost", "min": 1, "max": 1000, "onlyInt": true, "required": true}))
	if err := app.Save(rooms); err != nil {
		return err
	}
	if _, err := app.DB().NewQuery("UPDATE party_rooms SET cost = COALESCE((SELECT odylePerCube FROM odyle_settings WHERE odylePerCube > 0 LIMIT 1), 40)").Execute(); err != nil {
		return err
	}
	runs, err := app.FindCollectionByNameOrId("room_runs")
	if err != nil {
		return err
	}
	runs.Fields.Add(field(&core.DateField{}, m{"name": "remindedAt"}))
	return app.Save(runs)
}
