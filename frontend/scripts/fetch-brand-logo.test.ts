// @vitest-environment node
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The fake third-party site is the single permitted fake (plan §4); it is served over real HTTP.
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "fake-styleguide");
const SCRIPT = join(here, "fetch-brand-logo.mjs");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/hang") return; // never answers
    if (path === "/blocked") return void req.socket.destroy();
    const file = join(FIXTURE, path === "/" ? "index.html" : path);
    if (!file.startsWith(FIXTURE) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/plain" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "brand-logo-"));
  return () => rmSync(dir, { recursive: true, force: true });
});

function run(page: string, extra: string[] = []) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child: ChildProcess = spawn(
      "node",
      [SCRIPT, "--url", `${base}/${page}`, "--dir", dir, "--timeout", "4000", ...extra],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d;
    });
    child.stderr?.on("data", (d) => {
      out += d;
    });
    child.on("close", (code) => resolve({ code, out }));
  });
}

const written = () => readdirSync(dir).sort();

describe("fetch-brand-logo (FR-11)", { timeout: 30000 }, () => {
  it("writes logo.svg and logo.source.txt for a valid <img> SVG in the header", async () => {
    const r = await run("index.html");
    expect(r.code).toBe(0);
    expect(written()).toEqual(["logo.source.txt", "logo.svg"]);
    expect(readFileSync(join(dir, "logo.svg"), "utf8")).toContain("<svg");
    const src = readFileSync(join(dir, "logo.source.txt"), "utf8");
    expect(src).toContain(`${base}/logo-valid.svg`);
    expect(src).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("accepts an inline <svg> in the header", async () => {
    const r = await run("inline.html");
    expect(r.code).toBe(0);
    expect(written()).toEqual(["logo.source.txt", "logo.svg"]);
  });

  it("accepts a network response whose URL matches logo", async () => {
    const r = await run("network.html");
    expect(r.code).toBe(0);
    expect(written()).toEqual(["logo.source.txt", "logo.svg"]);
  });

  it("accepts a non-opaque PNG in the aspect range as logo.png", async () => {
    const r = await run("png.html");
    expect(r.code).toBe(0);
    expect(written()).toEqual(["logo.png", "logo.source.txt"]);
    expect(readFileSync(join(dir, "logo.png")).subarray(1, 4).toString()).toBe("PNG");
  });

  it.each([
    ["an opaque PNG", "opaque.html"],
    ["a wrong-aspect SVG", "wrong-aspect.html"],
    ["an SVG containing <text>", "text.html"],
    ["a page with no logo", "none.html"],
    ["a missing page", "missing.html"],
  ])("rejects %s: exits 0, writes nothing, warns", async (_n, page) => {
    const r = await run(page);
    expect(r.code).toBe(0);
    expect(written()).toEqual([]);
    expect(r.out.toLowerCase()).toContain("warn");
  });

  it("times out: exits 0, writes nothing, warns", async () => {
    const r = await run("hang", ["--timeout", "1500"]);
    expect(r.code).toBe(0);
    expect(written()).toEqual([]);
    expect(r.out.toLowerCase()).toContain("warn");
  });

  it("survives a blocked request: exits 0, writes nothing, warns", async () => {
    const r = await run("blocked");
    expect(r.code).toBe(0);
    expect(written()).toEqual([]);
    expect(r.out.toLowerCase()).toContain("warn");
  });
});
