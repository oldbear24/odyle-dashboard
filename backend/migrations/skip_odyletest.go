//go:build odyletest

package migrations

import (
	"os"
	"strings"
)

// The disposable test backend leaves out the migrations listed in
// ODYLE_TEST_SKIP_MIGRATIONS, so the integration tests can start an older database and
// check that an upgrade keeps its data.
func skipped(file string) bool {
	for _, name := range strings.Split(os.Getenv("ODYLE_TEST_SKIP_MIGRATIONS"), ",") {
		if strings.TrimSpace(name) == file {
			return true
		}
	}
	return false
}
