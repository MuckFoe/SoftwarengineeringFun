# E2E suite performance

Goal: the whole Playwright suite green in 1-2 minutes wall time, without dropping coverage of
acceptance criteria that only a real browser can show.

## Phase 0 - measurements (baseline, 377 tests, PW_WORKERS=4, kept stack)

Wall 221 s = `default` project 103 s (4 workers) + `serial` project 118 s (1 worker).
Sum of test durations 345 s. Median test 0.5 s; 377 tests, so cost is spread thin.

| Sink | Sum | Notes |
|---|---:|---|
| `present-hosting` "after 60 s Ben hosts" | 62 s | a real 60 s host grace (`PRESENT_HOST_GRACE_SECONDS`, default 60) |
| `serial` project (11 files) | 117 s | runs alone after `default`; its files sum: a11y 21, audi/appearance 36, audi/gif 18, gifs 13, session-extras 8.5, audi/session-list 5.6, profile-prefs 6, present-library 4, audi/home 2.4, latency 2 |
| audi matrix (`audi/appearance` 36 + `a11y-sweep` 9.8 + games/learning/... ) | ~65 s | one fresh context + login + page load per screen x scheme x width |
| `scratch-run`, `present-drawing`, `home/live`, `present-isolation` | 18 + 11 + 11 + 6 | real two-context websocket flows; keep |
| Keycloak UI login (`signIn`) | ~0.18 s each warm (measured, 5 runs: 168-197 ms), vs page load 26-31 ms and new context 27 ms | ~150 call sites, so roughly 25-45 s of the 345 s sum (more under 4-worker load) |

Per-test table: `scratchpad/an.py base.json` (the Playwright JSON report). Top-40 list: the 62 s
hosting test, then 11 s `home/live`, 8.6 s `present-drawing`, 6.2 s and 4.3 s `scratch-run`,
3.8 s `present-isolation`, then everything below 3.7 s. Nothing but the hosting test is a
single long item; the floor is therefore (sum - waits) / workers + the serial tail.

## Phase 1 - decisions, with the numbers

Arithmetic: sum 345 s. Remove the 60 s wait (-52 s on the critical path) and the serial tail
(117 s serial becomes parallel) and the floor at 8 workers is about (345 - 54) / 8 = 36 s plus
~10 s stack check/setup. That is what makes 1-2 minutes reachable. Fast auth alone is worth
about 10 % of the sum; the matrix about 5 %; moving tests to vitest under 5 %.

Order by payoff:

1. **(d) Un-serialise and raise workers (largest: about 100 s of wall).** The serial project exists
   for four kinds of global state; each gets its own isolation instead of a global lock:
   - `delete from account_preference` (a11y, profile-prefs, audi matrix "profile signed in"):
     give each of those specs its own Keycloak test user (`prefs-a11y`, `prefs-profile`,
     `prefs-audi`, created in global-setup like the others) and delete only that account's row.
   - the live-session badge / pulsing indicators that skew axe and `getAnimations()`:
     a11y, audi/appearance, audi/home, audi/session-list assert on screens that list other tests'
     live sessions. Axe and the look checks run on those screens against whatever is live,
     which is the realistic state; keep them in `serial` only if flakes remain after the
     preference fix, otherwise move to `default`.
   - fake GIPHY (one process, one request log, an on/off switch): `gifs`, `audi/gif`,
     `present-session-extras` stay in a single-worker project but it starts at time 0, concurrent
     with `default`, instead of after it (an independent project, not a teardown). They only
     conflict with each other.
   - `latency` (wall-clock p95) and `present-library` (exact global list): stay alone, last.
   Workers: the box has 10 cores; try 6 and 8.
2. **Host grace for the e2e stack.** `PRESENT_HOST_GRACE_SECONDS` is already a setting. The e2e
   stack sets it to 8 s and `present-hosting.spec.ts` reads the same value (`GRACE_MS`), so the
   test waits 8 s rather than 60 s. The 60 s default is untouched and its parsing is covered by
   the backend suite. The AC (host passes to the next participant after the grace, place kept,
   original host returns as a follower) is exercised unchanged.
