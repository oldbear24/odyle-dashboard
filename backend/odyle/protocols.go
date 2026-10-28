//go:build !odyletest

package odyle

// Packet adapters whose readings the backend stores. The Windows companion sends
// its adapter name as parserVersion with every report; names not listed here are
// rejected so an outdated or unknown client cannot write totals. Superusers can
// accept more names, or stop one of these, under Server controls (settings.go).
//
// A Windows release ships to every installed app at once, so a new adapter is listed
// here (or accepted under Server controls) and deployed before the release that sends
// it. Once apps have moved on, superusers switch the older one off under Server
// controls, and a later backend release drops it from this list.
//
// global-reference-v1: Global (Steam) stream decoder — length-prefixed frames,
// transport flag, LZ4 blocks, 0B61 stat snapshot and 0C61 stat update for
// field 1. Checked live on EU/Lumiel (startup read 0 + 390 = 390).
//
// global-reference-v2: the same stream, with every 0B61/0C61 stat record read by one
// parser pinned to Odyle's resource id 60000001, so records without a bonus or base
// part are read and other counters are never taken for Odyle.
var verifiedAdapters = []string{"global-reference-v1", "global-reference-v2"}

// The location adapters (location.go), listed and switched off the same way.
//
// global-location-v1: map loads (21 36), arrivals (23 36) and the own character's effect events
// (2A 38) of the Global stream, read only for the own character.
var verifiedLocationAdapters = []string{"global-location-v1"}

// The group adapters (groups.go), listed and switched off the same way.
//
// global-group-v1: the own party's roster (00 92) and its end (1F 92), the own force's roster
// (02 96), a member leaving it (22 96) and its end (2E 96) on the Global stream; only the ids of
// the own party and force are read, never the other members.
var verifiedGroupAdapters = []string{"global-group-v1"}
