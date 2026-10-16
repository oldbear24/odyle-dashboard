# Changelog

What changed in each release of the Odyle dashboard and server, newest first, written for players. Every pull request that changes the version adds its section here (AGENTS.md, Versioning). The release notes and the dashboard's **What's new** page (`#/changelog`) show it.

## 0.10.0 · 2026-10-16

### New
- **What's new**: this list of changes, opened from the version in the footer. After an update the dashboard says so once.
- What's new also shows what the newest Windows app release changed.

## 0.9.0 · 2026-10-16

### New
- **Account & data → Membership**: say whether your game account has the membership. The Odyle clock then knows the natural pool's cap (840 with it, 560 without) instead of guessing from your readings. Rooms see only the cap on the characters you share, never the answer.
- A character whose natural pool held more than your answer allows says so on its card.

### Fixed
- The cap alert choice and its notes no longer run past the Notifications card.

## 0.8.0 · 2026-10-16

### New
- **Armory bookmarks**: bookmark a character on its armory profile and the armory page lists it, with its combat power and item level. No account needed; bookmarks stay in your browser.

## 0.7.0 · 2026-10-16

### New
- **Armory**: look up any AION 2 Global character's gear, combat power, item level and stats, without signing in. Profiles come from PLAYNC's official pages, are kept for everyone and refresh at most every six hours; a new one waits in a slow queue, and the page says how long.
- Every character card links its armory profile.

### Fixed
- Card buttons wrap onto a second row instead of being cut off.

## 0.6.0 · 2026-10-16

### New
- The room explains its numbers: who holds the party back, who isn't counted and why, and the last known party while someone is missing.
- **Live only** hides the characters that aren't live.
- New characters can join chosen rooms by themselves (Room settings → New characters).
- Planned runs count their own party: each attendee brings a chosen character, and the plan form suggests the earliest time everyone can claim a cube.
- Started runs can be wrapped up: **Done** clears the wishlist, **Didn't happen**, or **Plan again next week**.

### Changed
- Releases carry semantic versions (0.6.0 and on). Earlier releases were numbered 0.5.0 plus a run number; their notes are on GitHub.
