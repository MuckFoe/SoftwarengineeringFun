# 004 — Project hub: shared entry point and identity

## Problem / Why

Several projects (this one, BoarHQ, and others to come) are to be hosted on one
shared machine, the **project hub**. Running a separate entry point,
certificate setup and identity provider per project wastes the hub's limited
memory and repeats the same security-critical setup each time. The hub
therefore gets exactly **one entry point** that every application is reached
through, and **one identity provider** that every application can use for
sign-in (user, 2026-10-25). Adding the next application must be a small,
isolated step that does not disturb the ones already running.

How the entry point is built is already decided in the BoarHQ repository; this
spec states what the hub must do, and `/sdd-plan` takes that decision as its
starting point.

## Users

- **Operator** — sets up the hub, adds and removes applications, administers
  the identity provider.
- **Application user** — anyone using an application hosted on the hub, signed
  in or not.
- **Visitor** — anyone who reaches the hub's address without being a user.

## Functional requirements

- **FR1** — WHEN a request arrives for a hosted application THE SYSTEM SHALL
  deliver it, through the one entry point, to that application and no other.
- **FR2** — WHEN a user connects THE SYSTEM SHALL serve them over HTTPS with a
  certificate their device trusts without a manual exception.
- **FR3** — THE SYSTEM SHALL NOT make any application, database or the identity
  provider reachable other than through the one entry point.
- **FR4** — THE SYSTEM SHALL run exactly one identity provider, which every
  hosted application can use for sign-in.
- **FR5** — WHEN an application is configured as gated THE SYSTEM SHALL require
  sign-in at the entry point before any request reaches that application, so
  the application needs no sign-in logic of its own.
- **FR6** — WHEN an application is configured as ungated THE SYSTEM SHALL
  deliver requests to it without requiring sign-in, leaving it to the
  application to decide which of its pages need a signed-in user.
- **FR7** — WHEN an application is added THE SYSTEM SHALL keep every existing
  application's address, behaviour and signed-in sessions unchanged.
- **FR8** — WHEN one application is stopped or failing THE SYSTEM SHALL return
  an error for that application and keep serving all others.
- **FR9** — WHEN the hub machine restarts THE SYSTEM SHALL bring the entry point,
  the identity provider and every hosted application back without manual steps.
- **FR10** — WHEN one application's data is reset or restored THE SYSTEM SHALL
  leave identities and every other application's data untouched.

## Non-functional requirements

- **Memory.** The entry point and identity provider together leave at least
  2.5 GB of the hub's 4 GB for applications.
- **Secrets.** Every credential comes from configuration outside version
  control; none is committed (constitution 7).
- **Consistency.** The hub follows the ingress design decided in the BoarHQ
  repository. A departure must be stated and justified in `plan.md`.

## Out of scope

- Deploying any particular application — this project's deployment is
  `005-deploy-to-project-hub`; BoarHQ's is BoarHQ's own.
- Changes to the BoarHQ repository's own specs.
- Backups of hub data (a separate spec if wanted).
- Monitoring, alerting and log collection.
- Provisioning the hub machine itself (it exists: Debian, container runtime
  installed).

## Acceptance criteria

- **FR1** — Given two applications hosted on the hub, when a user requests
  each one's address, then each request is answered by the application it
  addresses.
- **FR2** — Given a device with default trust settings, when it opens a hosted
  application's address, then the connection is HTTPS and no certificate
  warning is shown.
- **FR3** — Given the running hub, when a client on the hub's local network
  connects to the hub machine on any port other than the entry point's, then no
  application, database or identity provider answers.
- **FR4** — Given the running hub, when the operator lists running services,
  then exactly one identity provider is running, and two different
  applications both send their users to it to sign in.
- **FR5** — Given a gated application and a browser with no session, when the
  browser requests any page of that application, then it is sent to sign in
  and the application receives no request until sign-in succeeds.
- **FR6** — Given an ungated application and a browser with no session, when
  the browser requests one of its pages, then the application answers without
  a sign-in prompt from the entry point.
- **FR7** — Given a running hub with one application and a signed-in user,
  when a second application is added, then the first application's address
  still answers the same way and the user is still signed in.
- **FR8** — Given two hosted applications with one of them stopped, when a user
  requests the stopped one, then they receive an error; and when they request
  the other, then it answers normally.
- **FR9** — Given a running hub, when the hub machine is rebooted, then once it
  is back up every hosted application answers at its address with no operator
  action.
- **FR10** — Given an application with stored data and existing user accounts,
  when that application's data is reset, then every user can still sign in and
  every other application's data is unchanged.

## Decisions

Resolved by the user, 2026-10-25.

- **Reach** — anyone on the public internet can reach the hub, through
  Tailscale (Funnel). Nothing is reachable on the hub machine's local network
  (FR3).
- **Addressing** — one hub address, one path per application. Every hosted
  application must work under its own path. This matches BoarHQ's spec 002.
- **Configuration home** — the hub gets a new repository of its own.
  Applications keep their configuration in their own repositories.
- **Accounts** — one set of user accounts for all applications: sign in once,
  recognised everywhere, with roles kept per application.

## Open questions

None.
