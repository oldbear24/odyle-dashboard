// Package odyle is the Odyle backend on PocketBase: the /api/odyle routes the dashboard
// and the Windows app use, the realtime room checks, the background jobs and the Odyle
// page of the superuser dashboard. The HTTP contract is described in docs/api.md.
package odyle

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/oldbear24/odyle-dashboard/backend/admin"
)

type action struct {
	name   string
	handle func(*core.RequestEvent) error
}

// POST /api/odyle/<action> for signed-in accounts.
var accountActions = []action{
	{"create", create}, {"join", join}, {"character", character}, {"report", report}, {"heartbeat", heartbeat}, {"sharing", sharing}, {"wishlist", wishlist},
	{"task", checklistTask}, {"session", session}, {"invalidate", invalidate}, {"leave", leave}, {"close", closeRoom}, {"invites", invites}, {"revoke", revoke},
	{"rename", rename}, {"role", role}, {"transfer", transfer}, {"plan", plan}, {"discord-webhook", discordWebhook}, {"profile", profile},
	{"desktop-code", desktopCode}, {"desktop-device", desktopDevice}, {"forget-device", forgetDevice}, {"sign-out-everywhere", signOutEverywhere},
	{"delete-account", deleteAccount}, {"delete-character", deleteCharacter},
}

// Public like pairing: a paired Windows app signs in, or forgets its pairing, with its device key.
var publicActions = []action{{"pair", pair}, {"desktop-sign-in", desktopSignIn}, {"unpair", unpair}}

// testFixtures adds the routes of the disposable test backend (build tag odyletest).
var testFixtures func(se *core.ServeEvent)

// Register adds Odyle to a PocketBase app.
func Register(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Superuser dashboard → Odyle (backend/admin, a PocketBase UI extension).
		se.UIExtensions = append(se.UIExtensions, core.UIExtension{Name: "odyle", FS: admin.Files})
		se.Router.BindFunc(hardening)
		routes(se)
		if testFixtures != nil {
			testFixtures(se)
		}
		return se.Next()
	})

	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		for _, topic := range e.Subscriptions {
			if room, ok := strings.CutPrefix(topic, "odyle.room."); ok {
				if e.Auth == nil || e.Auth.Collection().Name != "users" {
					return apis.NewForbiddenError("", nil)
				}
				if _, err := membership(e.App, e.Auth.Id, room); err != nil {
					return err
				}
			} else if strings.HasPrefix(topic, "odyle.admin.") && !(e.Auth != nil && e.Auth.IsSuperuser()) {
				return apis.NewForbiddenError("", nil)
			}
		}
		return e.Next()
	})

	// Every delivery checks again, so a removed member or an expired sign-in hears nothing more.
	app.OnRealtimeMessageSend().BindFunc(func(e *core.RealtimeMessageEvent) error {
		auth, _ := e.Client.Get(apis.RealtimeClientAuthKey).(*core.Record)
		if room, ok := strings.CutPrefix(e.Message.Name, "odyle.room."); ok {
			if auth == nil || auth.Collection().Name != "users" {
				return nil
			}
			if _, err := membership(e.App, auth.Id, room); err != nil {
				return nil
			}
		} else if strings.HasPrefix(e.Message.Name, "odyle.admin.") && (auth == nil || !auth.IsSuperuser()) {
			return nil
		}
		return e.Next()
	})

	// The Background jobs page counts from this server start.
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		s := stateOf(e.App)
		s.mu.Lock()
		s.startedAt = now()
		s.mu.Unlock()
		return configureDiscord(e.App)
	})

	// Every account deletion (by its owner, in the superuser dashboard or for inactivity)
	// first passes the rooms it owns to another player or closes them.
	app.OnRecordDelete("users").BindFunc(func(e *core.RecordEvent) error {
		if err := handOver(e.App, e.Record.Id); err != nil {
			return err
		}
		return e.Next()
	})

	watchSettings(app)
	scheduleJobs(app)
}

