// Default: runs against the production stack (docker-compose.yml) plus the already-running
// test Keycloak (docker-compose.test.yml's `keycloak` service). global-setup.ts brings the
// stack up (and rotates the test client's secret + test users); global-teardown.ts tears
// it down.
//   export TEST_KEYCLOAK_ADMIN_PASSWORD=<the running test stack's admin password>
//   docker compose -f ../docker-compose.test.yml up -d --wait keycloak
//   npx playwright test
//
// HUB=1 (spec 005, plan §4.3): runs against the app deployed on the local hub stand-in at
// HUB_URL/collab/. scripts/check-hub.sh brings that up, writes .keycloak-state.json for the
// hub's realm, runs this project and tears it all down; the global setup above is skipped.
//   scripts/check-hub.sh [playwright args]
import { defineConfig } from "@playwright/test";

const HUB = process.env.HUB === "1";
const HUB_URL = (process.env.HUB_URL ?? "http://localhost:18080").replace(/\/$/, "");
const HUB_SPECS = [/\/hub[^/]*\.spec\.ts$/, /\/(session|collab|chat|problems)\.spec\.ts$/];

export default defineConfig({
  testDir: ".",
  ...(HUB ? {} : { globalSetup: "./global-setup.ts", globalTeardown: "./global-teardown.ts" }),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8000",
  },
  projects: HUB
    ? [{ name: "hub", testMatch: HUB_SPECS, use: { baseURL: `${HUB_URL}/collab/` } }]
    : [{ name: "default", testIgnore: /\/hub[^/]*\.spec\.ts$/ }],
});
