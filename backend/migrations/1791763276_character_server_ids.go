package migrations

import (
	"strconv"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Characters are found by their server's id instead of its name: serverId is race × 1000 +
// region digit × 100 + the server's place in its race's list (Lumiel in Europe is 2304), the id
// PLAYNC and the game use, kept by the backend from region and server on every save
// (backend/odyle/servers.go). A server name the backend does not know keeps 0, and such a
// character stays unique by its region, server name and name as before. NA characters count as
// NA-East, the region they were saved under before NA-West was told apart; the daily lookup
// moves those it finds on NA-West. An account's characters are also indexed by account alone,
// which the identity indexes no longer serve, as they hold only part of the characters.
//
// The lists are the servers' names when this migration was written, so a later change to the
// code's lists cannot change what it does; game_servers adds those PLAYNC listed past them.
var (
	serverIdElyos    = strings.Split("Siel,Nezekan,Vaizel,Kaisinel,Yustiel,Ariel,Fregion,Meslamtaeda,Hithanya,Nania,Tahavatha,Luteros,Phernos,Daminu,Kasaka,Bakarma,Tsenka,Kochi,Ishtar,Tiamat,Gauss,Lamuatan,Nathara", ",")
	serverIdAsmodian = strings.Split("Israphel,Zikel,Triniel,Lumiel,Marchutan,Azphel,Ereshkigal,Beritra,Nemon,Hadala,Ludra,Ulgorn,Munin,Odar,Zemurru,Kromede,Quai,Baba,Fafnir,Indnath,Agnita,Atiel,Tassin", ",")
	serverIdRegions  = map[string]int{"GLOBAL_NA": 1, "GLOBAL_NAW": 2, "GLOBAL_EU": 3, "GLOBAL_SA": 4, "GLOBAL_ASIA": 5}
)

func init() {
	register("1791763276_character_server_ids.go", characterServerIdsUp, characterServerIdsDown)
}

func characterServerIdsUp(app core.App) error {
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		return err
	}
	characters.Fields.Add(field(&core.NumberField{}, m{"name": "serverId", "onlyInt": true, "min": 0, "max": 2999}))
	characters.RemoveIndex("idx_character_identity")
	if err := app.Save(characters); err != nil {
		return err
	}
	// Each server name's race and place: the lists, then the names PLAYNC listed past them.
	places := map[string][2]int{}
	for race, names := range map[int][]string{1: serverIdElyos, 2: serverIdAsmodian} {
		for i, name := range names {
			places[name] = [2]int{race, i + 1}
		}
	}
	listed := []struct {
		Id   int    `db:"serverId"`
		Name string `db:"name"`
	}{}
	if err := app.DB().NewQuery("SELECT serverId, name FROM game_servers ORDER BY serverId").All(&listed); err != nil {
		return err
	}
	for _, s := range listed {
		race, place := s.Id/1000, s.Id%100
		if _, known := places[s.Name]; !known && (race == 1 && place > len(serverIdElyos) || race == 2 && place > len(serverIdAsmodian)) {
			places[s.Name] = [2]int{race, place}
		}
	}
	saved := []struct {
		Id     string `db:"id"`
		User   string `db:"user"`
		Name   string `db:"characterName"`
		Server string `db:"server"`
		Region string `db:"region"`
	}{}
	if err := app.DB().NewQuery("SELECT id, user, characterName, server, region FROM characters ORDER BY created, id").All(&saved); err != nil {
		return err
	}
	// Two characters of an account that turn out to be one (saved under two names of one server)
	// would break the identity index: the later one keeps 0 and its name, and is logged.
	taken := map[[3]string]bool{}
	for _, c := range saved {
		at, known := places[c.Server]
		digit := serverIdRegions[c.Region]
		if !known || digit == 0 {
			continue
		}
		id := at[0]*1000 + digit*100 + at[1]
		key := [3]string{c.User, c.Name, strconv.Itoa(id)}
		if taken[key] {
			app.Logger().Warn("A character is saved twice on one server; the later record keeps its server name only", "character", c.Id, "serverId", id)
			continue
		}
		taken[key] = true
		if _, err := app.DB().NewQuery("UPDATE characters SET serverId = {:server} WHERE id = {:id}").Bind(dbx.Params{"server": id, "id": c.Id}).Execute(); err != nil {
			return err
		}
	}
	characters.AddIndex("idx_character_identity", true, "`user`, `serverId`, `characterName`", "`serverId` > 0")
	characters.AddIndex("idx_character_named", true, "`user`, `region`, `server`, `characterName`", "`serverId` = 0")
	characters.AddIndex("idx_characters_user", false, "`user`", "")
	return app.Save(characters)
}

func characterServerIdsDown(app core.App) error {
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		return err
	}
	characters.RemoveIndex("idx_character_identity")
	characters.RemoveIndex("idx_character_named")
	characters.RemoveIndex("idx_characters_user")
	characters.Fields.RemoveByName("serverId")
	characters.AddIndex("idx_character_identity", true, "`user`, `region`, `server`, `characterName`", "")
	return app.Save(characters)
}
