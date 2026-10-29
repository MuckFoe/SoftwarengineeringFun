# 005 — Deploy to the project hub

## Problem / Why

The collaborative coding app runs only on a developer's machine, so nobody can
open an invite link from their own device. It is to be hosted on the shared
**project hub** (spec `004-project-hub-shared-ingress`): reached through the
hub's one entry point, signing editors and administrators in through the hub's
one identity provider instead of running its own. Every behaviour already
specified for the app must work there exactly as it does locally.

The hub's entry-point design comes from the BoarHQ repository and was not
written with this app in mind; where the two clashed, the resolution is
recorded under Decisions.

## Users

- **Session participant** — joins a session through an invite link, with no
  account.
- **Editor** — signs in to manage problems.
- **Administrator** — signs in to reactivate stale sessions.
- **Operator** — deploys and updates the app on the hub.

## Functional requirements

- **FR1** — THE SYSTEM SHALL be reachable through the hub's entry point under a
  path dedicated to this app on the hub's shared address, with every page, API
  call and live connection served under that path.
- **FR2** — WHEN a participant opens an invite link THE SYSTEM SHALL let them
  join the session without an account and without any sign-in prompt.
- **FR2a** — THE SYSTEM SHALL let a participant on the public internet, outside
  the operator's private network and with no extra software installed, open an
  invite link and take part in the session.
- **FR3** — WHEN an editor or administrator signs in THE SYSTEM SHALL
  authenticate them through the hub's shared identity provider and grant the
  editor or administrator capabilities recorded for them there for this app
  only; those capabilities SHALL grant nothing in any other hub application,
  and capabilities held for other applications SHALL grant nothing here.
- **FR4** — THE SYSTEM SHALL NOT run an identity provider of its own on the
  hub.
- **FR5** — WHILE participants share a session through the hub THE SYSTEM SHALL
  keep live editing, presence and chat in step for all of them as it does when
  run locally.
- **FR6** — WHEN a participant runs a solution on the hub THE SYSTEM SHALL run
  it isolated and report results as it does when run locally.
- **FR7** — WHEN the app is restarted, redeployed or the hub machine reboots
  THE SYSTEM SHALL keep every session, problem and chat message.
- **FR8** — WHEN the operator deploys a new version THE SYSTEM SHALL leave every
  other application on the hub running and unchanged.
- **FR9** — WHEN the app first starts on the hub THE SYSTEM SHALL hold the
  20-problem starter set and no sessions; nothing is carried over from any
  local installation.

## Non-functional requirements

- **Isolation.** Participant code run on the hub cannot reach any other hub
  application, the identity provider, any database or the network.
- **Memory.** All of the app's running parts together, including sandboxed
  runs, use at most 1 GB of the hub's memory.
- **No behaviour change.** Every rule of specs 001, 002 and 003 holds unchanged
  on the hub.
- **Secrets.** Every credential comes from configuration outside version
  control (constitution 7).

## Out of scope

- Setting up the hub's entry point and identity provider — spec 004.
- New features or changes to existing app behaviour.
- Automated deployment pipelines; the operator deploys by hand.
- Backups of the app's data on the hub.
- Migrating problems, sessions or chat from a local installation.

## Acceptance criteria

- **FR1** — Given the app deployed on the hub, when a user opens its address,
  then the app's start page loads over HTTPS; and when a participant joins a
  session, then the page, its API calls and its live connection are all
  served under the app's path on the hub address.
- **FR2** — Given an active session and a browser with no session cookie and no
  account, when the browser opens the session's invite link, then it reaches
  the join step without being sent to sign in.
- **FR2a** — Given an active session, when a device on the public internet,
  not connected to the operator's private network, opens the invite link,
  then it joins the session and sees live edits.
- **FR3** — Given a user holding the editor capability in the shared identity
  provider, when they sign in to the app, then they can manage problems; and
  given a user without it, then they cannot; and given a user holding editor
  or administrator capabilities only for another hub application, when they
  sign in to this app, then they can neither manage problems nor reactivate
  sessions; and given a user holding only this app's administrator
  capability, when they open another hub application, then it grants them
  nothing there.
- **FR4** — Given the app deployed on the hub, when the operator lists the
  services the app's deployment runs, then none of them is an identity
  provider.
- **FR5** — Given two participants in one session on the hub, when one types in
  the editor or sends a chat message, then the other sees it without
  reloading, and both appear in the presence list.
- **FR6** — Given a session on the hub, when a participant runs a solution,
  then they see per-test results, and a solution attempting a network
  connection fails to make one.
- **FR7** — Given a session with code and chat messages, when the app is
  redeployed and the hub machine rebooted, then the session, its code and its
  messages are all still there.
- **FR8** — Given another application running on the hub, when the operator
  deploys a new version of this app, then the other application keeps
  answering throughout.
- **FR9** — Given a fresh deployment on the hub, when an editor lists the
  problems and an administrator lists the sessions, then there are exactly the
  20 starter problems and no sessions.
- **Memory** — Given the app deployed on the hub, when several participants run
  solutions at once, then the total memory used by the app's running parts
  never exceeds 1 GB.

## Decisions

Resolved with the human on 2026-10-25.

- **Sub-path, not own address.** The app lives under a path on the hub's one
  address, as BoarHQ's spec 002 requires. The app has to build its page, API
  and live-connection addresses under that path (FR1).
- **Public reach.** Invite links work from the public internet, not only the
  private network (FR2a). That needs more than a private-network-only hub
  gives: the hub's entry point has to be reachable from the public internet,
  at least for this app's path. If spec 004 or BoarHQ's design rules that out,
  they change first.
- **Capabilities scoped to this app** (FR3).
- **Fresh start:** the starter set and no sessions; no migration (FR9).
- **Memory budget:** 1 GB for the whole app, out of the at least 2.5 GB spec
  004 leaves for every application.

## Open questions

None.
