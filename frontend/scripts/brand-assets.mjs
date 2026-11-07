#!/usr/bin/env node
// Writes <dir>/brand.css with rules only for the brand files that exist (plan 1.5).
// Exit 0 for missing optional files; exit 1 only if the directory cannot be written.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const i = args.indexOf("--dir");
const dir = i >= 0 ? args[i + 1] : process.env.BRAND_DIR || "brand-assets";

const list = (sub, ext) => {
  try {
    return readdirSync(join(dir, sub))
      .filter((f) => f.toLowerCase().endsWith(ext))
      .sort();
  } catch {
    return [];
  }
};

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
};

const rules = [];

const meta = readJson(join(dir, "fonts", "fonts.json"));
const weight = meta.weight || "100 900";
const stretch = meta.stretch || "75% 150%";
for (const f of list("fonts", ".woff2")) {
  rules.push(
    `@font-face { font-family: "Audi Type"; src: url(fonts/${f}) format("woff2"); font-weight: ${weight}; font-stretch: ${stretch}; font-display: swap; }`,
  );
}

for (const f of list("icons", ".svg")) {
  const name = f.slice(0, -4);
  rules.push(
    `.icon[data-icon="${name}"] { mask-image: url(icons/${f}); -webkit-mask-image: url(icons/${f}); }`,
  );
}

const logo = ["logo.svg", "logo.png"].find((f) => existsSync(join(dir, f)));
if (logo) {
  let ratio = 3;
  if (logo.endsWith(".svg")) {
    const m = readFileSync(join(dir, logo), "utf8").match(
      /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/,
    );
    if (m && Number(m[2]) > 0) ratio = Number(m[1]) / Number(m[2]);
  }
  const r = Number(ratio.toFixed(4));
  rules.push(
    `.brand-logo { display: block; height: 1em; aspect-ratio: ${r}; background: currentColor; mask: url(${logo}) center/contain no-repeat; -webkit-mask: url(${logo}) center/contain no-repeat; }`,
  );
}

const css = rules.length ? `${rules.join("\n")}\n` : "/* no brand assets supplied */\n";
try {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brand.css"), css);
} catch (e) {
  console.error(`brand-assets: cannot write ${dir}/brand.css: ${e.message}`);
  process.exit(1);
}
