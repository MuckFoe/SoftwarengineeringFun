// Spec 016 task 3 (FR-1, FR-3, FR-9): the v2 helpers themselves, against fixture elements.
// Needs no app page: the markup is set directly.
import { expect, test } from "@playwright/test";
import { emulateReducedMotion, expectReducedMotion, v2Offenders } from "./checks";
import { SCREENS } from "./matrix";

const V2 = `<style>
  body { margin: 0; background: #f4f6fa; color: #101418; font: 16px sans-serif }
  button { height: 40px; padding: 0 20px; border: 0; border-radius: 999px; background: #1f5fff; color: #fff }
  [data-card] { width: 200px; height: 120px; border-radius: 24px; background: #fff }
  aside { background: #e9edf4; padding: 8px }
</style><aside><button>Run</button></aside><div data-card>Card</div>`;

const SQUARE = `<style>
  body { margin: 0; background: #f4f6fa }
  button { height: 40px; padding: 0 20px; border: 1px solid #000; border-radius: 0; background: #fff; color: #000 }
  [data-card] { width: 200px; height: 120px; border: 1px solid #000; background: #fff }
  aside { background: #f4f6fa; border: 1px solid #000 }
</style><aside><button>Run</button></aside><div data-card>Card</div>`;

test.use({ colorScheme: "light" });

test("FR-1: passes on a v2 fixture", async ({ page }) => {
  await page.setContent(V2);
  expect(await v2Offenders(page)).toEqual([]);
});

test("FR-1: fails on a square outlined control, card and region", async ({ page }) => {
  await page.setContent(SQUARE);
  const o = await v2Offenders(page);
  expect(o.some((m) => m.startsWith("shape: button"))).toBe(true);
  expect(o.some((m) => m.startsWith("shape: div[Card]"))).toBe(true);
  expect(o.some((m) => m.startsWith("outline: aside"))).toBe(true);
  expect(o.some((m) => m.startsWith("tone: aside"))).toBe(true);
});

test("FR-1: a non-accent hue is an offender; danger only when allowed", async ({ page }) => {
  await page.setContent(`${V2}<p style="color:#0da20d">ok?</p><p style="color:#c8102e">err</p>`);
  const o = await v2Offenders(page);
  expect(o.some((m) => m.includes("rgb(13, 162, 13)"))).toBe(true);
  expect(o.some((m) => m.includes("rgb(200, 16, 46)"))).toBe(false);
  expect((await v2Offenders(page, { danger: false })).some((m) => m.includes("rgb(200, 16, 46)"))).toBe(true);
});

test("FR-3: an endless animation fails reduced motion; a static page passes", async ({ page }) => {
  await emulateReducedMotion(page);
  await page.setContent(V2);
  await expectReducedMotion(page);
  await page.setContent(
    `<style>@keyframes p{to{opacity:.5}}div{animation:p 1s infinite}</style><div>dot</div>`,
  );
  await expect(expectReducedMotion(page)).rejects.toThrow();
});

test("FR-9: the matrix lists every screen FR-9 names", () => {
  const names = SCREENS.map((s) => s.name);
  for (const want of [
    "session",
    "run output",
    "learning session",
    "GIF search",
    "presentation",
    "hub self-registration",
    "games lobby",
    "chess session (guest)",
  ]) {
    expect(names).toContain(want);
  }
});
