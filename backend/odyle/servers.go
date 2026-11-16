package odyle

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The AION 2 Global servers by race, in the order of their ids: race * 1000 + region digit *
// 100 + list index + 1 (portraits.go), as PLAYNC's official list names them
// (https://aion2.plaync.com/en-us/api/gameinfo/servers?lang=en-us&region=<code>, checked on
// 16 Nov 2026). Every region numbers its servers in this order and opens some of them: Europe
// all 23, North America East 9, Asia 10, South America 6 and North America West 5 of each race.
// A server id past the list is not known here, and the Windows app saves none of its characters.
var elyos = strings.Split("Siel,Nezekan,Vaizel,Kaisinel,Yustiel,Ariel,Fregion,Meslamtaeda,Hithanya,Nania,Tahavatha,Luteros,Phernos,Daminu,Kasaka,Bakarma,Tsenka,Kochi,Ishtar,Tiamat,Gauss,Lamuatan,Nathara", ",")
var asmodian = strings.Split("Israphel,Zikel,Triniel,Lumiel,Marchutan,Azphel,Ereshkigal,Beritra,Nemon,Hadala,Ludra,Ulgorn,Munin,Odar,Zemurru,Kromede,Quai,Baba,Fafnir,Indnath,Agnita,Atiel,Tassin", ",")

// legacyServers are the names Windows apps before 0.33.1 gave seven Global servers, taken from
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
