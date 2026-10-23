// Shared e2e fixtures (plan.md "Test strategy"): the test users global-setup.ts created
// with runtime passwords, and a helper to open N independent browser contexts (each one
// a separate "browser", with its own cookies) for multi-participant scenarios.
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Browser, type BrowserContext, test as base } from "@playwright/test";
import type { KeycloakState } from "./global-setup";

function readKeycloakState(): KeycloakState {
  const file = path.join(import.meta.dirname, ".keycloak-state.json");
  return JSON.parse(readFileSync(file, "utf-8")) as KeycloakState;
}

export async function openContexts(browser: Browser, n: number): Promise<BrowserContext[]> {
  return Promise.all(Array.from({ length: n }, () => browser.newContext()));
}

export const test = base.extend<{ keycloak: KeycloakState }>({
  keycloak: async ({}, use) => {
    await use(readKeycloakState());
  },
});

export { expect } from "@playwright/test";
