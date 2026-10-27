package odyle

import (
	"testing"
	"time"
)

func TestReadingsKeepTheGamesTwoNumbersAndWhatChanged(t *testing.T) {
	adapters := []string{"test-fixture-v1"}
	read := func(change map[string]any) reading {
		t.Helper()
		r, err := validReading(readingInput(change), "session", 5, adapters)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	// A spend with both numbers; a snapshot never has a delta.
	if r := read(map[string]any{"value": 830.0, "base": 0.0, "bonus": 830.0, "kind": "spend", "delta": -80.0}); asJSON(t, r.parts) != `{"base":0,"bonus":830}` || r.kind != "spend" || r.delta != -80 {
		t.Fatalf("spend %+v", r)
	}
	if r := read(map[string]any{"value": 390.0, "base": 0.0, "bonus": 390.0, "kind": "snapshot", "delta": 12.0}); r.kind != "snapshot" || r.delta != 0 {
		t.Fatalf("snapshot %+v", r)
	}
	// Parts that do not add up, a made-up kind and a malformed delta are left out, never refused.
	if r := read(map[string]any{"value": 390.0, "base": 15.0, "bonus": 390.0, "kind": "teleport", "delta": "x"}); r.parts != nil || r.kind != "" || r.delta != 0 || r.value != 390 {
		t.Fatalf("malformed %+v", r)
	}
	if r := read(map[string]any{"value": 390.0, "kind": "item", "delta": "40"}); r.parts != nil || r.kind != "item" || r.delta != 0 {
		t.Fatalf("an item without a usable delta %+v", r)
	}
	// Older apps send only the total.
	if r := read(nil); r.parts != nil || r.kind != "" {
		t.Fatalf("total only %+v", r)
	}
}

func TestHistoryAndTheCharacterCarryTheGamesTwoNumbers(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Parts")
	c, err := findAs[Character](app, "characters", id)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range []reading{
		{value: 910, parserVersion: "test-fixture-v1", parts: map[string]any{"base": int64(15), "bonus": int64(895)}, kind: "regen", delta: 15},
		{value: 830, parserVersion: "test-fixture-v1", parts: map[string]any{"base": int64(0), "bonus": int64(830)}, kind: "spend", delta: -80},
	} {
		c.Read(r, "")
		if err := app.Save(c); err != nil {
			t.Fatal(err)
		}
		point, err := newRecord(app, "character_readings")
		if err != nil {
			t.Fatal(err)
		}
		point.Set("character", id)
		point.Set("value", r.value)
		point.Set("adapter", r.parserVersion)
		point.Set("parts", r.partsValue())
		point.Set("kind", r.kind)
		point.Set("delta", r.delta)
		if err := app.Save(point); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond)
	}
	stored, err := findAs[Character](app, "characters", id)
	if err != nil || asJSON(t, stored.PublicExport()["parts"]) != `{"base":0,"bonus":830}` {
		t.Fatalf("character parts %v, %v", stored.PublicExport()["parts"], err)
	}
	readings, _, err := historyOf(app, id, 30)
	if err != nil || len(readings) != 2 {
		t.Fatalf("%v %v", readings, err)
	}
	if got := asJSON(t, readings[1]); got != `{"adapter":"test-fixture-v1","at":"`+readings[1].(map[string]any)["at"].(string)+`","delta":-80,"kind":"spend","parts":{"base":0,"bonus":830},"value":830}` {
		t.Fatalf("history point %s", got)
	}
	// A reading of an older app clears the numbers it did not send.
	c.Read(reading{value: 840, parserVersion: "test-fixture-v1"}, "")
	if err := app.Save(c); err != nil {
		t.Fatal(err)
	}
	if stored, _ := findAs[Character](app, "characters", id); asJSON(t, stored.PublicExport()["parts"]) != `null` {
		t.Fatalf("stale parts %v", stored.PublicExport()["parts"])
	}
}
