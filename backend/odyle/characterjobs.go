package odyle

import (
	"slices"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// A character's background bookkeeping, kept apart from the character in character_jobs (one
// row a character, added the first time a job writes it): the portrait job's last lookup, how
// many lookups in a row the official search did not list the character and the digest of its
// portrait (portraits.go), the cap alert last told (capalerts.go) and the day the character
// last earned its account a spin (slots.go). No client sees it, and writing it neither saves
// the character nor tells its rooms. A character's row goes with it (cascade).
type characterJobs struct {
	PortraitCheckedAt string `db:"portraitCheckedAt"`
	PortraitHash      string `db:"portraitHash"`
	PortraitMisses    int    `db:"portraitMisses"`
	CapAlert          string `db:"capAlert"`
	SpinDay           string `db:"spinDay"`
}

// jobColumns are the bookkeeping fields writeJobs may set.
var jobColumns = []string{"portraitCheckedAt", "portraitHash", "portraitMisses", "capAlert", "spinDay"}

const jobsSelect = "SELECT [[portraitCheckedAt]], [[portraitHash]], [[portraitMisses]], [[capAlert]], [[spinDay]] FROM {{character_jobs}} "

// jobsOf is a character's bookkeeping; empty before any job wrote it.
func jobsOf(app core.App, character string) (characterJobs, error) {
	var j characterJobs
	err := app.DB().NewQuery(jobsSelect + "WHERE [[character]] = {:character}").Bind(dbx.Params{"character": character}).One(&j)
	if isNoRows(err) {
		return characterJobs{}, nil
	}
	return j, err
}

// jobsOfMany is the bookkeeping of the characters, by character id; one without any is left out.
func jobsOfMany(app core.App, characters []string) (map[string]characterJobs, error) {
	out := map[string]characterJobs{}
	if len(characters) == 0 {
		return out, nil
	}
	var rows []struct {
		characterJobs
		Character string `db:"character"`
	}
	err := app.DB().Select("character", "portraitCheckedAt", "portraitHash", "portraitMisses", "capAlert", "spinDay").From("character_jobs").
		Where(dbx.In("character", anys(unique(characters))...)).All(&rows)
	for _, r := range rows {
		out[r.Character] = r.characterJobs
	}
	return out, err
}

// writeJobs sets some of a character's bookkeeping (field → value), adding its row the first
// time. Only this row is written: a reading saved meanwhile keeps the character as it is.
func writeJobs(app core.App, character string, values map[string]any) error {
	_, err := upsertJobs(app, character, values, "")
	return err
}

// upsertJobs writes the values, unless the row is there and when is false for it (an SQL
// condition on character_jobs; "" always writes), and answers whether it wrote them.
func upsertJobs(app core.App, character string, values map[string]any, when string) (bool, error) {
	columns, placeholders, updates := []string{"[[character]]"}, []string{"{:character}"}, []string{}
	params := dbx.Params{"character": character}
	for name, value := range values {
		if !slices.Contains(jobColumns, name) {
			panic("character_jobs has no field " + name)
		}
		columns = append(columns, "[["+name+"]]")
		placeholders = append(placeholders, "{:"+name+"}")
		updates = append(updates, "[["+name+"]] = excluded.[["+name+"]]")
		params[name] = value
	}
	slices.Sort(updates)
	query := "INSERT INTO {{character_jobs}} (" + strings.Join(columns, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ") " +
		"ON CONFLICT ([[character]]) DO UPDATE SET " + strings.Join(updates, ", ")
	if when != "" {
		query += " WHERE " + when
	}
	res, err := app.DB().NewQuery(query).Bind(params).Execute()
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
