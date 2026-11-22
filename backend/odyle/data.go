package odyle

import (
	"embed"
	"encoding/json"
)

// Tables the backend ships as data files (backend/odyle/data), compiled in: the TH.GL map names
// (thgl.go), the texts of Discord posts and Web Push messages in each language (locales.go) and
// the player card's options, which the dashboard reads from the same file (cards.go, src/card.js).
//
//go:embed data/*.json
var dataFiles embed.FS

// embeddedJSON reads one of the data files; a file that does not parse stops the server at once
// (the tests read every one).
func embeddedJSON[T any](name string) T {
	var out T
	raw, err := dataFiles.ReadFile(name)
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err != nil {
		panic("odyle: " + name + ": " + err.Error())
	}
	return out
}
