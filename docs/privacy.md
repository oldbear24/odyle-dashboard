# Privacy and persistence

Discord authenticates the application account. PocketBase stores the provider identity mapping and account email/display name needed for sign-in, plus memberships and each character's region/server, name, Odyle total and observation timestamps. The room API exposes display names and opted-in character data, not account emails, authentication secrets or Discord tokens.

Characters belong to accounts. Leaving, closing a room or signing out does not erase stored values. Turning off sharing in a room immediately hides character data from other room members while keeping it in the owner's account. Last saved values may be stale or offline; they remain visible with their timestamp where sharing is enabled, but are excluded from fresh readiness.

The MVP accepts explicitly confirmed manual totals only. It does not interact with game processes, memory, packets or gameplay. Confirmed zero is a real value; unknown is displayed as a dash. A heartbeat updates presence without reconfirming energy. Session rotation and character switching invalidate current confidence without erasing last saved totals.

Browser tokens are tab-scoped. Windows credentials are protected by DPAPI for the current OS user. The five-minute one-use desktop code pairs the app to its owner's account; do not share it with another person. Room invitations are separate and never grant another account ownership of your characters.

Request/IP logs and analytics are disabled by default. Back up the PocketBase database to retain user data. Provider client secrets stay on the backend; never include them in browser environment variables or source control.
