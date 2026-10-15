//go:build !odyletest

package odyle

// Packet adapters whose readings the backend stores. The Windows companion sends
// its adapter name as parserVersion with every report; names not listed here are
// rejected so an outdated or unknown client cannot write totals. Superusers can
// accept more names, or stop one of these, under Server controls (settings.go).
//
// global-reference-v1: Global (Steam) stream decoder — length-prefixed frames,
// transport flag, LZ4 blocks, 0B61 stat snapshot and 0C61 stat update for
// field 1. Checked live on EU/Lumiel (startup read 0 + 390 = 390).
var verifiedAdapters = []string{"global-reference-v1"}
