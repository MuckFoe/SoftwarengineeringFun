// Runs against the production stack (docker-compose.yml) plus the already-running test
// Keycloak (docker-compose.test.yml's `keycloak` service). global-setup.ts brings the
// stack up (and rotates the test client's secret + test users); global-teardown.ts tears
// it down.
//   export TEST_KEYCLOAK_ADMIN_PASSWORD=<the running test stack's admin password>
//   docker compose -f ../docker-compose.test.yml up -d --wait keycloak
//   npx playwright test
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8000",
  },
});
