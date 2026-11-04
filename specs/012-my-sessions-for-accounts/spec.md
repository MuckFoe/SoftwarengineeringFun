# 012 — Profile with recent sessions, and no name prompt, for signed-in users

Source: the human, 2026-10-30; profile section merged in 2026-11-03. Builds on the hub's shared sign-in and its accounts (004, 009). Amends how participants join or start a session in 001 and 006, and where the appearance (003) and chat-visibility (008) preferences are kept. Lists presentation sessions from 013.

## Problem / Why

Today every participant types a name to start or join a session, and a session can only be found again through its link. Someone with a hub account is already known by name, so asking again is friction. If they lose the link, the session is gone for them, and their settings stay behind in whichever browser they set them in. Signed-in users should have a profile: who they are in this app, every session they've been part of with the most recent first, ready to reopen, and their preferences on any device. They should start or join without typing a name. Participants without an account keep working exactly as today. The profile is reachable by everyone, but without an account it only offers signing in or registering.

## Users

- **Signed-in users**: people with an approved hub account who are signed in while using the app.
- **Anonymous participants**: people without an account, or not signed in, who join through an invite link and type a name, as today.

## Functional requirements

### Joining without a name prompt

- **FR-1** WHEN a signed-in user starts or joins a coding, learning or presentation session THE SYSTEM SHALL use their account username as their participant name and not ask for a name.
- **FR-3** WHEN a signed-in user opens a session from their profile THE SYSTEM SHALL bring them back into it as the same participant they were before, without a name prompt.
- **FR-5** WHEN a signed-in user opens a session's invite link they are already a participant of, on any device or browser THE SYSTEM SHALL bring them in as that same participant, not as a new one.
- **FR-6** WHEN someone who is not signed in starts or joins a session THE SYSTEM SHALL ask for a name, as today. Joining by invite link never requires an account.
- **FR-7** WHEN a session has a participant limit (001, 006, 013) THE SYSTEM SHALL count a returning signed-in user once, however many devices or times they rejoin.
- **FR-8** WHEN a signed-in participant's name is shown in a session (participant list, chat, anything attributed to them) THE SYSTEM SHALL show a visible *signed in* mark beside it. Anonymous participants never carry it, and may still type any name, including one equal to a signed-in participant's username.

### Profile

- **FR-9** THE SYSTEM SHALL offer a way to open the profile from every screen of the app, whether or not the visitor is signed in.
- **FR-10** WHEN someone who is not signed in opens the profile THE SYSTEM SHALL show only the options to sign in or to register, and nothing about sessions or preferences.
- **FR-11** WHEN a signed-in user opens their profile THE SYSTEM SHALL show their account username and their roles in this app (editor, admin, or none), read-only, and a way to sign out.

### Recent sessions

- **FR-2** WHEN a signed-in user opens their profile THE SYSTEM SHALL list every coding, learning and presentation session they started or joined while signed in, most recently active first, each with its kind, its title (problem, lesson or presentation), when it was last active and whether it is stale.
- **FR-12** WHEN a listed presentation session currently has the user as its host THE SYSTEM SHALL mark it as hosted by them.
- **FR-4** WHEN a signed-in user opens a session from their profile that is stale THE SYSTEM SHALL open it read-only, as a stale session opens today.
- **FR-13** WHEN a signed-in user hides a session from their list THE SYSTEM SHALL remove it from their own list only; the session, their participation in it and everyone else's lists are unchanged.
- **FR-14** WHEN a signed-in user opens a session they had hidden, by its invite link THE SYSTEM SHALL bring them in as the same participant and show it in their list again.

### Preferences

- **FR-15** WHEN a signed-in user changes a preference the app remembers (appearance from 003, chat shown or hidden from 008) THE SYSTEM SHALL keep it with their account and apply it on every device and browser where they are signed in.
- **FR-16** WHEN a signed-in user has no preferences kept with their account yet and signs in THE SYSTEM SHALL keep that browser's current preferences as their account's.
- **FR-17** WHILE nobody is signed in THE SYSTEM SHALL keep and apply preferences per browser, as today. Signing out leaves the browser on the preferences it had last.
- **FR-18** WHEN a signed-in user opens their profile THE SYSTEM SHALL show their preferences and let them change them there, with the same effect as changing them where they are used.

## Non-functional requirements

- **NFR-1 (privacy)** A user's profile, session list and preferences are visible only to them. Nobody can see another user's list, or learn which sessions another account took part in or hid.
- **NFR-2 (identity)** The name of a signed-in participant, the *signed in* mark and the roles shown in the profile come from their account only. None can be set or faked from the browser.
- **NFR-3 (durability)** A user's list, hidden sessions and preferences survive hub restarts. The list keeps a session for as long as the session itself exists.
- **NFR-4 (performance)** The profile with its session list opens within 1 s on the hub for a user with 200 sessions.
- **NFR-5 (accessibility)** The profile follows 003: macOS look, light and dark appearance, keyboard-reachable, WCAG AA.

## Out of scope

