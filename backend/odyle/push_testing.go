//go:build odyletest

package odyle

import "net/url"

// Test builds also post to a push service on the test machine (tests/integration.test.mjs runs one).
func init() {
	allowed := pushEndpointAllowed
	pushEndpointAllowed = func(endpoint *url.URL) bool {
		return allowed(endpoint) || endpoint.Scheme == "http" && endpoint.Hostname() == "127.0.0.1"
	}
}
