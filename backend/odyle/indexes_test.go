package odyle

import (
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
)

// The lookups of the calendar feed, the data export, the achievements and account deletion
// use an index instead of reading the whole table.
func TestLookupsUseAnIndex(t *testing.T) {
	app := newTestApp(t)
	for name, query := range map[string]string{
		"calendar feed":   "SELECT id FROM users WHERE calendarDigest = {:value} LIMIT 1",
		"rooms owned":     "SELECT id FROM party_rooms WHERE owner = {:value}",
		"links made":      "SELECT id FROM room_invites WHERE createdBy = {:value}",
		"links made used": "SELECT COALESCE(SUM(uses), 0) FROM room_invites WHERE createdBy = {:value}",
	} {
		var steps []struct {
			Detail string `db:"detail"`
		}
		if err := app.DB().NewQuery("EXPLAIN QUERY PLAN " + query).Bind(dbx.Params{"value": "x"}).All(&steps); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		plan := []string{}
		for _, s := range steps {
			plan = append(plan, s.Detail)
		}
		if got := strings.Join(plan, "; "); !strings.Contains(got, "USING INDEX") && !strings.Contains(got, "USING COVERING INDEX") {
			t.Errorf("%s reads %q", name, got)
		}
	}
}
