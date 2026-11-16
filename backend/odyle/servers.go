package odyle

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The AION 2 Global servers by race, in the order of their ids: race * 1000 + region digit *
// 100 + list index + 1 (portraits.go), as PLAYNC's official list names them
// (https://aion2.plaync.com/en-us/api/gameinfo/servers?lang=en-us&region=<code>, checked on
// 16 Nov 2026). Every region numbers its servers in this order and opens some of them: Europe
// all 23, North America East 9, Asia 10, South America 6 and North America West 5 of each race.
// The nightly armory job reads that list again (learnServers): a server PLAYNC opens past these
// is named from it, and each region lists the servers it has open.
var elyos = strings.Split("Siel,Nezekan,Vaizel,Kaisinel,Yustiel,Ariel,Fregion,Meslamtaeda,Hithanya,Nania,Tahavatha,Luteros,Phernos,Daminu,Kasaka,Bakarma,Tsenka,Kochi,Ishtar,Tiamat,Gauss,Lamuatan,Nathara", ",")
var asmodian = strings.Split("Israphel,Zikel,Triniel,Lumiel,Marchutan,Azphel,Ereshkigal,Beritra,Nemon,Hadala,Ludra,Ulgorn,Munin,Odar,Zemurru,Kromede,Quai,Baba,Fafnir,Indnath,Agnita,Atiel,Tassin", ",")

// legacyServers are the names Windows apps before 0.34.0 gave seven Global servers, taken from
// a third-party table, with the Global server each id belongs to: Gauss (1x21) was saved as
// Poeta, Tassin (2x23) as Agnita, and so on. The migration 1791763271 renames the characters
// and PvP events saved under them; older apps still send them until they update.
var legacyServers = map[string]string{
	"Tahabata": "Tahavatha", "Kasika": "Kasaka", "Poeta": "Gauss", "Verteron": "Lamuatan",
	"Ishalgen": "Agnita", "Altgard": "Atiel", "Agnita": "Tassin",
}

func knownServer(name string) bool {
	return index(elyos, name) >= 0 || index(asmodian, name) >= 0
}

// globalServer is a server's Global name: an older app's name for it that no Global server has
// becomes the one the server has now. Agnita stays: it is a Global server too.
func globalServer(name string) string {
	if moved, ok := legacyServers[name]; ok && !knownServer(name) {
		return moved
	}
	return name
}

// currentServer is the identity under the server's Global name (globalServer). An older app
// names Tassin Agnita, so its Agnita is taken for Tassin when the account keeps that character
// under Tassin (as the migration renamed it) and not under Agnita.
func currentServer(app core.App, userId string, data identity) (identity, error) {
	if moved := globalServer(data.server); moved != data.server || legacyServers[data.server] == "" {
		data.server = moved
		return data, nil
	}
	if found, err := sameCharacter(app, userId, data); err != nil || len(found) > 0 {
		return data, err
	}
	old := data
	old.server = legacyServers[data.server]
	found, err := sameCharacter(app, userId, old)
	if err != nil || len(found) == 0 {
		return data, err
	}
	return old, nil
}

// The search region code of each region digit (searchRegions).
var serverRegionCodes = map[int]string{1: "nae", 2: "naw", 3: "eu", 4: "la", 5: "as"}

// serverBook is every Global server the backend can name: the lists above, with the servers
// PLAYNC listed past them (game_servers), and which servers each region has open.
type serverBook struct {
	races map[int][]string // 1 Elyos, 2 Asmodians: the names by place, "" where none is known
	open  map[int][]int    // region digit → the server ids PLAYNC last listed there, in order
}

// staticServers is the book of the lists above alone, as before PLAYNC's list is read.
func staticServers() serverBook {
	return serverBook{races: map[int][]string{1: append([]string{}, elyos...), 2: append([]string{}, asmodian...)}, open: map[int][]int{}}
}

// name is a server id's name, or "" when the book has none for it.
func (b serverBook) name(serverId int) string {
	names, place := b.races[serverId/1000], serverId%100
	if serverId < 1000 || serverId >= 3000 || place < 1 || place > len(names) {
		return ""
	}
	return names[place-1]
}

// inRegion is the name of a server id in a search region (searchRegions), or "" when the id does
// not belong to that region or the book has no name for it.
func (b serverBook) inRegion(region string, serverId int) string {
	if code := serverRegionCodes[serverId/100%10]; code == "" || code != region {
		return ""
	}
	return b.name(serverId)
}

// place is a server name's race and place in its list (1 on), or 0, 0 for a name not known.
func (b serverBook) place(name string) (race, place int) {
	if name == "" {
		return 0, 0
	}
	for _, race := range []int{1, 2} {
		if at := index(b.races[race], name); at >= 0 {
			return race, at + 1
		}
	}
	return 0, 0
}

// searches are the server ids and search regions a server of an Odyle region has.
func (b serverBook) searches(server, region string) []search {
	race, at := b.place(server)
	if race == 0 {
		return nil
	}
	out := []search{}
	for _, r := range searchRegions[region] {
		out = append(out, search{serverId: race*1000 + r.digit*100 + at, region: r.code})
	}
	return out
}

