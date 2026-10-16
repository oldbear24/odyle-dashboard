package odyle

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func asJSON(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// fields picks the named values of each object.
func fields(objects []*object, names ...string) [][]any {
	out := [][]any{}
	for _, o := range objects {
		row := []any{}
		for _, name := range names {
			row = append(row, o.values[name])
		}
		out = append(out, row)
	}
	return out
}

func TestTheLastHourOfTrafficIsCountedPerMinuteRouteAndReason(t *testing.T) {
	at := time.Date(2026, 10, 15, 8, 0, 30, 0, time.UTC)
	tr, outdated := newTraffic(), errors.New("Outdated reading.")
	tr.record(at, "report", "app", 3, nil)
	tr.record(at, "report", "app", 40, outdated)
	tr.record(at, "heartbeat", "app", 0, nil)
	tr.record(at, "GET rooms", "read", 7, nil)
	at = at.Add(time.Minute)
	tr.record(at, "task", "web", 1, nil)
	tr.record(at, "report", "app", 6000, outdated)
	summary := tr.summary(at)
	minutes := summary.values["minutes"].([]*object)
	if len(minutes) != 60 {
		t.Fatalf("%d minutes", len(minutes))
	}
	// Accepted requests by source; rejected ones from any source.
	if got := asJSON(t, minutes[58:]); got != `[{"at":"2026-10-15T08:00:00.000Z","app":2,"web":0,"read":1,"rejected":1},{"at":"2026-10-15T08:01:00.000Z","app":0,"web":1,"read":0,"rejected":1}]` {
		t.Errorf("last minutes = %s", got)
	}
	for _, m := range minutes[:58] {
		if m.values["app"].(int)+m.values["web"].(int)+m.values["read"].(int)+m.values["rejected"].(int) != 0 {
			t.Errorf("quiet minute %s counted requests", asJSON(t, m))
		}
	}
	// Median and 95 % are the upper bounds of their time step, the slowest time beyond the last.
	if got := asJSON(t, summary.values["total"]); got != `{"count":6,"rejected":2,"averageMs":1008.5,"medianMs":5,"p95Ms":6000,"maxMs":6000}` {
		t.Errorf("total = %s", got)
	}
	routes := summary.values["routes"].([]*object)
	if got := asJSON(t, fields(routes, "kind", "source", "count", "rejected")); got != `[["report","app",3,2],["GET rooms","read",1,0],["heartbeat","app",1,0],["task","web",1,0]]` {
		t.Errorf("routes = %s", got)
	}
	if got := asJSON(t, routes[0]); got != `{"kind":"report","source":"app","count":3,"rejected":2,"averageMs":2014.3,"medianMs":50,"p95Ms":6000,"maxMs":6000}` {
		t.Errorf("report = %s", got)
	}
	if got := asJSON(t, routes[1]); got != `{"kind":"GET rooms","source":"read","count":1,"rejected":0,"averageMs":7,"medianMs":7,"p95Ms":7,"maxMs":7}` {
		t.Errorf("GET rooms = %s", got)
	}
	if got := asJSON(t, summary.values["errors"]); got != `[{"kind":"report","message":"Outdated reading.","count":2,"lastAt":"2026-10-15T08:01:30.000Z"}]` {
		t.Errorf("errors = %s", got)
	}
	// An hour later the first minute has left the summary and the next request removes it.
	at = at.Add(59 * time.Minute)
	summary = tr.summary(at)
	if got := summary.values["minutes"].([]*object)[0].values["at"]; got != "2026-10-15T08:01:00.000Z" {
		t.Errorf("first minute = %v", got)
	}
	if got := asJSON(t, fields(summary.values["routes"].([]*object), "kind", "count")); got != `[["report",1],["task",1]]` {
		t.Errorf("routes = %s", got)
	}
	tr.record(at, "heartbeat", "app", 0, nil)
	if len(tr.minutes) != 2 {
		t.Errorf("%d minutes kept", len(tr.minutes))
	}
	// However long the server was quiet, nothing older than the hour stays behind.
	at = at.Add(5 * time.Hour)
	tr.record(at, "heartbeat", "app", 0, nil)
	if len(tr.minutes) != 1 {
		t.Errorf("%d minutes kept", len(tr.minutes))
	}
	if got := asJSON(t, tr.summary(at).values["total"]); got != `{"count":1,"rejected":0,"averageMs":0,"medianMs":0,"p95Ms":0,"maxMs":0}` {
		t.Errorf("total = %s", got)
	}
}

func TestAnEmptyHourHasSixtyQuietMinutesAndNoRoutes(t *testing.T) {
	summary := newTraffic().summary(time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC))
	minutes := summary.values["minutes"].([]*object)
	if len(minutes) != 60 || minutes[59].values["at"] != "2026-10-15T08:00:00.000Z" {
		t.Fatalf("minutes = %s", asJSON(t, minutes))
	}
	if got := asJSON(t, []any{summary.values["total"], summary.values["routes"], summary.values["errors"]}); got != `[{"count":0,"rejected":0},[],[]]` {
		t.Errorf("summary = %s", got)
	}
}

// Past twenty reasons a minute, rejections are still counted, just not explained.
func TestRejectionReasonsAreCappedPerMinute(t *testing.T) {
	at, tr := time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC), newTraffic()
	for i := range 25 {
		tr.record(at, "report", "app", 1, errors.New(string(rune('A'+i))))
	}
	summary := tr.summary(at)
	if got := summary.values["total"].(*object).values["rejected"]; got != 25 {
		t.Errorf("rejected = %v", got)
	}
	if got := len(summary.values["errors"].([]*rejection)); got != trafficReasons {
		t.Errorf("%d reasons", got)
	}
}

// Requests from private or loopback addresses are counted for the hour like the rest.
func TestPrivateClientsAreCountedForTheHour(t *testing.T) {
	at, tr := time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC), newTraffic()
	for range 3 {
		tr.record(at, "heartbeat", "app", 0, nil)
	}
	tr.fromPrivate(at)
	tr.fromPrivate(at.Add(time.Minute))
	if got := tr.summary(at.Add(time.Minute)).values["private"]; got != 2 {
		t.Errorf("private = %v", got)
	}
	if got := tr.summary(at.Add(time.Hour)).values["private"]; got != 1 {
		t.Errorf("an hour later, private = %v", got)
	}
	if got := newTraffic().summary(at).values["private"]; got != 0 {
		t.Errorf("an empty hour, private = %v", got)
	}
}
