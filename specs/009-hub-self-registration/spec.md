# 009 — Self-registration on the hub's shared sign-in

Amends spec 004 (self-registration off, hub-wide). Source: feedback F8, 2026-10-29.

## Problem / Why

The project hub has one shared identity provider for every app on it, and today only an admin can create an account. People who want to use an app that needs sign-in have no way to ask for one except out of band. They should be able to sign up themselves, but because one account covers every app on the hub and the sign-up page is reachable from the internet, a new account must not get in anywhere until a hub admin has approved it, and it must start with no special capabilities in any app.

## Users

- **Prospective users**: people who want an account on the hub.
- **Hub admins**: they approve or reject registrations and manage accounts.
- **App admins** (e.g. this app's admins): they grant an approved account access to their gated app, and app capabilities such as the editor role, as today.

## Functional requirements

- **FR-1** WHEN a visitor opens the hub's sign-in page THE SYSTEM SHALL offer a link to register.
- **FR-2** WHEN a visitor submits the registration form with a username, email address and password that meet the rules THE SYSTEM SHALL create the account in a pending state and tell the visitor it awaits approval.
- **FR-3** WHEN a registration is submitted with a username or email address already in use, or a password that doesn't meet the hub's password rules THE SYSTEM SHALL refuse it and say which field is wrong.
- **FR-4** WHEN someone signs in to a pending account THE SYSTEM SHALL refuse the sign-in to every app on the hub and say the account awaits approval.
- **FR-5** WHEN a hub admin views registrations THE SYSTEM SHALL list pending accounts with their username, email address and registration time.
- **FR-6** WHEN a hub admin approves a pending account THE SYSTEM SHALL let it sign in from then on to apps with ungated sign-in, and to no gated app until that app grants it access (FR-12).
- **FR-7** WHEN a hub admin rejects a pending account THE SYSTEM SHALL remove it, so its username and email address can be registered again.
- **FR-8** WHEN an account is created by self-registration THE SYSTEM SHALL give it no app role in any app; app capabilities (e.g. editor) are granted afterwards as they are today.
- **FR-9** WHEN an account is created THE SYSTEM SHALL NOT require email verification, and SHALL NOT send any email.
- **FR-10** WHEN a user forgets their password THE SYSTEM SHALL offer no self-service reset; the sign-in page SHALL say to contact a hub admin, who can set a new one.
- **FR-12** WHEN an approved account signs in to a gated app that has not granted it access THE SYSTEM SHALL refuse the sign-in to that app and say access must be granted by that app's admin; WHEN that app's admin grants access THE SYSTEM SHALL let the account sign in to that app, and to no other gated app.
- **FR-13** WHEN a pending account has been neither approved nor rejected for 30 days THE SYSTEM SHALL remove it, as if rejected.
- **FR-11** WHEN an app on the hub has ungated sign-in under spec 004, or needs no account (e.g. this app's invite links) THE SYSTEM SHALL keep working for people without an account exactly as before.

## Non-functional requirements

- **NFR-1 Abuse.** At most 5 registrations per source per hour are accepted, so the sign-up page cannot be used to flood the pending list or guess at existing usernames quickly.
- **NFR-2 Security.** Registration is served only over the hub's HTTPS entry point (spec 004); passwords are never stored or logged in readable form; a pending or rejected account can never obtain a session in any app.
- **NFR-3 Isolation.** Turning registration on changes nothing about how existing accounts sign in, and no app needs to change for it apart from those that choose to.
- **NFR-4 Persistence.** Pending, approved and rejected states survive a hub reboot, as accounts already do under spec 004.

## Out of scope

- Email verification, email notifications and any outgoing mail setup on the hub.
- Self-service password reset.
- Invite-only registration or invitation codes.
- Social or third-party sign-in (e.g. "Sign in with GitHub").
- CAPTCHA or other third-party bot protection.
- Automatic approval rules (e.g. by email domain).
- Notifying admins of new registrations outside the admin list in FR-5.

## Acceptance criteria

**FR-1** — Given a visitor on the hub's sign-in page, When it loads, Then a "Register" link is visible and leads to a registration form.

**FR-2** — Given the registration form, When "newuser", "new@example.com" and a valid password are submitted, Then a pending account "newuser" exists, And the visitor sees that it awaits approval.

**FR-3** — Given an account "taken" exists, When "taken" is submitted as a new username, Then registration is refused with a message on the username field; Given a password that breaks the rules, Then it is refused with a message on the password field.

**FR-4** — Given pending account "newuser", When it signs in to any app on the hub, Then sign-in is refused with an "awaiting approval" message, And no app session is created.

**FR-5** — Given two pending accounts, When a hub admin opens the registrations view, Then both are listed with username, email address and registration time.

**FR-6** — Given pending account "newuser", When a hub admin approves it, Then "newuser" can sign in to an ungated app, And sign-in to a gated app is still refused.

**FR-7** — Given pending account "newuser" with "new@example.com", When a hub admin rejects it, Then "newuser" cannot sign in, And a new registration with "newuser" and "new@example.com" is accepted.

**FR-8** — Given "newuser" was approved, When it signs in to this app, Then it has no editor or admin capability.

**FR-9** — Given a new registration, When it is submitted, Then no email is sent and no verification step is shown.

**FR-10** — Given the sign-in page, When it loads, Then there is no "forgot password" self-service flow, And a note says to contact a hub admin; Given a hub admin sets a new password for "newuser", Then "newuser" can sign in with it.

**FR-11** — Given registration is on, When someone without an account opens one of this app's session invite links, Then they join the session as before, without being asked to register or sign in.

**FR-12** — Given approved account "newuser" and gated apps A and B, When A's admin grants it access, Then "newuser" can sign in to A, And sign-in to B is refused with a message to ask B's admin.

**FR-13** — Given account "newuser" registered 30 days ago and still pending, When the 30 days pass, Then "newuser" no longer exists, And "newuser" can be registered again.

**NFR-1** — Given one source has made 5 registrations within the last hour, When it submits again, Then the attempt is refused until the limit resets, And registrations from other sources still succeed.

**NFR-2** — Given a pending account, When any app's sign-in is attempted with correct credentials, Then no session is issued; Given the registration page, When requested over plain HTTP, Then it is not served.

**NFR-4** — Given one pending and one approved account, When the hub reboots, Then the first is still pending and the second can still sign in.

## Open questions

None. Resolved 2026-10-30: approval unlocks the account only, and each gated app grants access separately (FR-6, FR-12); unanswered pending accounts are removed after 30 days (FR-13); the limit is 5 registrations per source per hour (NFR-1).
