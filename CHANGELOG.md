# Changelog

What changed in each release of the Odyle dashboard and server, newest first, written for players. Every pull request that changes the version adds its section here (AGENTS.md, Versioning). The release notes and the dashboard's **What's new** page (`#/changelog`) show it.

## 0.29.1 · 2026-10-17

### Fixed
- Names, notes, dungeon and task titles no longer keep invisible characters or text-direction controls, which could make one name look like another or reverse how a note reads.

## 0.29.0 · 2026-10-17

### New
- **Party ready**: from an hour before a run you are going to, once everyone going plays live with enough Odyle for a cube, each of you is told once, in the browser, by push and in Odyle for Windows once it updates. Turn it off under **Account & data → Notifications**; quiet hours apply.

## 0.28.0 · 2026-10-17

### New
- A planned run that falls into the game's **weekly maintenance** says so, with the maintenance times in your local time. The server's operators set the window under Game settings.

## 0.27.0 · 2026-10-17

### New
- **Room settings → Discord reminders** shows the language of the room's posts and lets its owner change it (English or Czech); posts still showing a run follow at once. Before, it was quietly the language the dashboard had when the channel was connected.

## 0.26.0 · 2026-10-17

### New
- The server's operators can **hold back a Windows app version** that misbehaves: Odyle for Windows 0.18.0 and later never installs it, and moves back to the latest good release if it already runs it.

## 0.25.0 · 2026-10-17

### New
- **Account & data → Notifications** has a switch for **daily and weekly tasks**: two hours before a reset, Odyle for Windows (0.17.0 and later) lists in its tray the tasks you have not ticked yet. It is on until you turn it off.

## 0.24.0 · 2026-10-17

### New
- **Officers**: under **Room settings** the room's owner can make a member an officer. Officers play like players, and also make invite links, change or cancel any run, clear a dungeon off everyone's wishlist and keep the Discord reminders. Renaming and closing the room, roles and handing it over stay with the owner. When an owner's account is deleted, an officer takes the room before the other players.

## 0.23.0 · 2026-10-17

### New
- **Discord reminders** can show how many of those going can claim a cube: "3/5 by the start", and "5/5 · party ready" once the run starts. The room's owner turns it on under **Room settings → Discord reminders**; the post shows counts only, never names or Odyle values, and follows changes up to the start.

## 0.22.0 · 2026-10-17

### New
- **Account & data** shows what you use against the limits (rooms you lead, rooms, PCs, characters) and since when you are a member, and, when the server deletes unused accounts, the date yours would go if you stayed away.
- Each paired PC says which Odyle for Windows it runs, and **update available** when a newer one is out.
- When the server's operator pauses reminders, Account & data and Room settings say so.

## 0.21.0 · 2026-10-17

### New
- **NA-East and NA-West are told apart.** Both have servers of the same names (Siel, Lumiel…), so two characters of the same name, one in each, used to become one. Cards and the armory say NA-E or NA-W. Characters already saved move to NA-West once the daily lookup finds them there (with Odyle for Windows 0.16 or newer for new readings).

## 0.20.0 · 2026-10-17

### Changed
- A character no Windows reader has read or seen for 12 months is deleted with its history by a nightly job. Playing it again with the reader saves it anew.
- **Privacy** names who runs Odyle and how to reach them, and says what your e-mail is used for: only the alert when your account signs in from a new device.
- The armory calls item level **GP**, as players do.

### Fixed
- The armory's combat power and GP panel is laid out again (it lost its layout in 0.17.0).

## 0.19.0 · 2026-10-17

### New
- **Open in Odyle** in the Pair Windows app dialog: one click hands the connection link to Odyle for Windows (0.15 or newer), also while it is running. Odyle names the server and asks before pairing; copying the link still works.

## 0.18.1 · 2026-10-17

### Changed
- **Rooms & characters** is the heading of its page, like the item that opens it.
- Once you have a room, creating or joining another sits folded under your rooms; **Create or join a room** in the room menu opens it.

### Fixed
- Short pages such as Daily & weekly and the armory start at the top instead of halfway down.

## 0.18.0 · 2026-10-17