// regionServers are a region digit's servers: those PLAYNC last listed there, or every server
// the book names while it has not listed that region.
func (b serverBook) regionServers(digit int) []gameServer {
	out := []gameServer{}
	if ids := b.open[digit]; len(ids) > 0 {
		for _, id := range ids {
			if name := b.name(id); name != "" {
				out = append(out, gameServer{Id: id, Name: name})
			}
		}
		return out
	}
	for _, race := range []int{1, 2} {
		for at, name := range b.races[race] {
			if name != "" {
				out = append(out, gameServer{Id: race*1000 + digit*100 + at + 1, Name: name})
			}
		}
	}
	return out
}

// gameServer is a server id with its name, as game_servers keeps it and the servers route lists it.
type gameServer struct {
	Id   int    `db:"serverId" json:"id"`
	Name string `db:"name" json:"name"`
	Open bool   `db:"open" json:"-"`
}

// serversOf is the server's book, read from game_servers once and again after learnServers.
func serversOf(app core.App) serverBook {
	s := stateOf(app)
	if b := s.serverBook.Load(); b != nil {
		return *b
	}
	b := staticServers()
	rows := []gameServer{}
	if err := app.DB().NewQuery("SELECT serverId, name, open FROM game_servers ORDER BY serverId").All(&rows); err != nil {
		return b
	}
	for _, r := range rows {
		race, place := r.Id/1000, r.Id%100
		names := b.races[race]
		// A place the lists already name keeps its name: PLAYNC naming it otherwise is warned
		// of when learned, and the characters saved under the name stay found.
		if place > len(names) {
			names = append(names, make([]string, place-len(names))...)
		}
		if names[place-1] == "" {
			if at, _ := b.place(r.Name); at == 0 {
				names[place-1] = r.Name
			}
		}
		b.races[race] = names
		if r.Open {
			b.open[r.Id/100%10] = append(b.open[r.Id/100%10], r.Id)
		}
	}
	s.serverBook.Store(&b)
	return b
}

// learnServers reads PLAYNC's server list of every region: each server is kept with its name, a
// server no region lists any more is kept closed (its name stays known), and a region that does
// not answer keeps what it listed before. Paused with the armory.
func learnServers(app core.App) error {
	if readSettings(app).ArmoryPaused {
		return nil
	}
	codes := []int{1, 2, 3, 4, 5}
	listed, answered, failures := map[int]string{}, map[int]bool{}, []error{}
	for _, digit := range codes {
		servers, err := askServers(digit)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		answered[digit] = true
		for id, name := range servers {
			listed[id] = name
		}
	}
	if len(answered) > 0 {
		book := staticServers()
		err := app.RunInTransaction(func(tx core.App) error {
			collection, err := tx.FindCollectionByNameOrId("game_servers")
			if err != nil {
				return err
			}
			kept := []gameServer{}
			if err := tx.DB().NewQuery("SELECT serverId, name, open FROM game_servers").All(&kept); err != nil {
				return err
			}
			known := map[int]bool{}
			for _, k := range kept {
				known[k.Id] = true
				if _, still := listed[k.Id]; !still && k.Open && answered[k.Id/100%10] {
					if _, err := tx.DB().NewQuery("UPDATE game_servers SET open = FALSE WHERE serverId = {:id}").Bind(dbx.Params{"id": k.Id}).Execute(); err != nil {
						return err
					}
				}
			}
			ids := make([]int, 0, len(listed))
			for id := range listed {
				ids = append(ids, id)
			}
			sort.Ints(ids)
			for _, id := range ids {
				name := listed[id]
				if static := book.name(id); static != "" && static != name {
					warn(app, "PLAYNC names a server otherwise than Odyle", "serverId", id, "plaync", name, "odyle", static)
				}
				if !known[id] {
					record := core.NewRecord(collection)
					record.Set("serverId", id)
					record.Set("name", name)
					record.Set("open", true)
					if err := tx.Save(record); err != nil {
						return err
					}
					continue
				}
				if _, err := tx.DB().NewQuery("UPDATE game_servers SET name = {:name}, open = TRUE WHERE serverId = {:id}").Bind(dbx.Params{"name": name, "id": id}).Execute(); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		stateOf(app).serverBook.Store(nil)
	}
	return errors.Join(failures...)
}

// askServers is PLAYNC's server list of one region: the ids of that region with their names.
func askServers(digit int) (map[int]string, error) {
	code := serverRegionCodes[digit]
	res, err := send(call{method: "GET", url: armoryURL() + "/en-us/api/gameinfo/servers?lang=en-us&region=" + code, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 15 * time.Second, limit: 1 << 20})
	if err != nil {
		return nil, err
	}
	if res.status != 200 {
		return nil, fmt.Errorf("PLAYNC answered %d for the servers of %s.", res.status, code)
	}
	answer, _ := res.json().(map[string]any)
	out := map[int]string{}
	for _, s := range jsonList(answer["serverList"]) {
		id, name := int(whole(s["serverId"])), jsonText(s, "serverName", 40)
		// Only this region's ids, with a name like the lists': letters, as PvP events take them.
		if id/1000 < 1 || id/1000 > 2 || id/100%10 != digit || id%100 < 1 || !pvpServer.MatchString(name) {
			continue
		}
		out[id] = name
	}
	if len(out) == 0 {
		return nil, errors.New("PLAYNC listed no servers for " + code + ".")
	}
	return out, nil
}
