//go:build odyletest

package odyle

import "testing"

// The test build, which signs anybody in as a superuser, listens on loopback addresses only, and
// names itself in the version the Server status page and the dashboard read.
func TestTheTestBuildListensOnLoopbackOnly(t *testing.T) {
	if Version != "test" {
		t.Fatalf("the test build is version %q", Version)
	}
	for _, addr := range []string{"127.0.0.1:18090", "localhost:8090", "[::1]:8090", "127.1.2.3:80"} {
		if err := loopbackOnly(addr); err != nil {
			t.Errorf("%s refused: %v", addr, err)
		}
	}
	for _, addr := range []string{"0.0.0.0:8090", ":8090", "[::]:8090", "192.168.1.20:8090", "10.0.0.5:80", "example.com:80", "8090", ""} {
		if err := loopbackOnly(addr); err == nil {
			t.Errorf("%q accepted", addr)
		}
	}
}
