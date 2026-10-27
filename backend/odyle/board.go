package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// boardOf is a room's information board for its members: its text, the account that wrote it
// last (clients name it from members) and when. nil when the board is empty or turned off.
func boardOf(room *Room) any {
	text := room.GetString("board")
	if text == "" || !room.On("board") {
		return nil
	}
	return map[string]any{"text": text, "by": room.GetString("boardBy"), "at": room.GetString("boardAt")}
}

// board lets the room owner or an officer write the room's information board ({ roomId, text });
// an empty text clears it. Every member reads it in the room's snapshot.
func board(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := manager(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		if !room.On("board") {
			return nil, forbidden("The room owner turned the information board off.")
		}
		text, err := boardText(b["text"])
		if err != nil {
			return nil, err
		}
		by, at := user.Id, now()
		if text == "" {
			by, at = "", ""
		}
		room.Set("board", text)
		room.Set("boardBy", by)
		room.Set("boardAt", at)
		if err := app.Save(room); err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return map[string]any{"board": boardOf(room)}, nil
	})
}

// roomFeaturesSetting lets the room owner turn parts of the room on and off ({ roomId, features:
// { board?, runs?, wishlist?, week? } }, each true or false). A part turned off disappears for
// every member and refuses changes; what it keeps (the board's text, the wishlist's entries)
// comes back when it is turned on again. Planned runs keep nothing: turning them off cancels
// the runs ahead and ends the ones under way, as the room lists them (runsOf), with their
// Discord posts; the answer counts the runs cancelled.
func roomFeaturesSetting(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		room, err := owner(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		changes, ok := b["features"].(map[string]any)
		if !ok || len(changes) == 0 {
			return nil, badRequest("Choose the room features to turn on or off.")
		}
		features := room.Features()
		for key, value := range changes {
			on, isBool := value.(bool)
			if _, known := features[key]; !known || !isBool {
				return nil, badRequest("Turn the board, planned runs, the wishlist or the party's week on or off.")
			}
			features[key] = on
		}
		cancelled := 0
		if !features["runs"] && room.On("runs") {
			runs, err := app.FindRecordsByFilter("room_runs", "room = {:room} && startsAt >= {:since}", "", 0, 0, dbx.Params{"room": room.Id, "since": ago(3 * time.Hour)})
			if err != nil {
				return nil, err
			}
			for _, r := range views[Run](runs) {
				how := "done"
				if timeOf(r.StartsAt()).After(time.Now()) {
					how = "cancelled"
					cancelled++
				}
				if err := endPosts(app, r, how); err != nil {
					return nil, err
				}
				if err := app.Delete(r); err != nil {
					return nil, err
				}
			}
		}
		room.Set("features", features)
		if err := app.Save(room); err != nil {
			return nil, err
		}
		*affected = append(*affected, room.Id)
		return map[string]any{"room": roomJSON(room, odylePerCube(app)), "cancelled": cancelled}, nil
	})
}
