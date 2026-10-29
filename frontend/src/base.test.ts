import type { UserConfig, UserConfigFnObject } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

// BASE is read from import.meta.env when the module loads, so each case stubs the env and
// imports a fresh copy.
async function loadBase(baseUrl: string) {
  vi.stubEnv("BASE_URL", baseUrl);
  vi.resetModules();
  return import("./base");
}

async function loadViteConfig(appBasePath?: string) {
  if (appBasePath !== undefined) vi.stubEnv("APP_BASE_PATH", appBasePath);
  vi.resetModules();
  const config = (await import("../vite.config")).default as UserConfigFnObject;
  return config({ command: "build", mode: "production" }) as UserConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("base path (spec 005 FR1)", () => {
  it('serves from the root under BASE="/"', async () => {
    const base = await loadBase("/");
    expect(base.BASE).toBe("/");
    expect(base.apiPath("/me")).toBe("/api/me");
    expect(base.routerBasename).toBe("/");
  });

  it('serves under the app path under BASE="/collab/"', async () => {
    const base = await loadBase("/collab/");
    expect(base.BASE).toBe("/collab/");
    expect(base.apiPath("/me")).toBe("/collab/api/me");
    expect(base.routerBasename).toBe("/collab");
  });
});

describe("Vite base from APP_BASE_PATH", () => {
  it("defaults to /", async () => {
    vi.stubEnv("APP_BASE_PATH", undefined);
    expect((await loadViteConfig()).base).toBe("/");
  });

  it("uses APP_BASE_PATH when set", async () => {
    expect((await loadViteConfig("/collab/")).base).toBe("/collab/");
  });
});
