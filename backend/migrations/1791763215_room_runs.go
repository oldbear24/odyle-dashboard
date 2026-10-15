package migrations

import "github.com/pocketbase/pocketbase/core"

// Planned runs: a dungeon, a start time and the members who are going. Owners and
// players plan and join them, viewers read them. Runs are deleted a day after they
// started, with the room, or by their planner or the room owner. A run keeps going when
// its planner leaves the room; leaving takes the member off every attendee list. No API
// rules: room snapshots list them and POST /api/odyle/plan changes them.
func init() {
	register("1791763215_room_runs.js", func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("party_rooms")
		if err != nil {
			return err
		}
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		return app.Save(collection(m{"name": "room_runs", "type": "base", "fields": fields(
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "dungeon", "type": "text", "required": true, "max": 60},
			m{"name": "startsAt", "type": "date", "required": true},
			m{"name": "note", "type": "text", "max": 120},
			m{"name": "plannedBy", "type": "relation", "collectionId": members.Id, "maxSelect": 1, "cascadeDelete": false},
			m{"name": "attendees", "type": "relation", "collectionId": members.Id, "maxSelect": 50, "cascadeDelete": false},
			dates(),
		), "indexes": []string{"CREATE INDEX idx_room_runs_room ON room_runs (room, startsAt)", "CREATE INDEX idx_room_runs_start ON room_runs (startsAt)"}}))
	}, func(app core.App) error {
		return deleteCollections(app, "room_runs")
	})
}