3. **(a) Fast auth.** `fixtures.signIn` currently drives the Keycloak page. New default: sign in
   through Keycloak once per user per run (via the API request context, not a page), cache the
   resulting signed `collab_session` cookie (Starlette `SessionMiddleware`: base64 JSON payload
   `{sub,name,roles,exp}` signed with `SESSION_COOKIE_KEY`; one hour life) in a file next to
   `.keycloak-state.json`, and for every later `signIn`/`signedInContext` call add that cookie to the
   context and navigate to `next`. The cookie is stateless, so it can be shared by any number of
   contexts (two devices for one user work). Minting it ourselves was rejected: the account `sub`
   is Keycloak's generated id, so a minted cookie needs a Keycloak lookup anyway, and a cached real
   cookie cannot drift from the app's cookie format. The cache is keyed on the hash of
   `.keycloak-state.json` so a rotated setup invalidates it.
   Real login stays exercised through `signInViaKeycloak(...)` in: `signin.spec.ts` (theme, failed
   login, return-to), `auth.spec.ts` (FR-1 redirect, FR-2b SSO), `audi/signin-landing.spec.ts`,
   `audi/self-registration.spec.ts`, `hub*.spec.ts`, and one test per role: editor
   (`problems.spec.ts`), admin (`gifs.spec.ts` removal), plain (`profile.spec.ts`).
4. **(b) Matrix in place.** `audi/appearance` and `a11y-sweep` open each screen once per scheme
   (colour scheme set at context level) and run the same checks at each width through
   `page.setViewportSize` (plus a reload-free `emulateMedia` flip for the scheme where the
   screen reads the media query live), instead of one context + login + load per cell. Same
   checks, same screens, roughly half the opens. Payoff is about 15-20 s of sum, so it comes after
   the three above and is skipped if they already land under 90 s.
5. **(c) Move to vitest/backend.** Judged file by file with the spec criteria as the test:

| File(s) | Sum | Decision | Reason |
|---|---:|---|---|
| descriptions, chat-beside-description, editor-tab, empty-state | 12 s | keep | layout and scroll position assertions (spec 009/013 criteria say "beside", "at its newest message"); jsdom has no layout |
| audi/checks.spec | 0.2 s | keep | already fixture-only |
| keyboard, learn-a11y, chess-a11y, a11y, a11y-sweep | 45 s | keep | real keys, focus rings, axe colour sampling |
| chat, collab, session, session-002, chess, chess-latency, latency, present-* | 130 s | keep | real websockets across two or more contexts |
| signin, audi/brand, audi/signin-landing, audi/self-registration | 14 s | keep | the Keycloak theme is rendered by Keycloak; fonts load for real |
| appearance, profile, profile-prefs | 15 s | keep | cross-device preference sync is the criterion |
| delete | - | none | no test duplicates another criterion; duplicates are only the matrix cells (b) |

   Nothing moves: the sum that could move is under 20 s, all of it layout- or key-dependent, and
   the constitution requires each criterion to stay covered by a test that can fail.

## Inner loop

```
source scratchpad/env.sh                          # TEST_* passwords for the kept stack
export PW_KEEP_STACK=1                            # reuse the running stack between runs
npx playwright test --last-failed                 # only what failed last time
npx playwright test chess.spec.ts                 # one spec
npx playwright test --project=default -g "AC-18"  # one project, grep by title
npx playwright test audi/checks.spec.ts auth.spec.ts signin.spec.ts chess.spec.ts keyboard.spec.ts   # ~30 s smoke
PW_WORKERS=1 npx playwright test                  # one serial project, for debugging an order problem
PW_TEST_TIMEOUT=60000 PW_EXPECT_TIMEOUT=15000 npx playwright test   # relax on a loaded machine
```

Timeouts (config defaults, all overridable): test 20 s, expect 5 s (PW_EXPECT_TIMEOUT), action 5 s
(PW_ACTION_TIMEOUT), navigation 10 s (PW_NAV_TIMEOUT). Tests that genuinely wait say so: the host
grace test (grace + 20 s), `present-drawing` 35 s (13-16 s measured), `home/live` 25 s (11 s).

## Changes made (in order of measured payoff)

