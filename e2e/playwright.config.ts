// Default: runs against the production stack (docker-compose.yml) plus the already-running
// test Keycloak (docker-compose.test.yml's `keycloak` service). global-setup.ts brings the
// stack up (and rotates the test client's secret + test users); global-teardown.ts tears
// it down.
//   export TEST_KEYCLOAK_ADMIN_PASSWORD=<the running test stack's admin password>
//   docker compose -f ../docker-compose.test.yml up -d --wait keycloak
//   npx playwright test
//
// PW_KEEP_STACK=1: keep the stack between runs. Setup reuses a running stack (no secret/user
// rotation) when .env, .keycloak-state.json, Keycloak and the api are consistent, rebuilding
// only if the compose inputs (backend/frontend/runner/sandbox/brand-assets) changed; teardown
// skips `down -v` and file removal. Run a plain `npx playwright test` to clean up afterwards.
// Caveat: the DB persists across runs, so tests must not assume empty global state.
//
// HUB=1 (spec 005, plan §4.3): runs against the app deployed on the local hub stand-in at
// HUB_URL/collab/. scripts/check-hub.sh brings that up, writes .keycloak-state.json for the
// hub's realm, runs this project and tears it all down; the global setup above is skipped.
//   scripts/check-hub.sh [playwright args]
import { defineConfig } from "@playwright/test";

const HUB = process.env.HUB === "1";
const HUB_URL = (process.env.HUB_URL ?? "http://localhost:18080").replace(/\/$/, "");
const HUB_SPECS = [/\/hub[^/]*\.spec\.ts$/, /\/(session|collab|chat|problems)\.spec\.ts$/];

// PW_WORKERS=<n> (default 8; PW_WORKERS=1 gives one serial project): spec files run in parallel
// across n workers. Two groups of specs touch state that is global to the shared stack and so
// get their own project:
//   "giphy": the fake GIPHY is one process with one request log and an on/off switch; these
//     reset, switch and read it (and so does the GIF screen of the look matrix). One worker,
//     listed first so it takes a worker at once and runs from the start alongside "default", since they conflict only with each other.
//   "last": wall-clock latency and the presentation library's exact global list; they run
//     alone after everything else. It is the teardown of both other projects, so it also runs
//     when they have failures.
// Spec files that reset or read stored preferences use their own accounts (fixtures
// resetPreferences / workerUser), so they run in "default" with the rest.
const WORKERS = Number(process.env.PW_WORKERS ?? 8);
const GIPHY_SPECS: RegExp[] = [
  /\/gifs\.spec\.ts$/,
  /\/audi\/gif\.spec\.ts$/,
  /\/audi\/matrix-gif\.spec\.ts$/,
  /\/present-session-extras\.spec\.ts$/,
  // Spec 020: the fake model's `POST /cold` is one-shot global state; the look matrix's
  // warming-up screen (matrix-gif.spec.ts) uses it too.
  /\/hints\.spec\.ts$/,
];
const LAST_SPECS: RegExp[] = [
  // Wall-clock p95 latency: any concurrent load skews it.
  /\/latency\.spec\.ts$/,
  // The presentation library is one global list; AC-1/AC-2 assert its exact content.
  /\/present-library\.spec\.ts$/,
];
const NON_HUB = /\/hub[^/]*\.spec\.ts$/;
const PARALLEL = WORKERS > 1;

export default defineConfig({
  testDir: ".",
  ...(HUB ? {} : { globalSetup: "./global-setup.ts", globalTeardown: "./global-teardown.ts" }),
  fullyParallel: false,
  workers: WORKERS,
  retries: 0,
  // Tight defaults so a failing test stops quickly; a loaded machine relaxes them with
  // PW_TEST_TIMEOUT / PW_EXPECT_TIMEOUT (ms). A test that genuinely waits sets its own.
  timeout: Number(process.env.PW_TEST_TIMEOUT ?? 20_000),
  expect: { timeout: Number(process.env.PW_EXPECT_TIMEOUT ?? 5_000) },
  use: {
    baseURL: "http://127.0.0.1:8000",
    actionTimeout: Number(process.env.PW_ACTION_TIMEOUT ?? 5_000),
    navigationTimeout: Number(process.env.PW_NAV_TIMEOUT ?? 10_000),
  },
  projects: HUB
    ? [{ name: "hub", testMatch: HUB_SPECS, use: { baseURL: `${HUB_URL}/collab/` } }]
    : PARALLEL
      ? [
          { name: "giphy", testMatch: GIPHY_SPECS, workers: 1, teardown: "last" },
          {
            name: "default",
            testIgnore: [NON_HUB, ...GIPHY_SPECS, ...LAST_SPECS],
            teardown: "last",
          },
          { name: "last", testMatch: LAST_SPECS, workers: 1 },
        ]
      : [{ name: "default", testIgnore: NON_HUB }],
});
