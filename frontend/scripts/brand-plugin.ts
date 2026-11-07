// Spec 015 plan 1.5/1.6: dev-server plugin serving the brand directory at <BASE>brand/.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES: Record<string, string> = {
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  woff2: "font/woff2",
  json: "application/json",
  txt: "text/plain",
};

export function brandDir(): string {
  return resolve(process.env.BRAND_DIR || join(here, "..", "..", "brand-assets"));
}

function generate(dir: string) {
  const r = spawnSync("node", [join(here, "brand-assets.mjs"), "--dir", dir], { stdio: "inherit" });
  if (r.status !== 0) console.warn("warn: brand: generator failed; brand.css not updated");
}

/** First start without a cached logo: fetch it, then regenerate. Never blocks or throws. */
function cacheLogo(dir: string) {
  const args = [join(here, "fetch-brand-logo.mjs"), "--dir", dir];
  if (process.env.BRAND_LOGO_URL) args.push("--url", process.env.BRAND_LOGO_URL);
  const child = spawn("node", args, { stdio: "inherit" });
  child.on("error", (e) => console.warn(`warn: brand: logo fetch failed: ${e.message}`));
  child.on("close", () => generate(dir));
}

export function brandPlugin(): Plugin {
  return {
    name: "brand-assets",
    configureServer(server) {
      const dir = brandDir();
      generate(dir);
      const hasLogo = () => ["logo.svg", "logo.png"].some((f) => existsSync(join(dir, f)));
      if (!hasLogo() && process.env.BRAND_FETCH_LOGO !== "0") cacheLogo(dir);
      const prefix = `${server.config.base}brand/`;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        const rel = decodeURIComponent(url.slice(prefix.length));
        const file = resolve(dir, rel);
        if (file.startsWith(dir + sep) && existsSync(file) && statSync(file).isFile()) {
          res.setHeader(
            "content-type",
            TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
          );
          res.end(readFileSync(file));
        } else if (rel === "brand.css") {
          res.setHeader("content-type", "text/css");
          res.end("");
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}