1. Parallel default and project split: `serial` (117 s alone after `default`) became `giphy`
   (4 GIF-touching specs, one worker, starts with `default`, listed first so it gets a worker) and
   `last` (latency, present-library; 6 s). Preference-resetting specs moved into `default` with
   their own accounts: `prefsuser` (profile-prefs) and `look0..look9` (matrix and a11y, chosen by
   `parallelIndex`); `resetPreferences` deletes one account's row by the `sub` in its cookie.
2. Host grace 10 s in the e2e stack (`PRESENT_HOST_GRACE_SECONDS`, compose passes it through,
   global-setup writes it; the spec reads it back): 62 s test became 12-13 s.
3. Fast auth: `signIn` and `signedInContext` use a cached session cookie (one real Keycloak sign-in
   per user per stack, `.session-cookies.json`, git-ignored). `signInViaKeycloak` is the real path;
   `auth.spec.ts` signs in admin1, plain1 and editor2 through it, and its existing FR-2b test does
   editor1. Measured: a real sign-in is only about 0.18 s, so this was worth about 10 % of the sum.
4. Matrix in place: `audi/matrix-specs.ts` opens each screen once per scheme and steps through the
   widths with `setViewportSize` (68 tests became 34, same checks); the GIF screen moved to
   `audi/matrix-gif.spec.ts` in the `giphy` project.
5. Tight timeouts (above), replacing the blanket 60 s / 15 s.
6. Robustness fixes the faster, tighter runs exposed (all were test races, not app changes):
   axe runs under reduced motion after finite animations settle (rows fading in); every
   "wait for animations" now ignores infinite ones (the Live badge); chess specs wait for the started
   game on every page and for the opponent's move before replying; keyboard specs wait for the full
   list before the next shortcut and fix the Tab starting point; present-follow tolerates the frame's
   document not yet having the element; editor-tab retries the suggestion-then-Tab sequence.

## Results log

| Step | Wall | Notes |
|---|---:|---|
| baseline, 4 workers, `serial` project | 221 s | default 103 + serial 118; sum of tests 345 s |
| + parallel default 4 workers, fast auth, grace 10 s | 176 s | includes one stack rebuild; default 52 s, serial 113 s |
| + project split, per-account prefs, 4 workers | 99 s | giphy 45 s concurrent, last 6 s |
| + matrix in place, 8 workers, tight timeouts | 83-120 s | 8 workers saturate the 10 cores plus Docker (load 14-16); sum of test time rises to 540-640 s; flakes below |
| 6 workers instead of 8 | 111 s | slower, still one flake: 8 stays the default |
| final config (8 workers), 3 runs | 94 / 94 / 94 s, all green except one `present-follow` frame-reload race (since fixed) | machine load 13-16 |
| same config after that fix, 3 runs | 102 s (3 failed), 106 s (1 failed), 100 s (1 failed) | load 18-21 from other work on the machine |

Flakes still seen at the 5 s expect default when the machine is loaded (not fixed, for lack of
time; each passes alone): GIF search results ("Happy cat" option, `audi/gif`, `gifs`, GIF matrix
screen: the fake GIPHY round trip), the chat show/hide toggle (`keyboard` AC-18a "Show or hide chat",
`profile-prefs` FR-15: the region stays visible for 5 s), and `latency` AC-23 (2.90 ms against a 2.86 ms
limit; the 10 % margin is smaller than the machine's noise when other processes run). Remedy to
try first: a per-test 10-15 s expect timeout for the GIF search waits and the chat toggle, or
PW_EXPECT_TIMEOUT=10000 for runs on a busy machine.

Worst case of a run with failures: before, a failing `expect` waited 15 s and a failing test up to
60 s (hosting 180 s), so one bad test cost up to a minute and a full red run about the 120 s plus
the failures'' timeouts divided across workers. Now 5 s per expect and 20 s per test: each failing
test costs at most 20 s of one worker, and the last failing runs finished in 95-131 s wall with
1-3 failures.

`latency.spec.ts` is kept (wall-clock p95 of edit propagation, AC-23) and now runs alone in the
`last` project after everything else, 2 s.
