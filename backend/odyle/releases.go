package odyle

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The newest release of the Windows companion, so the dashboard can offer its download
// with the version. The backend asks GitHub's API every two minutes (the odyle-release job;
// a run by hand asks at once) and serves that answer to every browser: visitors never
// contact GitHub and the unauthenticated API limit (60 an hour) is never reached. A release
// newer than the one known is news for every open dashboard and running app (tellEveryone).
// When GitHub cannot be reached the last known release is kept, and without one the
// dashboard still gets the stable "latest release" page link.

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

// answer is one lookup at GitHub.
type answer struct {
	release   map[string]any // the release, or nil when unchanged (304)
	etag      string         // to ask whether it changed since
	notBefore time.Time      // GitHub's rate limit: no lookup before then
}

// fetchLatest asks GitHub for the latest release. With the ETag of the release already
// known, GitHub answers 304 when it is unchanged, and that answer does not count
// against its rate limit.
func fetchLatest(etag string) (answer, error) {
	headers := map[string]string{"accept": "application/vnd.github+json", "user-agent": userAgent}
	if etag != "" {
		headers["if-none-match"] = etag
	}
	// GitHub redirects the API of a renamed or moved repository.
	res, err := send(call{method: "GET", url: feedURL(), headers: headers, timeout: 10 * time.Second, limit: 2 << 20, redirects: []string{"api.github.com"}})
	if err != nil {
		return answer{}, err
	}
	if res.status == http.StatusNotModified && etag != "" {
		return answer{etag: etag}, nil
	}
	if res.status != 200 {
		failure := errors.New("GitHub answered " + strconv.Itoa(res.status) + ".")
		if until := rateLimited(res); !until.IsZero() {
			failure = errors.New("GitHub answered " + strconv.Itoa(res.status) + ": rate limited until " + until.UTC().Format("15:04") + " UTC.")
			return answer{notBefore: until}, failure
		}
		return answer{}, failure
	}
	release, err := parseRelease(res)
	return answer{release: release, etag: res.header.Get("ETag")}, err
}

// rateLimited is when GitHub's rate limit lets the backend ask again, or zero when the
// answer is not about the rate limit.
func rateLimited(res response) time.Time {
	if res.status != http.StatusForbidden && res.status != http.StatusTooManyRequests {
		return time.Time{}
	}
	if wait := retryAfter(res); wait > 0 {
		return time.Now().Add(wait)
	}
	if res.header.Get("X-RateLimit-Remaining") == "0" {
		if reset, err := strconv.ParseInt(res.header.Get("X-RateLimit-Reset"), 10, 64); err == nil {
			return time.Unix(reset, 0)
		}
	}
	return time.Time{}
}

func parseRelease(res response) (map[string]any, error) {
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
	return map[string]any{"version": version, "tag": textOf(data["tag_name"]), "url": link, "publishedAt": textOf(data["published_at"]), "packages": packages, "changes": releaseChanges(textOf(data["body"]))}, nil
}

// releaseChanges reads what a release changed from its notes, between <!-- changes --> and
// <!-- /changes --> (the release workflows write them from CHANGELOG.md): groups of "### Title"
// and "- " entries, at most 6 groups of 20, for the dashboard's What's new. Notes without the
// markers (releases before the changelog) have none.
func releaseChanges(notes string) []map[string]any {
	out := []map[string]any{}
	start, end := strings.Index(notes, "<!-- changes -->"), strings.Index(notes, "<!-- /changes -->")
	if start < 0 || end < start {
		return out
	}
	var group map[string]any
	for _, line := range strings.Split(notes[start:end], "\n") {
		line = trim(line)
		if title, ok := strings.CutPrefix(line, "### "); ok && len(out) < 6 {
			group = map[string]any{"title": cut(trim(title), 40), "items": []string{}}
			out = append(out, group)
		} else if item, ok := strings.CutPrefix(line, "- "); ok && group != nil {
			if items := group["items"].([]string); len(items) < 20 {
				group["items"] = append(items, cut(trim(item), 400))
			}
		}
	}
	return out
}

// latestRelease answers the cached release. GitHub is asked again when the cache is
// older than ten minutes (a minute while no release is known, and never before its
// rate limit allows). Requests do not wait for that lookup: they get the release known
// so far while it runs in the background, and only a request that finds no release at
// all waits for it. Requests that arrive meanwhile share the one lookup. The backend
// also looks the release up when it starts (Register), so visitors rarely wait. The
// cache keeps when GitHub last answered and why the last lookup failed, for the
// superuser dashboard's Server status page.
func latestRelease(app core.App) map[string]any {
	s := stateOf(app)
	s.mu.Lock()
	release, wait := s.release, releaseRetry
	if release != nil {
		wait = releaseFresh
	}
	at := time.Now()
	if s.releaseChecked && at.Sub(s.releaseAt) < wait || at.Before(s.releaseNotBefore) {
		s.mu.Unlock()
		return release
	}
	lookup := s.releaseInFlight
	if lookup == nil {
		lookup = make(chan struct{})
		s.releaseInFlight = lookup
		etag := ""
		if release != nil {
			etag = s.releaseETag
		}
		go lookUpRelease(app, etag, lookup)
	}
	s.mu.Unlock()
	if release != nil {
		return release
	}
	<-lookup
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.release
}

