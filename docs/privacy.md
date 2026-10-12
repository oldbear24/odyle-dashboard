# Privacy and persistence

Discord authenticates the application account. PocketBase stores the provider identity mapping and account email/display name needed for sign-in, plus memberships and each character's region/server, name, Odyle total and observation timestamps. The room API exposes display names and opted-in character data, not account emails, authentication secrets or Discord tokens.

Characters belong to accounts. Leaving, closing a room or signing out does not erase stored values. Turning off sharing in a room immediately hides character data from other room members while keeping it in the owner's account. Last saved values may be stale or offline; they remain visible with their timestamp where sharing is enabled, but are excluded from fresh readiness.

The app may detect the own character's name, server and region from game packets and save those normalized identity fields to the paired account. Manual identity setup uses the same limited endpoint. This creates an unknown reading, not a confirmed zero; it cannot set Odyle, ownership, observation timestamps or reading confidence. Repeating a saved identity preserves its existing history.

Manual totals are rejected. The Windows reader follows the local AION2 process TCP connections using the OS connection table and reads packets through Npcap. It does not read game memory or modify packets/gameplay. Raw traffic remains in local bounded memory and is neither written to disk nor sent to PocketBase. The reference decoder produces unverified candidates only; production has no approved Global adapter and accepts no new reading yet. Historical manual values remain stored but invalid for current readiness. Confirmed zero is a real value; unknown is displayed as a dash. A heartbeat updates presence without reconfirming energy. Session rotation and character switching invalidate current confidence without erasing last saved totals.

Browser tokens are tab-scoped. Windows credentials are protected by DPAPI for the current OS user. The five-minute one-use desktop code pairs the app to its owner's account; do not share it with another person. Room invitations are separate and never grant another account ownership of your characters.

Request/IP logs and analytics are disabled by default. Back up the PocketBase database to retain user data. Provider client secrets stay on the backend; never include them in browser environment variables or source control.
