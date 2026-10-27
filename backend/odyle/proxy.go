package odyle

import (
	"net/netip"
	"os"
	"regexp"
	"slices"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Rate limits count requests per client address, the one PocketBase's RealIP answers.
// Behind a reverse proxy every request comes from the proxy, so every player would share
// one budget (600 Odyle requests and 10 sign-ins a minute) unless PocketBase trusts the
// header in which the proxy names the client. ODYLE_TRUSTED_PROXY_HEADERS (one header,
// for example X-Real-IP) sets Settings → Application → Trusted proxy at every start, and ODYLE_TRUSTED_PROXY_IP picks the rightmost (default) or leftmost
// address of a list. Trust only a header your own proxy replaces: one a client can send
// itself lets it choose its address. PocketBase takes the first trusted header a request
// carries, so a second one the proxy only passes through would let every client choose
// it too: a list of headers is refused. Set but empty, it clears the trusted headers;
// unset, the setting stays as superusers saved it. The Server status page warns when
// most requests come from private or loopback addresses (tally).

var headerName = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// configureProxy applies the ODYLE_TRUSTED_PROXY_* variables, saving the settings only
// when they change, and answers what kept it from doing so (empty when nothing did).
func configureProxy(app core.App) string {
	raw, set := os.LookupEnv("ODYLE_TRUSTED_PROXY_HEADERS")
	if !set {
		return ""
	}
	headers := []string{}
	for _, part := range strings.Split(raw, ",") {
		name := strings.TrimSpace(part)
		if name == "" {
			continue
		}
		if !headerName.MatchString(name) {
			return "ODYLE_TRUSTED_PROXY_HEADERS lists \"" + cut(name, 64) + "\", which is not a header name; the trusted proxy settings stay as they were."
		}
		if !slices.ContainsFunc(headers, func(h string) bool { return strings.EqualFold(h, name) }) {
			headers = append(headers, name)
		}
	}
	if len(headers) > 1 {
		return "ODYLE_TRUSTED_PROXY_HEADERS names more than one header; name only the one your proxy replaces. The trusted proxy settings stay as they were."
	}
	leftmost := false
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ODYLE_TRUSTED_PROXY_IP"))) {
	case "", "rightmost":
	case "leftmost":
		leftmost = len(headers) > 0
	default:
		return "ODYLE_TRUSTED_PROXY_IP must be rightmost or leftmost; the trusted proxy settings stay as they were."
	}
	current := app.Settings().TrustedProxy
	if slices.Equal(current.Headers, headers) && current.UseLeftmostIP == leftmost {
		return ""
	}
	settings, err := app.Settings().Clone()
	if err == nil {
		settings.TrustedProxy = core.TrustedProxyConfig{Headers: headers, UseLeftmostIP: leftmost}
		err = app.Save(settings)
	}
	if err != nil {
		return "The ODYLE_TRUSTED_PROXY_* settings could not be saved (" + err.Error() + ")."
	}
	info(app, "Odyle trusts the proxy headers", "headers", strings.Join(headers, ","), "leftmost", leftmost)
	return ""
}

// The shared address space of carrier-grade NAT, which never reaches a server from the
// internet either.
var sharedSpace = netip.MustParsePrefix("100.64.0.0/10")

// privateAddress reports whether a client address is loopback, private, link-local or
// shared: the address of a proxy or of a container network rather than of a player.
func privateAddress(raw string) bool {
	ip, err := netip.ParseAddr(raw)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || sharedSpace.Contains(ip)
}

// proxyStatus is the Server status page's view of the trusted proxy settings.
func proxyStatus(app core.App) *object {
	s := stateOf(app)
	s.mu.Lock()
	setup := s.proxySetup
	s.mu.Unlock()
	config := app.Settings().TrustedProxy
	return newObject().set("headers", append([]string{}, config.Headers...)).set("leftmost", config.UseLeftmostIP).set("setup", setup)
}
