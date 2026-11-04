// Spec 013 task 8: runs present-bridge.spec.ts alone, without playwright.config.ts's global
// setup (which brings up the whole app stack). The bridge spec needs only Chromium and `uv`.
//   npx playwright test --config present-bridge.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /\/present-bridge\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
});
