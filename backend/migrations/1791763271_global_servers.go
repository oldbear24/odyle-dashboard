package migrations

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Global server names (backend/odyle/servers.go): Windows apps before 0.34.0 named seven Global
// servers after a third-party table, so their characters and the players of their PvP events
// were saved under another server's name, for example Gauss (1321) as Poeta. Each name moves to
// the server its id belongs to. Agnita, an older app's name for Tassin, moves first, since
// Ishalgen becomes Agnita and an account may keep a character of the same name on both.
var globalServerSteps = [][][2]string{
	{{"Agnita", "Tassin"}},
	{{"Tahabata", "Tahavatha"}, {"Kasika", "Kasaka"}, {"Poeta", "Gauss"}, {"Verteron", "Lamuatan"}, {"Ishalgen", "Agnita"}, {"Altgard", "Atiel"}},
}

func init() {
	register("1791763271_global_servers.go", func(app core.App) error {
		return renameServers(app, globalServerSteps, false)
	}, func(app core.App) error {
		return renameServers(app, [][][2]string{globalServerSteps[1], globalServerSteps[0]}, true)
	})
}

// renameServers renames the server names of characters and PvP events, one step after the
// other (back: from the new name to the old one).
func renameServers(app core.App, steps [][][2]string, back bool) error {
	for _, step := range steps {
		cases, olds, params := "", []string{}, m{}
		for i, names := range step {
			from, to := names[0], names[1]
			if back {
				from, to = to, from
			}
			key := string(rune('a' + i))
			cases += " WHEN {:from" + key + "} THEN {:to" + key + "}"
			olds = append(olds, "{:from"+key+"}")
			params["from"+key], params["to"+key] = from, to
		}
		for _, column := range [][2]string{{"characters", "server"}, {"character_pvp", "server"}, {"character_pvp", "killerServer"}} {
			table, field := column[0], column[1]
			query := "UPDATE " + table + " SET " + field + " = CASE " + field + cases + " END WHERE " + field + " IN (" + strings.Join(olds, ", ") + ")"
			if _, err := app.DB().NewQuery(query).Bind(params).Execute(); err != nil {
				return err
			}
		}
	}
	return nil
}
