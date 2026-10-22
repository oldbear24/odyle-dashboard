package odyle

import (
	"net/http"
	"testing"
)

// A vacuum by hand gives the free pages of deleted rows back, is recorded for Server
// status, runs one at a time and is for superusers only.
func TestVacuumGivesFreePagesBack(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "Lead")
	if _, err := app.NonconcurrentDB().NewQuery("CREATE TABLE padding (data TEXT)").Execute(); err != nil {
		t.Fatal(err)
	}
	for range 200 {
		if _, err := app.NonconcurrentDB().NewQuery("INSERT INTO padding VALUES (hex(randomblob(4096)))").Execute(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := app.NonconcurrentDB().NewQuery("DROP TABLE padding").Execute(); err != nil {
		t.Fatal(err)
	}
	if freeBytes(app, "data") == 0 {
		t.Fatal("dropping the table freed no pages")
	}
	record, ok := vacuum(app, "data")
	if !ok || record.Error != "" || record.At == "" {
		t.Fatalf("vacuum %v %+v", ok, record)
	}
	if free := freeBytes(app, "data"); free != 0 {
		t.Fatalf("%d bytes still free", free)
	}
	status := databaseStatus(app)
	if got, _ := status.get("vacuums"); got.(*object).values["data"] == nil {
		t.Fatalf("not recorded: %v", status.values)
	}
	if record, ok := vacuum(app, "logs"); !ok || record.Error != "" {
		t.Fatalf("logs %v %+v", ok, record)
	}

	stateOf(app).vacuuming = "data"
	if _, ok := vacuum(app, "logs"); ok {
		t.Fatal("ran beside another vacuum")
	}
	stateOf(app).vacuuming = ""

	ask(t, app, http.MethodPost, "/api/odyle/admin/vacuum/data", tokenOf(t, lead), "", 403)
}