### New
- A character the Windows app read before its Odyle unlocks says **No Odyle yet · it unlocks at level 22** instead of waiting for a value (with a Windows app that sends it).
- The wishlist says how long each dungeon has been on it.
- **Show all** in a character's history lists every change, not just the newest 12.

### Changed
- When the room's next run is of a dungeon the catalog lists, the room's numbers and rows count at that dungeon's cost, and the heading says so.
- "Party can open N cubes" counts the best players up to the dungeon's party size when more are live.
- On phones the history chart no longer stops the page from scrolling.

### Fixed
- **Sign out everywhere** no longer signs out the browser you clicked it in as well, now and then.

## 0.17.0 · 2026-10-17

### New
- **Room switch**: the sidebar (on phones the bar at the top) names the room you are in and opens any of your rooms in one click, or the way to create or join one.
- **Account menu** behind your name: Account & data, pairing the Windows app, invitations, Reader & privacy, What's new and signing out, in a small menu instead of a dialog.

### Changed
- **A new room page**: the room's name is its heading, and one panel shows the party's cubes, who is ready, who is live and the lowest player, with who is not counted under it.
- **Characters are rows**: name, class and level, status, Odyle with its natural and item parts, regeneration, cubes and actions on one line on wide screens, nothing cut off. Medium screens use two lines, phones a compact block.
- Shorter navigation: Party, Rooms & characters, Tasks and Armory, each on one line; the reader's state sits at the bottom of the sidebar.
- Less on every page: no small-caps lines over the headings and no panels repeating the help under the party; planned runs and the wishlist sit side by side on wide screens.
- The account page puts its short cards in one column beside Notifications.
- **Room settings** is one section per subject: name, members (you first), Discord reminders, your new characters and, last, closing the room.
- Planned runs and the wishlist use readable small print, and in a narrow column the people going take their own line instead of being cut off.

## 0.16.0 · 2026-10-17

### New
- **Privacy** is a page of the dashboard: what Odyle keeps, where it goes and how long it stays, with links to report a problem or ask. The welcome page, the help and the footer link it.

### Changed
- The fonts come with the dashboard, so opening it no longer contacts Google Fonts; no page loads anything from another site.

## 0.15.0 · 2026-10-17

### New
- **A checklist per character**: Daily & weekly keeps a list for your account and one for each of your characters, so alts track their own dailies and weeklies. Each list holds up to 40 tasks.
- **Add from the Global list**: the server's operators keep a list of the game's daily and weekly tasks, and you add the ones you want to a list in one go.
- The navigation shows how many tasks are left, and each list says how many it has left.

## 0.14.0 · 2026-10-17

### New
- **Copy for Discord** on each planned run: a message with the dungeon, a time Discord shows in everyone's own time zone, who is going and a link back to the room, ready to paste in any channel. No webhook needed.

## 0.13.0 · 2026-10-17

### New
- **Discord reminders link back to the room** and stay correct: a post is updated when the run changes and marked when it is cancelled or done.
- Room owners choose up to three reminder times (5 minutes to 2 hours) and can have a run posted as it starts too.
- **Discord mentions**: turn them on under Account & data → Notifications and the reminder of a run you are going to pings you in Discord, even with the PC off.
- Room settings show the webhook's name and whether the last post got through, and why reminders stopped if Discord dropped the webhook.

### Fixed
- A run is never posted twice when the server fails to note a reminder.

## 0.12.0 · 2026-10-16

### New
- Character cards show the class and level PLAYNC lists for the character, such as **Chanter · Lv 45**, and run attendees show their class. They come from the daily portrait lookup, so a level can be a day old.
- A card's **Armory** link opens the character's own profile once PLAYNC has listed it, instead of a search by name.

## 0.11.0 · 2026-10-16

### New
- **Phones** get a bar at the bottom with Overview, Rooms, Daily, Armory and Account; Invitations and Reader & privacy are in the avatar menu.
- The pages in the sidebar are links, so they open in a new tab too.

### Changed
- Small print is at least 11 px on narrow screens, the sidebar with icons only names its items, and the breadcrumb leads home.

### Fixed
- Signed out, the dashboard no longer says "Not connected" while the server answers.
- Screen readers get a skip link, dialogs named by their heading, and who is live in the wishlist and runs as text.

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
