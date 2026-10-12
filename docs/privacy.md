# Privacy and reading correctness

The MVP accepts only explicitly confirmed manual Odyle totals. It does not interact with AION 2 processes, memory or game traffic. No game login credentials are needed.

Stored room data: display/character names, selected Global region/server, Odyle total, consent/confidence flags, source, monotonic sequence and server timestamps. Random synthetic authentication identities and secret token material support room access. Invite codes are stored only as SHA-256 digests. Raw packets, player account details and analytics are not collected.

Browser tokens use tab-scoped session storage. The Windows app protects its persisted credential using Windows DPAPI for the current OS user. HTTPS is mandatory for hosted Windows connections; HTTP is allowed for loopback development only.

Fresh means both the reading and presence are less than 45 seconds old. At 45 seconds the value becomes stale; at 90 seconds without presence, or with sharing disabled, the member is offline. A heartbeat never changes `lastReadingAt` or confirmation. Stale values may remain visible as reference but never count toward energy totals, readiness or current cube counts.

The Windows app locks character details after a confirmed report. Switch character clears server confidence before selecting a new identity. A publisher session reset invalidates the previous reading and older sequence/session messages. The browser also clears confidence after realtime reconnect or a long synchronization gap.

If automatic capture is added later, it must be opt-in, fixture-tested against current Global game values (including zero), restricted to the local consenting player, and disabled for unknown builds. Passive observation alone does not establish game publisher authorization; no automatic reader or account-safety claim is included in this MVP.
