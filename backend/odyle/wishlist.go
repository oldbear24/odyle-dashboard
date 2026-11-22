package odyle

import (
	"sort"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type wish struct {
	Key     string `json:"key"`
	Dungeon string `json:"dungeon"`
	Since   string `json:"since"`
	Users   []any  `json:"users"`
}

// wishlistOf is the room's dungeon wishlist grouped by dungeon, most wanted first, then
// oldest. Users are the accounts that still need it; clients name them from members.
func wishlistOf(app core.App, roomId string, members []*Member) ([]*wish, error) {
	if members == nil {
		var err error
		if members, err = roomMembers(app, roomId); err != nil {
			return nil, err
		}
	}
	users := memberUsers(members)
	records, err := app.FindRecordsByFilter("room_wishes", "room = {:room}", "created", 0, 0, dbx.Params{"room": roomId})
	if err != nil {
		return nil, err
	}
	entries, order := map[string]*wish{}, []*wish{}
	for _, w := range views[Wish](records) {
		key := w.Key()
		entry := entries[key]
		if entry == nil {
			entry = &wish{Key: key, Dungeon: w.Dungeon(), Since: w.Created(), Users: []any{}}
			entries[key] = entry
			order = append(order, entry)
		}
		var user any
		if id, ok := users[w.Member()]; ok {
			user = id
		}
		entry.Users = append(entry.Users, user)
	}
	sort.SliceStable(order, func(a, b int) bool {
		if len(order[a].Users) != len(order[b].Users) {
			return len(order[a].Users) > len(order[b].Users)
		}
		return order[a].Since < order[b].Since
	})
	return order, nil
}

// Reporters and owners add dungeons they need, anyone removes their own entry, and
// the owner can clear a dungeon for everyone, for example after the party ran it. A room
// whose owner turned the wishlist off takes no change.
func wishlist(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		m, err := membership(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		roomId := m.Room()
		room, err := findAs[Room](app, "party_rooms", roomId)
		if err != nil {
			return nil, err
		}
		if !room.On("wishlist") {
			return nil, forbidden("The room owner turned the dungeon wishlist off.")
		}
		wanted, err := dungeon(b["dungeon"])
		if err != nil {
			return nil, err
		}
		want, ok := b.boolean("wanted")
		if !ok {
			return nil, badRequest("Wanted must be true or false.")
		}
		found, err := list(app, "room_wishes", "room = {:room} && key = {:key}", dbx.Params{"room": roomId, "key": wanted.key})
		if err != nil {
			return nil, err
		}
		entry, mine := views[Wish](found), []*Wish{}
		for _, w := range entry {
			if w.Member() == m.Id {
				mine = append(mine, w)
			}
		}
		switch {
		case b.isTrue("everyone"):
			if want {
				return nil, badRequest("A dungeon can only be cleared for everyone, not added for them.")
			}
			if _, err := manager(app, user.Id, roomId); err != nil {
				return nil, err
			}
			for _, w := range entry {
				if err := app.Delete(w); err != nil {
					return nil, err
				}
			}
		case !want:
			for _, w := range mine {
				if err := app.Delete(w); err != nil {
					return nil, err
				}
			}
		case len(mine) == 0:
			if m.Role() == "viewer" {
				return nil, forbidden("Viewers cannot add dungeons to this room's wishlist.")
			}
			count, err := app.CountRecords("room_wishes", dbx.HashExp{"member": m.Id})
			if err != nil {
				return nil, err
			}
			if count >= 20 {
				return nil, badRequest("You can have up to 20 dungeons on a room's wishlist.")
			}
			var listed *dungeonName
			if len(entry) == 0 {
				current, err := wishlistOf(app, roomId, nil)
				if err != nil {
					return nil, err
				}
				if len(current) >= 50 {
					return nil, badRequest("This room's wishlist is full (50 dungeons).")
				}
				// A new entry must be in the dungeon catalog, when there is one, and takes its spelling.
				if listed, err = catalogName(app, wanted.dungeon); err != nil {
					return nil, err
				}
				if listed == nil {
					return nil, badRequest("Choose a dungeon from the list.")
				}
			}
			record, err := newRecord(app, "room_wishes")
			if err != nil {
				return nil, err
			}
			// Joining an entry keeps its first spelling, whatever case this member typed.
			spelling := ""
			if len(entry) > 0 {
				spelling = entry[0].Dungeon()
			} else {
				spelling = listed.dungeon
			}
			record.Set("room", roomId)
			record.Set("member", m.Id)
			record.Set("dungeon", spelling)
			record.Set("key", wanted.key)
			if err := app.Save(record); err != nil {
				return nil, err
			}
		}
		*affected = append(*affected, roomId)
		wishes, err := wishlistOf(app, roomId, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"wishlist": wishes}, nil
	})
}
