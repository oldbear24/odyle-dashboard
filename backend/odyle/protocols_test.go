//go:build !odyletest

package odyle

import (
	"slices"
	"testing"
)

func TestProductionApprovesOnlyTheReferenceGlobalAdapter(t *testing.T) {
	if !slices.Equal(verifiedAdapters, []string{"global-reference-v1"}) {
		t.Fatalf("verifiedAdapters = %v", verifiedAdapters)
	}
	b := readingInput(map[string]any{"parserVersion": "global-reference-v1"})
	if r, err := validReading(b, "session", 5, verifiedAdapters); err != nil || r.parserVersion != "global-reference-v1" {
		t.Fatalf("reference adapter refused: %v", err)
	}
	for _, adapter := range []string{"test-fixture-v1", "reference-odyle-v1-unverified"} {
		_, err := validReading(readingInput(map[string]any{"parserVersion": adapter}), "session", 5, verifiedAdapters)
		if err == nil || err.Error() != "This packet adapter has not been validated for Global. No reading was saved." {
			t.Errorf("%s: %v", adapter, err)
		}
	}
}