// lookUpRelease asks GitHub once and stores the answer, then lets the requests waiting
// for it go on (done).
func lookUpRelease(app core.App, etag string, done chan struct{}) {
	checked := time.Now()
	var found answer
	var err error
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the release lookup failed: %v", r)
		}
		s := stateOf(app)
		s.mu.Lock()
		before, _ := s.release["version"].(string)
		s.releaseChecked, s.releaseAt, s.releaseError, s.releaseInFlight = true, checked, "", nil
		s.releaseNotBefore = found.notBefore
		switch {
		case err != nil:
			s.releaseError = err.Error()
		case found.release != nil:
			s.release, s.releaseETag, s.releaseFetchedAt = found.release, found.etag, checked
		default: // unchanged
			s.releaseFetchedAt = checked
		}
		s.mu.Unlock()
		close(done)
		if err != nil {
			warn(app, "Odyle release lookup failed", "error", err.Error())
		}
		// The first answer after a start is no news: clients fetched the release themselves.
		if err == nil && found.release != nil && before != "" {
			if version, _ := found.release["version"].(string); version != "" && version != before {
				tellEveryone(app, map[string]any{"release": map[string]any{"version": version, "publishedAt": found.release["publishedAt"], "url": found.release["url"]}})
			}
		}
	}()
	found, err = fetchLatest(etag)
}

// checkRelease is the odyle-release job: GitHub is asked now, unless its rate limit says
// to wait, and the job waits up to 20 seconds for the answer.
func checkRelease(app core.App) (result, error) {
	s := stateOf(app)
	s.mu.Lock()
	s.releaseChecked = false
	s.mu.Unlock()
	latestRelease(app)
	s.mu.Lock()
	lookup := s.releaseInFlight
	s.mu.Unlock()
	if lookup != nil {
		select {
		case <-lookup:
		case <-time.After(20 * time.Second):
			return result{}, fmt.Errorf("GitHub did not answer within 20 seconds")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.releaseError != "" {
		return result{}, errors.New(s.releaseError)
	}
	return result{Done: 1}, nil
}

// releaseLookup is the release cache as the Server status page shows it.
func releaseLookup(app core.App) *object {
	latestRelease(app)
	s := stateOf(app)
	s.mu.Lock()
	defer s.mu.Unlock()
	iso := func(at time.Time) string {
		if at.IsZero() {
			return ""
		}
		return at.UTC().Format(isoLayout)
	}
	version, _ := s.release["version"].(string)
	publishedAt, _ := s.release["publishedAt"].(string)
	return newObject().set("repository", repository()).set("checkedAt", iso(s.releaseAt)).set("fetchedAt", iso(s.releaseFetchedAt)).
		set("error", s.releaseError).set("version", version).set("publishedAt", publishedAt)
}

func windowsRelease(e *core.RequestEvent) error {
	var latest any
	if release := latestRelease(e.App); release != nil {
		latest = release
	}
	// blocked: the versions the operator holds back (odyle-windows#19); apps never install one and
	// move off one they run.
	blocked := readSettings(e.App).WindowsBlocked
	if blocked == nil {
		blocked = []string{}
	}
	return e.JSON(200, map[string]any{"repository": repository(), "releasesUrl": "https://github.com/" + repository() + "/releases/latest", "latest": latest, "blocked": blocked})
}

// updateAppsRoute is Apps & packets → Update all apps now: every signed-in client hears
// {"windowsUpdate": {version, at}} on its account's topic. A Windows app older than version
// downloads that release, installs it and restarts, handing its live character over; an app
// already on it does nothing, and dashboards ignore the news. version is the release the
// backend knows, never looked up here; without one it is left out and the apps ask GitHub
// themselves. Apps not connected now install new releases at their next start anyway. The
// answer counts the connections told, dashboards in browsers included.
func updateAppsRoute(e *core.RequestEvent) error {
	s := stateOf(e.App)
	s.mu.Lock()
	version, _ := s.release["version"].(string)
	s.mu.Unlock()
	update := map[string]any{"at": iso(time.Now())}
	if version != "" {
		update["version"] = version
	}
	told := tellEveryone(e.App, map[string]any{"windowsUpdate": update})
	info(e.App, "Windows apps were asked to update", "version", version, "connections", told)
	return e.JSON(200, map[string]any{"told": told, "version": version})
}
