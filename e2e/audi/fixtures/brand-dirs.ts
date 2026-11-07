// Spec 015 task 34: builds temp `brand-assets/` directories from SYNTHETIC files only. The
// vendored OFL fallback typeface stands in as the "Audi" face; the icon and logo are dummy
// SVGs. Nothing here is an Audi asset, and nothing is written inside the repository.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const FALLBACK_FONT = path.join(REPO, "frontend/src/assets/fonts/roboto-flex-latin-wdth.woff2");
const GENERATOR = path.join(REPO, "frontend/scripts/brand-assets.mjs");

const DUMMY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>\n`;
const DUMMY_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 30"><rect width="90" height="30"/></svg>\n`;

export interface BrandSupply {
  font?: boolean;
  /** Semantic icon names (the `data-icon` value) to supply a dummy SVG for. */
  icons?: string[];
  logo?: boolean;
}

/** Creates the directory, writes the supplied files and runs the real generator over it. */
export function makeBrandDir(supply: BrandSupply): string {
  const dir = mkdtempSync(path.join(tmpdir(), "brand-assets-"));
  if (supply.font) {
    mkdirSync(path.join(dir, "fonts"));
    copyFileSync(FALLBACK_FONT, path.join(dir, "fonts", "AudiType.woff2"));
  }
  if (supply.icons?.length) {
    mkdirSync(path.join(dir, "icons"));
    for (const name of supply.icons) writeFileSync(path.join(dir, "icons", `${name}.svg`), DUMMY_ICON);
  }
  if (supply.logo) writeFileSync(path.join(dir, "logo.svg"), DUMMY_LOGO);
  execFileSync("node", [GENERATOR, "--dir", dir], { stdio: "inherit" });
  return dir;
}
