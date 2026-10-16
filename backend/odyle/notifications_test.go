package odyle

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

func TestNotificationSettingsAreCheckedAndQuietHoursWrapMidnight(t *testing.T) {
	ok := func(n notificationSettings) notificationSettings {
		t.Helper()
		checked, err := checkNotifications(n)
		if err != nil {
			t.Fatal(err)
		}
		return checked
	}
	base := defaultNotifications()
	nine := int64(9)
	if got := ok(notificationSettings{LeadMinutes: []int64{15, 1440, 120}}).LeadMinutes; asJSON(t, got) != "[1440,120,15]" {
		t.Fatalf("leads %v", got)
	}
	for _, bad := range []notificationSettings{
		{LeadMinutes: nil}, {LeadMinutes: []int64{1, 2, 3, 4}}, {LeadMinutes: []int64{0}}, {LeadMinutes: []int64{1441}}, {LeadMinutes: []int64{15, 15}},
		{LeadMinutes: []int64{15}, Quiet: quietHours{From: "22:00"}},
		{LeadMinutes: []int64{15}, Quiet: quietHours{From: "22:00", To: "7:00", TimeZone: "Europe/Prague"}},
		{LeadMinutes: []int64{15}, Quiet: quietHours{From: "22:00", To: "22:00", TimeZone: "Europe/Prague"}},
		{LeadMinutes: []int64{15}, Quiet: quietHours{From: "22:00", To: "07:00", TimeZone: "Mars/Olympus"}},
		{LeadMinutes: []int64{15}, Quiet: quietHours{From: "22:00", To: "07:00"}},
		{LeadMinutes: []int64{15}, CapTicks: &nine},
	} {
		if _, err := checkNotifications(bad); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
	// No quiet hours drop a stray time zone.
	if q := ok(notificationSettings{LeadMinutes: []int64{15}, Quiet: quietHours{TimeZone: "Europe/Prague"}}).Quiet; q != (quietHours{}) {
		t.Fatalf("quiet %+v", q)
	}
	night := base
	night.Quiet = quietHours{From: "22:00", To: "07:00", TimeZone: "Europe/Prague"}
	for at, want := range map[string]bool{
		"2026-10-15T19:59:00Z": false, // 21:59 in Prague (summer time)
		"2026-10-15T20:00:00Z": true,  // 22:00
		"2026-10-16T04:59:00Z": true,  // 06:59
		"2026-10-16T05:00:00Z": false, // 07:00
		"2026-11-16T06:30:00Z": false, // 07:30 in winter time
	} {
		if got := night.quietAt(mustTime(t, at)); got != want {
			t.Errorf("%s: quiet %v", at, got)
		}
	}
	day := base
	day.Quiet = quietHours{From: "09:00", To: "17:00", TimeZone: "UTC"}
	if !day.quietAt(mustTime(t, "2026-10-15T12:00:00Z")) || day.quietAt(mustTime(t, "2026-10-15T18:00:00Z")) || base.quietAt(time.Now()) {
		t.Fatal("day span")
	}
}

func TestAccountsKeepTheirNotificationSettings(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Notified")
	raw, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth := map[string]string{"Authorization": raw}
	reuse := func(testing.TB) *tests.TestApp { return app }
	defaults := `"notifications":{"channels":{"tray":true,"browser":true,"push":true},"leadMinutes":[15],"kinds":{"runs":true,"cap":false},"capTicks":1,"quiet":{"from":"","to":"","timeZone":""},"saved":false}`
	saved := `{"channels":{"tray":false,"browser":true,"push":false},"leadMinutes":[15,120],"kinds":{"runs":true,"cap":true},"capTicks":2,"quiet":{"from":"23:00","to":"07:30","timeZone":"Europe/Prague"},"saved":false}`
	stored := `"notifications":{"channels":{"tray":false,"browser":true,"push":false},"leadMinutes":[120,15],"kinds":{"runs":true,"cap":true},"capTicks":2,"quiet":{"from":"23:00","to":"07:30","timeZone":"Europe/Prague"},"saved":true}`
	for _, s := range []tests.ApiScenario{
		{Name: "an account that saved none has the defaults", Method: http.MethodGet, URL: "/api/odyle/account", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{defaults}},
		{Name: "the rooms answer carries them for the Windows app", Method: http.MethodGet, URL: "/api/odyle/rooms", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{defaults}},
		{Name: "bad settings say why", Method: http.MethodPost, URL: "/api/odyle/notifications", Headers: auth, Body: strings.NewReader(`{"leadMinutes":[15,15]}`),
			ExpectedStatus: 400, ExpectedContent: []string{"Choose different reminder times."}},
		{Name: "a whole save", Method: http.MethodPost, URL: "/api/odyle/notifications", Headers: auth, Body: strings.NewReader(saved), ExpectedStatus: 200, ExpectedContent: []string{stored}},
		{Name: "the account page reads them", Method: http.MethodGet, URL: "/api/odyle/account", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{stored}},
		{Name: "browser reminders read them with the runs", Method: http.MethodGet, URL: "/api/odyle/upcoming", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{stored}},
		{Name: "the export has them", Method: http.MethodGet, URL: "/api/odyle/export", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"notifications":{"channels":{"tray":false`}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
}