- Any profile, session list or remembered name for anonymous participants. Without an account the profile offers only sign in and register.
- Adding sessions someone joined anonymously, before signing in or without an account, to their account later.
- Choosing a display name other than the account username; avatars, bios, or anything shown to other users.
- Changing username, password or email from the profile (009 has no self-service account changes).
- Deleting, renaming or archiving sessions; hiding is per user and only from their own list.
- Preferences beyond those the app already remembers (appearance, chat visibility).
- Accounts, registration and approval themselves (009). The register option leads to the hub's sign-up.
- Changing who may start a session or what an invite link allows.

## Acceptance criteria

- **FR-1** — Given signed-in user `newuser`, When they start a coding session, Then no name prompt is shown, And they appear as `newuser` in the participant list and chat. Given the same user opens a learning or presentation session's invite link, When it loads, Then they join as `newuser` without a prompt.
- **FR-2** — Given `newuser` started coding session S1 yesterday, joined learning session L1 an hour ago and joined presentation session P1 now, all while signed in, And another user's session S2 they never joined exists, When `newuser` opens their profile, Then P1, L1, S1 are listed in that order with kind, title, last activity and stale status, And S2 is not.
- **FR-3** — Given `newuser` sent a chat message in S1 and closed the tab, When they open S1 from their profile, Then they are in S1 without a prompt, And their earlier message is shown as their own.
- **FR-4** — Given S1 has become stale, When `newuser` opens their profile, Then S1 is listed as stale, And opening it shows it read-only.
- **FR-5** — Given `newuser` is a participant of S1 on their laptop, When they open S1's invite link on their phone while signed in, Then the participant list still has one `newuser`.
- **FR-6** — Given a visitor who isn't signed in, When they open S1's invite link, Then they are asked for a name and join with it, without being asked to sign in.
- **FR-7** — Given learning session L1 with 4 participants including `newuser`, and a limit of 5, When `newuser` rejoins from a second device, Then L1 still counts 4 participants, And a fifth person can still join.
- **FR-8** — Given signed-in `newuser` is in S1, When a visitor who isn't signed in joins S1 as `newuser`, Then both are in the participant list, And only the signed-in one has the *signed in* mark, in the list and on each of their chat messages.
- **FR-9** — Given any screen of the app (library, coding session, learning session, presentation session), signed in or not, Then the profile can be opened from it.
- **FR-10** — Given a visitor who isn't signed in, When they open the profile, Then they see sign in and register options and no sessions or preferences. When they choose register, Then they reach the hub's sign-up.
- **FR-11** — Given signed-in `newuser` with the editor role in this app, When they open their profile, Then it shows `newuser` and *editor*, neither can be edited, And signing out from it leaves them signed out.
- **FR-12** — Given `newuser` is host of presentation session P1 and a regular participant of P2, When they open their profile, Then P1 is marked as hosted by them and P2 is not. When hosting of P1 passes to someone else, Then P1 is no longer marked.
- **FR-13** — Given `newuser` and `other` both in S1, When `newuser` hides S1, Then S1 is gone from `newuser`'s list, still in `other`'s list, And S1 and `newuser`'s chat messages in it are unchanged.
- **FR-14** — Given `newuser` hid S1, When they open S1's invite link, Then they are in S1 as the same participant without a prompt, And S1 is back in their list.
- **FR-15** — Given signed-in `newuser` on their laptop sets dark appearance and hides chat, When they sign in on another browser, Then it is dark and chat is hidden there.
- **FR-16** — Given a browser set to dark appearance and `newuser` signing in for the first time, Then their account keeps dark appearance, And another browser they sign into afterwards is dark too.
- **FR-17** — Given nobody is signed in, When a visitor sets light appearance, Then it is kept in that browser as today. Given `newuser` with dark appearance signs out, Then that browser stays dark.
- **FR-18** — Given `newuser` changes appearance to light in their profile, Then the app turns light at once, And opening a session shows light.
- **NFR-1** — Given `newuser` and `other` each have sessions, hidden sessions and preferences, When `other` asks for any of `newuser`'s in any way, Then they get only their own or are refused.
- **NFR-2** — Given signed-in `newuser` without any role, When the browser sends a different participant name while joining, or claims the admin role, Then they still appear as `newuser`, And their profile shows no role.
- **NFR-3** — Given `newuser`'s list shows S1 and L1, S2 is hidden, and their appearance is dark, When the hub restarts, Then the list still shows S1 and L1 without S2, And appearance is still dark.
- **NFR-4** — Given `newuser` with 200 sessions, When they open their profile on the hub, Then it shows within 1 s.
- **NFR-5** — Given the profile in light and in dark appearance, Then every control is reachable by keyboard, And it passes a WCAG AA check.

## Open questions

None. Decided 2026-10-30: duplicate names are allowed, and signed-in participants carry a visible mark (FR-8). Decided 2026-11-03: the profile section is merged into this spec; it is reachable by everyone but offers anonymous visitors only sign in / register (FR-10); anonymous sessions are never added to an account; no remembered name for anonymous users; users can hide sessions from their own list (FR-13, FR-14); the profile shows account info, presentation sessions they host, and account-kept preferences.
