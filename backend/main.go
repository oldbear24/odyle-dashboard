// The Odyle backend: PocketBase with the Odyle routes, jobs, migrations and the
// dashboard compiled in (backend/web). Run it like PocketBase:
//
//	odyle serve --http=127.0.0.1:8090 --dir=pb_data
//
// --publicDir=dist serves a dashboard folder instead, for example while developing; a
// build without the dashboard serves pb_public next to the executable. odyle healthcheck
// asks a running server whether it is healthy.
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/migratecmd"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/osutils"

	_ "github.com/oldbear24/odyle-dashboard/backend/migrations"
	"github.com/oldbear24/odyle-dashboard/backend/odyle"
	"github.com/oldbear24/odyle-dashboard/backend/web"
)

func main() {
	app := pocketbase.New()

	var publicDir string
	var indexFallback bool
	app.RootCmd.PersistentFlags().StringVar(&publicDir, "publicDir", defaultPublicDir(), "the directory to serve static files")
	app.RootCmd.PersistentFlags().BoolVar(&indexFallback, "indexFallback", true, "fallback the request to index.html on missing static path, e.g. when pretty urls are used with SPA")
	app.RootCmd.ParseFlags(os.Args[1:])

	// migrate up, down and history-sync; the migrations are compiled in (backend/migrations).
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{TemplateLang: migratecmd.TemplateLangGo, Automigrate: false})

	odyle.Register(app)
	app.RootCmd.AddCommand(healthcheck())

	// While no superuser exists, PocketBase opens a browser at its installer link. Odyle never
	// does: it runs in a container, as the test server of the dashboard and Windows checks and
	// next to a developer's own browser, so it only prints the link.
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.InstallerFunc = printInstaller
		return e.Next()
	})

	// The dashboard (if the route path is not already defined).
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				serve, err := dashboard(app.RootCmd.PersistentFlags().Changed("publicDir"), publicDir, indexFallback)
				if err != nil {
					return err
				}
				e.Router.GET("/{path...}", serve)
			}
			return e.Next()
		},
		Priority: 999, // execute as late as possible
	})

	// The health check runs on its own: app.Start would open the data first.
	if cmd, _, err := app.RootCmd.Find(os.Args[1:]); err == nil && cmd.Name() == "healthcheck" {
		if err := app.RootCmd.Execute(); err != nil {
			log.Fatal(err)
		}
		return
	}

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// printInstaller prints the link that creates the first superuser, valid for 30 minutes.
func printInstaller(app core.App, systemSuperuser *core.Record, baseURL string) error {
	token, err := systemSuperuser.NewStaticAuthToken(30 * time.Minute)
	if err != nil {
		return err
	}
	fmt.Printf("\n(!) Open this link in a browser within 30 minutes to create your first superuser account:\n%s/_/#/pbinstall/%s\n(or run: %s superuser upsert EMAIL PASS)\n\n", strings.TrimRight(baseURL, "/"), token, filepath.Base(os.Args[0]))
	return nil
}

// dashboard serves the dashboard compiled in, or the public dir when --publicDir names
// one or the binary holds none.
func dashboard(chosen bool, publicDir string, indexFallback bool) (func(*core.RequestEvent) error, error) {
	if built := web.Dashboard(); built != nil && !chosen {
		return web.Serve(built, indexFallback)
	}
	return apis.Static(os.DirFS(publicDir), indexFallback), nil
}

// The default pb_public dir sits next to the executable.
func defaultPublicDir() string {
	if osutils.IsProbablyGoRun() {
		return "./pb_public"
	}
	return filepath.Join(os.Args[0], "../pb_public")
}
