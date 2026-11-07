// @vitest-environment node
// 015 task 11: the dev server serves BRAND_DIR at <BASE>brand/ and caches the logo once.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "fake-styleguide");
const TYPES: Record<string, string> = { ".html": "text/html", ".svg": "image/svg+xml" };

let dir: string;
let vite: ViteDevServer | undefined;
let fake: Server | undefined;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "brand-dev-"));
});
afterEach(async () => {
  await vite?.close();
  vite = undefined;
  fake?.closeAllConnections();
  fake?.close();
  fake = undefined;
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

async function start(env: Record<string, string>): Promise<string> {
  Object.assign(process.env, env);
  vite = await createServer({
    configFile: join(here, "..", "vite.config.ts"),
    root: join(here, ".."),
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
  });
  await vite.listen();
  return `http://127.0.0.1:${((vite.httpServer as Server).address() as AddressInfo).port}`;
}

async function until(cond: () => boolean, ms = 25000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  expect(cond()).toBe(true);
}

describe("brand dev plugin", { timeout: 40000 }, () => {
  it("FR-3: an empty BRAND_DIR gives 200 brand.css without @font-face, and the page links it", async () => {
    const url = await start({ BRAND_DIR: dir, BRAND_FETCH_LOGO: "0" });
    const css = await fetch(`${url}/brand/brand.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).not.toContain("@font-face");
    const html = await (await fetch(`${url}/`)).text();
    expect(html).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\/brand\/brand\.css"/);
    expect((await fetch(`${url}/brand/fonts/none.woff2`)).status).toBe(404);
  });

  it("an unset BRAND_DIR still answers brand.css with 200", async () => {
    const url = await start({ BRAND_DIR: "", BRAND_FETCH_LOGO: "0" });
    expect((await fetch(`${url}/brand/brand.css`)).status).toBe(200);
  });

  it("serves supplied fonts through the generated brand.css", async () => {
    mkdirSyncFonts(dir);
    const url = await start({ BRAND_DIR: dir, BRAND_FETCH_LOGO: "0" });
    expect(await (await fetch(`${url}/brand/brand.css`)).text()).toContain("fonts/a.woff2");
    expect((await fetch(`${url}/brand/fonts/a.woff2`)).status).toBe(200);
  });

  it("FR-11: a missing logo is fetched once, cached, and brand.css gains the logo rule", async () => {
    fake = createHttp((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      const file = join(FIXTURE, path === "/" ? "index.html" : path);
      if (!existsSync(file)) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/plain" });
      res.end(readFileSync(file));
    });
    await new Promise<void>((ok) => fake?.listen(0, "127.0.0.1", ok));
    const site = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/index.html`;
    const url = await start({ BRAND_DIR: dir, BRAND_LOGO_URL: site });
    await until(() => existsSync(join(dir, "logo.svg")));
    await until(() => readFileSync(join(dir, "brand.css"), "utf8").includes(".brand-logo"));
    const logo = await fetch(`${url}/brand/logo.svg`);
    expect(logo.status).toBe(200);
  });

  it("FR-11: a failing fetch leaves start-up working and brand.css empty", async () => {
    const url = await start({ BRAND_DIR: dir, BRAND_LOGO_URL: "http://127.0.0.1:9/none" });
    expect((await fetch(`${url}/brand/brand.css`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    expect(existsSync(join(dir, "logo.svg"))).toBe(false);
    expect(readFileSync(join(dir, "brand.css"), "utf8")).not.toContain(".brand-logo");
  });
});

function mkdirSyncFonts(d: string) {
  mkdirSync(join(d, "fonts"));
  writeFileSync(join(d, "fonts", "a.woff2"), "x");
}
