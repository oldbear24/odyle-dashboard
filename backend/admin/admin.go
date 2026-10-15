// Package admin holds the Odyle page of the PocketBase superuser dashboard, a
// PocketBase UI extension. The files are browser code: PocketBase concatenates
// main.js into /_/extensions.js and serves the others under /_/extensions/odyle/.
package admin

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"sync"
)

//go:embed main.js odyle.js odyle.css
var Files embed.FS

// Version is the content hash of the page (odyle.js and odyle.css). PocketBase serves
// extension files with a 14-day browser cache, so main.js (fetched on every load)
// imports the page under this hash and a deploy reaches open dashboards at once.
var Version = sync.OnceValue(func() string {
	page, _ := Files.ReadFile("odyle.js")
	style, _ := Files.ReadFile("odyle.css")
	sum := sha256.Sum256([]byte(string(page) + "\n" + string(style)))
	return hex.EncodeToString(sum[:])[:16]
})
