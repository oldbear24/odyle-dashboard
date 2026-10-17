package odyle

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// The Go port runs the shared cases of tests/readiness-vectors.json, like src/readiness.js and the
// Windows app's PartyReadiness (#15).
func TestReadinessRunsTheSharedCases(t *testing.T) {
	raw, err := os.ReadFile("../../tests/readiness-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Now     string `json:"now"`
		Parties []struct {
			Name    string       `json:"name"`
			Cost    int64        `json:"cost"`
			Entries []readyEntry `json:"entries"`
			Expect  struct {
				Characters, Live, Ready, Players, Uncounted []string
				Lowest                                      *string
				Cubes                                       int64
			} `json:"expect"`
		} `json:"parties"`
		Characters []struct {
			Name      string     `json:"name"`
			Cost      int64      `json:"cost"`
			Character readyEntry `json:"character"`
			Expect    struct {
				State string `json:"state"`
				Known bool   `json:"known"`
				Cubes int64  `json:"cubes"`
				Ready bool   `json:"ready"`
			} `json:"expect"`
		} `json:"characters"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	now, ok := parseDate(vectors.Now)
	if !ok || len(vectors.Parties) == 0 || len(vectors.Characters) == 0 {
		t.Fatalf("vectors at %q: %d parties, %d characters", vectors.Now, len(vectors.Parties), len(vectors.Characters))
	}
	ids := func(list []readyEntry) []string {
		out := []string{}
		for _, e := range list {
			out = append(out, e.ID)
		}
		return out
	}
	for _, p := range vectors.Parties {
		got := partyOf(p.Entries, now, p.Cost)
		var lowest *string
		if got.Lowest != nil {
			lowest = &got.Lowest.ID
		}
		want := p.Expect
		if !reflect.DeepEqual(ids(got.Characters), want.Characters) || !reflect.DeepEqual(ids(got.Live), want.Live) || !reflect.DeepEqual(ids(got.Ready), want.Ready) ||
			!reflect.DeepEqual(ids(got.Players), want.Players) || !reflect.DeepEqual(got.Uncounted, want.Uncounted) || got.Cubes != want.Cubes || !reflect.DeepEqual(lowest, want.Lowest) {
			t.Errorf("%s: got characters %v live %v ready %v players %v lowest %v cubes %d uncounted %v", p.Name, ids(got.Characters), ids(got.Live), ids(got.Ready), ids(got.Players), lowest, got.Cubes, got.Uncounted)
		}
	}
	for _, c := range vectors.Characters {
		state, known, cubes, ready := characterReady(c.Character, now, c.Cost)
		if state != c.Expect.State || known != c.Expect.Known || cubes != c.Expect.Cubes || ready != c.Expect.Ready {
			t.Errorf("%s: got %s %v %d %v", c.Name, state, known, cubes, ready)
		}
	}
	if empty := partyOf(nil, now, 40); empty.Lowest != nil || empty.Cubes != 0 || len(empty.Players) != 0 || len(empty.Uncounted) != 0 {
		t.Fatalf("an empty room: %+v", empty)
	}
}
