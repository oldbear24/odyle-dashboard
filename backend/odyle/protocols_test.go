//go:build !odyletest

package odyle

import (
	"slices"
	"testing"
)

func TestProductionApprovesOnlyTheReferenceGlobalAdapters(t *testing.T) {
	if !slices.Equal(verifiedAdapters, []string{"global-reference-v2"}) {
		t.Fatalf("verifiedAdapters = %v", verifiedAdapters)
	}
	for _, adapter := range verifiedAdapters {
		b := readingInput(map[string]any{"parserVersion": adapter})
		if r, err := validReading(b, "session", 5, verifiedAdapters); err != nil || r.parserVersion != adapter {
			t.Fatalf("reference adapter %s refused: %v", adapter, err)
		}
	}
	// v1, which apps before 2026-10-16 sent, is refused since 1.0.0.
	for _, adapter := range []string{"test-fixture-v1", "reference-odyle-v1-unverified", "global-reference-v1", "global-reference-v3"} {
		_, err := validReading(readingInput(map[string]any{"parserVersion": adapter}), "session", 5, verifiedAdapters)
		if err == nil || err.Error() != "This packet adapter has not been validated for Global. No reading was saved." {
			t.Errorf("%s: %v", adapter, err)
		}
	}
	// Superusers can switch v2 off only with another adapter accepted; a v1 left switched off
	// from before 1.0.0 changes nothing.
	if got := accepted(adapterLists{Extra: []string{}, Disabled: []string{"global-reference-v1"}}); !slices.Equal(got, []string{"global-reference-v2"}) {
		t.Fatalf("with v1 switched off: %v", got)
	}
	if _, err := adapterSettings(map[string]any{"extra": []any{}, "disabled": []any{"global-reference-v2"}}); err == nil {
		t.Fatal("the only reading adapter was switched off")
	}
}
