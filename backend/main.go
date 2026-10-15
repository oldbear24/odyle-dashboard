// The Odyle backend: PocketBase with the Odyle routes, jobs and migrations compiled
// in, serving the dashboard from pb_public. Run it like PocketBase:
//
//	odyle serve --http=127.0.0.1:8090 --dir=pb_data --publicDir=dist
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/osutils"

	_ "github.com/oldbear24/odyle-dashboard/backend/migrations"
	"github.com/oldbear24/odyle-dashboard/backend/odyle"
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

	// The dashboard, from the public dir (if the route path is not already defined).
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", apis.Static(os.DirFS(publicDir), indexFallback))
			}
			return e.Next()
		},
		Priority: 999, // execute as late as possible
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// The default pb_public dir sits next to the executable.
func defaultPublicDir() string {
	if osutils.IsProbablyGoRun() {
		return "./pb_public"
	}
	return filepath.Join(os.Args[0], "../pb_public")
}
