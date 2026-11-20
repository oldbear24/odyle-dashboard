package migrations

import (
	"encoding/json"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// The builds in armory_ranks keep each item's rolled stats (soul binding, PLAYNC's subStats) from
// 0.63.0, and the Upgrade tab compares them (backend/odyle/ranks.go, upgrades.go). A build kept
// before left them out. Where the armory keeps the profile the build was taken from (a reader
// looked the character up), its items take their rolled stats from it: the same slot and name,
// in a profile read no earlier than a minute before the build. The scout's builds take theirs
// when it reads their gear again. Nothing is asked of PLAYNC; undone, the rolled stats stay.
func init() {
	register("1791763281_armory_rolled_stats.go", armoryRolledStatsUp, func(core.App) error { return nil })
}

// The parts of a kept profile this migration reads: each item's slot, name and rolled stats.
type rolledProfile struct {
	Gear []struct {
		Slot   string `json:"slot"`
		Name   string `json:"name"`
		Detail *struct {
			Sub []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
			} `json:"sub"`
		} `json:"detail"`
	} `json:"gear"`
}

func armoryRolledStatsUp(app core.App) error {
	pairs := []struct {
		Rank      string `db:"rank"`
		Profile   string `db:"profile"`
		BuiltAt   string `db:"builtAt"`
		FetchedAt string `db:"fetchedAt"`
	}{}
	if err := app.DB().NewQuery("SELECT r.id AS rank, p.id AS profile, r.builtAt, p.fetchedAt FROM armory_ranks r JOIN armory_profiles p ON p.serverId = r.serverId AND p.characterId = r.characterId WHERE r.builtAt != '' AND p.fetchedAt != ''").All(&pairs); err != nil {
		return err
	}
	for _, pair := range pairs {
		built, err := types.ParseDateTime(pair.BuiltAt)
		if err != nil {
			continue
		}
		fetched, err := types.ParseDateTime(pair.FetchedAt)
		if err != nil || fetched.Time().Before(built.Time().Add(-time.Minute)) {
			continue
		}
		// One build and one profile at a time: kept profiles run to tens of KB each.
		var build, profile string
		if err := app.DB().NewQuery("SELECT COALESCE(CAST(build AS TEXT), '') FROM armory_ranks WHERE id = {:id}").Bind(dbx.Params{"id": pair.Rank}).Row(&build); err != nil {
			return err
		}
		if err := app.DB().NewQuery("SELECT COALESCE(CAST(profile AS TEXT), '') FROM armory_profiles WHERE id = {:id}").Bind(dbx.Params{"id": pair.Profile}).Row(&profile); err != nil {
			return err
		}
		patched, changed := withRolledStats(build, profile)
		if !changed {
			continue
		}
		if _, err := app.DB().NewQuery("UPDATE armory_ranks SET build = {:build} WHERE id = {:id}").Bind(dbx.Params{"build": patched, "id": pair.Rank}).Execute(); err != nil {
			return err
		}
	}
	return nil
}

// withRolledStats is the build with the rolled stats of the profile's items (slot and name alike)
// on those of its items that have details and none yet, and whether any item took some.
func withRolledStats(build, profile string) (string, bool) {
	var b map[string]any
	var p rolledProfile
	if json.Unmarshal([]byte(build), &b) != nil || json.Unmarshal([]byte(profile), &p) != nil {
		return build, false
	}
	gear, _ := b["gear"].([]any)
	changed := false
	for _, g := range gear {
		item, _ := g.(map[string]any)
		detail, _ := item["detail"].(map[string]any)
		if detail == nil {
			continue
		}
		if sub, _ := detail["sub"].([]any); len(sub) > 0 {
			continue
		}
		for _, kept := range p.Gear {
			if kept.Slot != item["slot"] || kept.Name != item["name"] || kept.Detail == nil || len(kept.Detail.Sub) == 0 {
				continue
			}
			sub := []any{}
			for _, line := range kept.Detail.Sub {
				sub = append(sub, m{"name": line.Name, "value": line.Value})
			}
			detail["sub"], changed = sub, true
			break
		}
	}
	if !changed {
		return build, false
	}
	raw, err := json.Marshal(b)
	if err != nil {
		return build, false
	}
	return string(raw), true
}
