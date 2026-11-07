#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
// Spec 015 plan 1.6: obtain the brand logo from the styleguide SPA with headless Chromium.
//   node fetch-brand-logo.mjs [--dir <path>] [--url <url>] [--timeout <ms>]
// Writes <dir>/logo.svg|png and <dir>/logo.source.txt, only when a candidate passes validation.
// Every failure prints a warning and the process still exits 0 (the app-name fallback applies).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = "https://styleguide.audi.com/document/2865#/-/ui-introduction";
const MIN_ASPECT = 2.5;
const MAX_ASPECT = 4.5;
const KEYWORDS = /audi|logo|rings/i;

function warn(msg) {
  console.warn(`warn: fetch-brand-logo: ${msg}`);
}

function parseArgs(argv) {
  const o = {
    dir: process.env.BRAND_DIR || resolve(here, "..", "..", "brand-assets"),
    url: DEFAULT_URL,
    timeout: 30000,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") o.dir = resolve(argv[++i]);
    else if (argv[i] === "--url") o.url = argv[++i];
    else if (argv[i] === "--timeout") o.timeout = Number(argv[++i]);
  }
  return o;
}

const inRange = (w, h) => w > 0 && h > 0 && w / h >= MIN_ASPECT && w / h <= MAX_ASPECT;

/** SVG without <text>/<image> and a viewBox (or width/height) aspect in range. */
export function validSvg(text) {
  if (!/<svg[\s>]/i.test(text) || /<text[\s>]/i.test(text) || /<image[\s>]/i.test(text))
    return false;
  const tag = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const vb = tag.match(
    /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i,
  );
  if (vb) return inRange(Number(vb[1]), Number(vb[2]));
  const w = tag.match(/\swidth\s*=\s*["']([\d.]+)/i);
  const h = tag.match(/\sheight\s*=\s*["']([\d.]+)/i);
  return Boolean(w && h) && inRange(Number(w[1]), Number(h[1]));
}

/** 8-bit PNG with an alpha channel in which at least one pixel is not fully opaque. */
export function validPng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return false;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const type = buf[25];
  if (!inRange(w, h) || depth !== 8 || (type !== 4 && type !== 6) || buf[28] !== 0) return false;
  const idat = [];
  for (let p = 8; p + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString("latin1", p + 4, p + 8);
    if (name === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return false;
  }
  const bpp = type === 6 ? 4 : 2;
  const stride = w * bpp;
  if (raw.length < (stride + 1) * h) return false;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = bpp - 1; x < stride; x += bpp) if (line[x] < 255) return true;
    prev = line;
  }
  return false;
}

function loadPlaywright() {
  // Playwright is already a dev dependency of e2e/; resolve it from there or from the frontend.
  for (const from of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "e2e", "package.json"),
  ]) {
    try {
      return createRequire(from)("playwright");
    } catch {}
  }
  throw new Error("playwright is not installed (run npm ci in e2e/)");
}

async function collect(page, responses) {
  const found = [];
  const fromDom = await page.evaluate((kw) => {
    const re = new RegExp(kw, "i");
    const out = [];
    for (const el of document.querySelectorAll("img, svg")) {
      const attrs = ["alt", "aria-label", "title", "src", "href", "class", "id"]
        .map((a) => el.getAttribute(a) || "")
        .join(" ");
      const top = el.getBoundingClientRect().top;
      const inHeader = Boolean(el.closest("header, [role=banner], [class*=header i]"));
      // The live styleguide logo is an <img> with no alt/class/URL keyword, a Frontify CDN
      // URL with a "{width}" placeholder, in the top-left sidebar: also take any <img> near
      // the top of the page; validation (aspect, no text/image, SVG or alpha PNG) filters.
      const nearTop = el.tagName.toLowerCase() === "img" && top >= 0 && top < 200;
      if (!re.test(attrs) && !nearTop) continue;
      if (el.tagName.toLowerCase() === "img") {
        out.push({ kind: "img", url: el.currentSrc || el.src, inHeader, top });
      } else {
        const clone = el.cloneNode(true);
        if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        out.push({ kind: "svg", markup: clone.outerHTML, inHeader });
      }
    }
    return out;
  }, KEYWORDS.source);
  fromDom.sort((a, b) => Number(b.inHeader) - Number(a.inHeader) || (a.top ?? 0) - (b.top ?? 0));
  for (const c of fromDom) {
    if (c.kind === "svg")
      found.push({ ext: "svg", data: Buffer.from(c.markup), source: page.url() });
    else if (c.url?.startsWith("data:")) {
      const m = c.url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
      if (m) {
        const data = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
        found.push({ ext: /svg/.test(m[1]) ? "svg" : "png", data, source: "data URI in page" });
      }
    } else if (c.url) {
      try {
        // Frontify serves "?width={width}" templates; ask for a concrete width (adds a viewBox).
        const r = await page.request.get(c.url.replace("{width}", "512"));
        const type = r.headers()["content-type"] || "";
        if (r.ok())
          found.push({
            ext: /svg/.test(type) ? "svg" : "png",
            data: await r.body(),
            source: c.url,
          });
      } catch {}
    }
  }
  for (const r of responses) {
    try {
      const type = r.headers()["content-type"] || "";
      if (!/image\/(svg\+xml|png)/.test(type) || !/logo|rings/i.test(r.url())) continue;
      found.push({
        ext: type.includes("svg") ? "svg" : "png",
        data: await r.body(),
        source: r.url(),
      });
    } catch {}
  }
  return found;
}

export async function fetchLogo({ dir, url, timeout }) {
  let browser;
  try {
    browser = await loadPlaywright().chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    const responses = [];
    page.on("response", (r) => responses.push(r));
    await page.goto(url, { waitUntil: "networkidle", timeout });
    await page.waitForSelector("header, [role=banner]", { timeout }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
    const candidates = await collect(page, responses);
    if (candidates.length === 0)
      return warn("no logo candidate found; the app name is shown instead");
    for (const c of candidates) {
      const ok = c.ext === "svg" ? validSvg(c.data.toString("utf8")) : validPng(c.data);
      if (!ok) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `logo.${c.ext}`), c.data);
      writeFileSync(
        join(dir, "logo.source.txt"),
        `${c.source}\n${new Date().toISOString().slice(0, 10)}\n`,
      );
      console.log(`fetch-brand-logo: wrote logo.${c.ext} from ${c.source}`);
      return;
    }
    warn(
      `rejected ${candidates.length} candidate(s) (not a transparent 2.5-4.5:1 logo); the app name is shown instead`,
    );
  } catch (e) {
    warn(`${e?.message?.split("\n")[0] ?? e}; the app name is shown instead`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchLogo(parseArgs(process.argv.slice(2))).catch((e) => warn(String(e)));
  process.exit(0);
}
