package migrations

import (
	"regexp"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
	"github.com/pocketbase/pocketbase/tests"
)

func newMigratedApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir(), EncryptionEnv: "pb_test_env"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

var placeholder = regexp.MustCompile(`\{(APP_NAME|APP_URL|TOKEN|OTP|OTP_ID|ALERT_INFO|RECORD:[^}]*)\}`)

// Every email PocketBase sends to an account or a superuser comes in the dashboard's
// look, with each placeholder filled in.
func TestMailTemplates(t *testing.T) {
	app := newMigratedApp(t)
	app.Settings().Meta.AppURL = "https://odyle.example"
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("aria@test.invalid")
	user.SetPassword("password-for-tests-only")
	user.Set("displayName", "Aria <3")
	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(superusers)
	superuser.SetEmail("operator@test.invalid")
	superuser.SetPassword("password-for-tests-only")
	if err := saveAll(app, user, superuser); err != nil {
		t.Fatal(err)
	}
	for _, record := range []*core.Record{user, superuser} {
		for _, send := range []struct {
			kind, subject string
			contains      []string
			send          func() error
		}{
			{"verification", "Confirm your Odyle Party email", []string{"https://odyle.example/_/#/auth/confirm-verification/ey"}, func() error { return mails.SendRecordVerification(app, record) }},
			{"resetPassword", "Reset your Odyle Party password", []string{"https://odyle.example/_/#/auth/confirm-password-reset/ey"}, func() error { return mails.SendRecordPasswordReset(app, record) }},
			{"confirmEmailChange", "Confirm your new Odyle Party email", []string{"https://odyle.example/_/#/auth/confirm-email-change/ey"}, func() error { return mails.SendRecordChangeEmail(app, record, "new@test.invalid") }},
			{"otp", "Your Odyle Party sign-in code", []string{">12345678</p>"}, func() error { return mails.SendRecordOTP(app, record, "otp-id", "12345678") }},
			{"authAlert", "New sign-in to your Odyle Party account", []string{"203.0.113.7 Firefox &lt;test&gt;"}, func() error {
				return mails.SendRecordAuthAlert(app, record, "2026-10-16 08:00:00.000Z - 203.0.113.7 Firefox <test>")
			}},
		} {
			app.TestMailer.Reset()
			if err := send.send(); err != nil {
				t.Fatalf("%s to %s: %v", send.kind, record.Email(), err)
			}
			message := app.TestMailer.LastMessage()
			if message.Subject != send.subject {
				t.Errorf("%s to %s: subject %q", send.kind, record.Email(), message.Subject)
			}
			contains := append([]string{`odyle<span style="color:#b5f2cd">.</span>`, `bgcolor="#101514"`, `>Odyle Party</a>`}, send.contains...)
			if record == user {
				contains = append(contains, "Hi Aria &lt;3,")
			}
			if send.kind == "authAlert" && record == user {
				contains = append(contains, "Sign out everywhere", `href="https://odyle.example/#/account"`)
			}
			if send.kind == "authAlert" && record == superuser {
				contains = append(contains, "change your superuser password", `href="https://odyle.example/_/"`)
			}
			for _, part := range contains {
				if !strings.Contains(message.HTML, part) {
					t.Errorf("%s to %s: no %q in\n%s", send.kind, record.Email(), part, message.HTML)
				}
			}
			if left := placeholder.FindAllString(message.Subject+message.HTML, -1); len(left) > 0 {
				t.Errorf("%s to %s: placeholders left: %v", send.kind, record.Email(), left)
			}
			if strings.Contains(message.HTML, "Odyle Party team") {
				t.Errorf("%s to %s: PocketBase's stock text", send.kind, record.Email())
			}
		}
	}
}

// Templates a superuser edited stay as they are when the migration runs and when it is
// undone; the others go back to PocketBase's and come back.
func TestMailTemplatesKeepEdits(t *testing.T) {
	app := newMigratedApp(t)
	edited := core.EmailTemplate{Subject: "Our own reset", Body: "<p>{TOKEN}</p>"}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.ResetPasswordTemplate = edited
	if err := app.Save(users); err != nil {
		t.Fatal(err)
	}
	check := func(stage string, want func(name, kind string) core.EmailTemplate) {
		t.Helper()
		for _, name := range []string{"users", core.CollectionNameSuperusers} {
			c, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				t.Fatal(err)
			}
			for kind, got := range mailTemplatesOf(c) {
				if name == "users" && kind == "resetPassword" {
					if *got != edited {
						t.Errorf("%s: the edited template became %q", stage, got.Subject)
					}
				} else if w := want(name, kind); *got != w {
					t.Errorf("%s: %s %s is %q, not %q", stage, name, kind, got.Subject, w.Subject)
				}
			}
		}
	}
	stock := mailTemplatesOf(core.NewAuthCollection("stock"))
	ours := func(name, kind string) core.EmailTemplate {
		return odyleMails(name == core.CollectionNameSuperusers)[kind]
	}
	check("migrated", ours)
	if err := swapMailTemplates(app, true); err != nil {
		t.Fatal(err)
	}
	check("undone", func(_, kind string) core.EmailTemplate { return *stock[kind] })
	if err := swapMailTemplates(app, false); err != nil {
		t.Fatal(err)
	}
	check("migrated again", ours)
}
