package odyle

import (
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The newest release of the Windows companion, so the dashboard can offer its download
// with the version. The backend asks GitHub's API at most every ten minutes and serves
// that answer to every browser: visitors never contact GitHub and the unauthenticated
// API limit is never reached. When GitHub cannot be reached the last known release is
// kept, and without one the dashboard still gets the stable "latest release" page link.

func repository() string {
	if v := os.Getenv("ODYLE_WINDOWS_REPOSITORY"); v != "" {
		return v
	}
	return "oldbear24/odyle-windows"
}

func feedURL() string {
	if v := os.Getenv("ODYLE_WINDOWS_RELEASE_URL"); v != "" {
		return v
	}
	return "https://api.github.com/repos/" + repository() + "/releases/latest"
}

const releaseFresh, releaseRetry = 10 * time.Minute, time.Minute

// Package names from the release workflow: odyle-<version>-<runtime>[-self-contained].zip
// and the per-user installer odyle-<version>-win-x64-setup.exe.
var packageName = regexp.MustCompile(`^odyle-(\d+(?:\.\d+){1,3})-(win-x64|win-arm64)(-self-contained)?\.zip$`)
var installerName = regexp.MustCompile(`^odyle-(\d+(?:\.\d+){1,3})-win-x64-setup\.exe$`)
var releaseVersion = regexp.MustCompile(`^\d+(\.\d+){1,3}$`)

func fromGitHub(link any) bool {
	s, ok := link.(string)
	return ok && strings.HasPrefix(s, "https://github.com/")
}

func textOf(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		if x {
			return "true"
		}
		return ""
	}
	return ""
}

func sizeOf(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		if f, err := strconv.ParseFloat(trim(x), 64); err == nil {
			return f
		}
	case bool:
		if x {
			return 1
		}
	}
	return 0
}

func truthy(v any) bool { return body{"v": v}.set("v") }

func fetchLatest() (map[string]any, error) {
	res, err := send("GET", feedURL(), map[string]string{"accept": "application/vnd.github+json", "user-agent": userAgent}, nil, 10*time.Second)
	if err != nil {
		return nil, err
	}
	if res.status != 200 {
		return nil, errors.New("GitHub answered " + strconv.Itoa(res.status) + ".")
	}
	data, _ := res.json().(map[string]any)
	version := strings.TrimPrefix(textOf(data["tag_name"]), "v")
	if !releaseVersion.MatchString(version) || truthy(data["draft"]) || truthy(data["prerelease"]) {
		return nil, errors.New("The latest release is not a versioned release.")
	}
	// x64 packages stay under small/selfContained for older dashboards; ARM64 ones sit
	// under arm64. Checksums stay with the Windows app, which verifies its own downloads.
	packages := map[string]any{}
	assets, _ := data["assets"].([]any)
	for _, raw := range assets {
		asset, _ := raw.(map[string]any)
		name := textOf(asset["name"])
		if !fromGitHub(asset["browser_download_url"]) {
			continue
		}
		file := map[string]any{"name": name, "size": sizeOf(asset["size"]), "url": asset["browser_download_url"]}
		kind := "small"
		if match := packageName.FindStringSubmatch(name); installerName.MatchString(name) {
			packages["installer"] = file
		} else if match != nil {
			if match[3] != "" {
				kind = "selfContained"
			}
			if match[2] == "win-x64" {
				packages[kind] = file
			} else {
				arm64, _ := packages["arm64"].(map[string]any)
				if arm64 == nil {
					arm64 = map[string]any{}
					packages["arm64"] = arm64
				}
				arm64[kind] = file
			}
		}
	}
	link := "https://github.com/" + repository() + "/releases/latest"
	if fromGitHub(data["html_url"]) {
		link = data["html_url"].(string)
	}
	return map[string]any{"version": version, "tag": textOf(data["tag_name"]), "url": link, "publishedAt": textOf(data["published_at"]), "packages": packages}, nil
}

// latestRelease answers the cached release, asking GitHub when the cache is older than
// ten minutes (a minute after a failed lookup).
func latestRelease(app core.App) map[string]any {
	s := stateOf(app)
	s.mu.Lock()
	cached, release, at := s.releaseChecked, s.release, s.releaseAt
	s.mu.Unlock()
	wait := releaseRetry
	if release != nil {
		wait = releaseFresh
	}
	if cached && time.Since(at) < wait {
		return release
	}
	if found, err := fetchLatest(); err != nil {
		logf("Odyle release lookup failed: %v", err)
	} else {
		release = found
	}
	s.mu.Lock()
	s.releaseChecked, s.release, s.releaseAt = true, release, time.Now()
	s.mu.Unlock()
	return release
}

func windowsRelease(e *core.RequestEvent) error {
	var latest any
	if release := latestRelease(e.App); release != nil {
		latest = release
	}
	return e.JSON(200, map[string]any{"repository": repository(), "releasesUrl": "https://github.com/" + repository() + "/releases/latest", "latest": latest})
}
