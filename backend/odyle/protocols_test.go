//go:build !odyletest

package odyle

import (
	"slices"
	"testing"
)

func TestProductionApprovesOnlyTheReferenceGlobalAdapters(t *testing.T) {
	if !slices.Equal(verifiedAdapters, []string{"global-reference-v1", "global-reference-v2"}) {
		t.Fatalf("verifiedAdapters = %v", verifiedAdapters)
	}
	for _, adapter := range verifiedAdapters {
		b := readingInput(map[string]any{"parserVersion": adapter})
		if r, err := validReading(b, "session", 5, verifiedAdapters); err != nil || r.parserVersion != adapter {
			t.Fatalf("reference adapter %s refused: %v", adapter, err)
		}
	}
	for _, adapter := range []string{"test-fixture-v1", "reference-odyle-v1-unverified", "global-reference-v3"} {
		_, err := validReading(readingInput(map[string]any{"parserVersion": adapter}), "session", 5, verifiedAdapters)
		if err == nil || err.Error() != "This packet adapter has not been validated for Global. No reading was saved." {
			t.Errorf("%s: %v", adapter, err)
		}
	}
	// Superusers retire v1 under Server controls once apps send v2; v2 alone stays accepted.
	retired := accepted(adapterLists{Extra: []string{}, Disabled: []string{"global-reference-v1"}})
	if !slices.Equal(retired, []string{"global-reference-v2"}) {
		t.Fatalf("with v1 switched off: %v", retired)
	}
	if _, err := validReading(readingInput(map[string]any{"parserVersion": "global-reference-v1"}), "session", 5, retired); err == nil {
		t.Fatal("a switched off adapter was accepted")
	}
}