func routes(se *core.ServeEvent) {
	signedIn, small := apis.RequireAuth("users"), apis.BodyLimit(4096)
	// Every request also feeds the superuser dashboard's packet list.
	for _, a := range accountActions {
		se.Router.POST("/api/odyle/"+a.name, observed(a.name, a.handle)).Bind(signedIn, small)
	}
	for _, a := range publicActions {
		se.Router.POST("/api/odyle/"+a.name, observed(a.name, a.handle)).Bind(small)
	}
	// Reads are timed for the superuser dashboard's Server status page (traffic.go).
	se.Router.GET("/api/odyle/rooms", timed("rooms", rooms)).Bind(signedIn)
	se.Router.GET("/api/odyle/tasks", timed("tasks", tasks)).Bind(signedIn)
	se.Router.GET("/api/odyle/snapshot/{id}", timed("snapshot", snapshot)).Bind(signedIn)
	se.Router.GET("/api/odyle/history/{id}", timed("history", history)).Bind(signedIn)
	se.Router.GET("/api/odyle/upcoming", timed("upcoming", upcoming)).Bind(signedIn)
	se.Router.GET("/api/odyle/account", timed("account", account)).Bind(signedIn)
	se.Router.GET("/api/odyle/export", timed("export", exportData)).Bind(signedIn)
	// Public: the newest Windows companion release, cached from GitHub (no account data involved).
	se.Router.GET("/api/odyle/windows-release", timed("windows-release", windowsRelease))
	// Public: the message superusers set under Server controls, for the dashboard (signed in or not).
	se.Router.GET("/api/odyle/announcement", timed("announcement", func(e *core.RequestEvent) error {
		return e.JSON(200, map[string]any{"announcement": announcement(readSettings(e.App))})
	}))
	// Superuser dashboard → Odyle: connected Windows apps, live requests, server status,
	// background jobs and the server-wide settings (monitor.go).
	superuser := apis.RequireSuperuserAuth()
	se.Router.GET("/api/odyle/admin/ui", uiVersion)
	se.Router.GET("/api/odyle/admin/monitor", monitor).Bind(superuser)
	se.Router.GET("/api/odyle/admin/status", status).Bind(superuser)
	se.Router.GET("/api/odyle/admin/jobs", jobsRoute).Bind(superuser)
	se.Router.POST("/api/odyle/admin/jobs/{name}", runJobRoute).Bind(superuser)
	se.Router.GET("/api/odyle/admin/settings", settingsRoute).Bind(superuser)
	// A full dungeon catalog (200 names of up to 60 characters) needs more than the 4 KB of the other routes.
	se.Router.POST("/api/odyle/admin/settings", saveSettingsRoute).Bind(superuser, apis.BodyLimit(65536))
}

// The cookie that marks browsers which dropped their cache of the superuser dashboard.
var entryCookie = regexp.MustCompile(`(?:^|;\s*)odyle_entry=1(?:;|$)`)

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"

// hardening adds browser hardening to the dashboard pages and files it serves. API and
// admin responses are left alone: the OAuth redirect page and the PocketBase UI need
// inline scripts, and JSON needs none of these headers.
func hardening(e *core.RequestEvent) error {
	path, headers := e.Request.URL.Path, e.Response.Header()
	// PocketBase lets browsers keep the superuser dashboard's extension entry (admin/main.js)
	// for 14 days unless a header is already set, so a changed entry would miss them that long.
	if path == "/_/extensions.js" {
		headers.Set("Cache-Control", "no-cache")
	} else if path == "/_/" && e.Request.Method == http.MethodGet && !entryCookie.MatchString(e.Request.Header.Get("Cookie")) {
		// Browsers that opened the superuser dashboard before that header keep their old entry
		// without asking again, the Odyle link out of sight on phones included. Their HTTP cache
		// of this site is dropped once, on the next visit to the dashboard, so they fetch the
		// current entry; the cookie marks browsers that have done it.
		headers.Set("Clear-Site-Data", `"cache"`)
		headers.Add("Set-Cookie", "odyle_entry=1; Path=/_/; Max-Age=31536000; SameSite=Lax; HttpOnly")
	} else if !strings.HasPrefix(path, "/api/") && !strings.HasPrefix(path, "/_/") {
		headers.Set("Content-Security-Policy", contentSecurityPolicy)
		headers.Set("X-Frame-Options", "DENY")
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("Referrer-Policy", "no-referrer")
	}
	return e.Next()
}
