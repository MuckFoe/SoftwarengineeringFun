// Spec 022 task 16: the sketch board's drawing tools, Clear and reload, in a real browser
// against the real stack (AC-4, AC-5, AC-6, AC-11, AC-12, AC-15). Pixels are read from the
// board canvas with getImageData at board coordinates (the fixed 1600 × 1000 board, plan
// Board shape); an empty board is fully transparent, its colour being the canvas background.
import type { Page } from "@playwright/test";
import { appUrl, createSession, expect, openContexts, test } from "./fixtures";

const BOARD_W = 1600;
const BOARD_H = 1000;
/** Half the standard shape a click places (plan: 160 × 100 board units). */
const STD_HALF_W = 80;
const STD_HALF_H = 50;

// A wide window so the board has room, and 2× pixels so a 4-unit line is several pixels wide.
test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

type Pt = [x: number, y: number];
type Rgba = [r: number, g: number, b: number, a: number];

const board = (page: Page) => page.getByRole("img", { name: "Sketch board", exact: true });
const sketchTools = (page: Page) => page.getByRole("toolbar", { name: "Sketch tools" });

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/** Reloads; joins again if the page asks for a name. The board stays open (per browser). */
async function reload(page: Page, name: string): Promise<void> {
  await page.reload();
  const nameField = page.getByLabel("Your name");
  await expect(nameField.or(page.locator(".cm-content"))).toBeVisible();
  if (await nameField.isVisible()) {
    await nameField.fill(name);
    await page.getByRole("button", { name: "Join" }).click();
  }
  await expect(page.locator(".cm-content")).toContainText("pass");
  await expect(board(page)).toBeVisible();
}

/** Opens the board with the header's Sketch toggle. */
async function openBoard(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Sketch", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(board(page)).toBeVisible();
}

/** Presses a toolbar button whose accessible name starts with `name` ("Pen", "Blue", ...). */
async function choose(page: Page, name: string): Promise<void> {
  const button = sketchTools(page).getByRole("button", {
    name: new RegExp(`^${name}(, selected)?$`),
  });
  await button.click();
  await expect(button).toHaveAccessibleName(`${name}, selected`);
}

/** Board units → client pixels. */
async function client(page: Page, [x, y]: Pt): Promise<Pt> {
  const box = await board(page).boundingBox();
  if (!box) throw new Error("board not laid out");
  return [box.x + (x / BOARD_W) * box.width, box.y + (y / BOARD_H) * box.height];
}

/** A mouse stroke through `points` (board units), with intermediate moves between them. */
async function stroke(page: Page, points: Pt[]): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  const start = await client(page, first);
  await page.mouse.move(...start);
  await page.mouse.down();
  for (const p of rest) {
    const [cx, cy] = await client(page, p);
    await page.mouse.move(cx, cy, { steps: 8 });
  }
  await page.mouse.up();
}

async function clickAt(page: Page, p: Pt): Promise<void> {
  const [cx, cy] = await client(page, p);
  await page.mouse.click(cx, cy);
}

const hashOf = (page: Page) => board(page).getAttribute("data-sketch-hash");

/** Runs `draw`, then waits until the server has confirmed it (the seq hash changes). */
async function confirmed(page: Page, draw: () => Promise<void>): Promise<void> {
  const before = await hashOf(page);
  await draw();
  await expect(board(page)).not.toHaveAttribute("data-sketch-hash", before ?? "");
}

// Browser-side scripts as strings: this package's tsconfig has no DOM lib.
const CANVAS = `document.querySelector('canvas[data-sketch-hash]')`;

/** The most opaque pixel within `r` board units of (x, y), as [r, g, b, a]. */
const INK_NEAR = `(([x, y, r]) => {
  const c = ${CANVAS};
  const s = c.width / ${BOARD_W};
  const x0 = Math.max(0, Math.floor((x - r) * s)), y0 = Math.max(0, Math.floor((y - r) * s));
  const x1 = Math.min(c.width, Math.ceil((x + r) * s) + 1), y1 = Math.min(c.height, Math.ceil((y + r) * s) + 1);
  const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let best = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > best[3]) best = [d[i], d[i + 1], d[i + 2], d[i + 3]];
  return best;
})`;

/** A palette colour as the canvas paints it, [r, g, b]. */
const PALETTE_RGB = `((name) => {
  const v = getComputedStyle(${CANVAS}).getPropertyValue('--sketch-' + name).trim();
  const t = document.createElement('canvas');
  t.width = t.height = 1;
  const ctx = t.getContext('2d');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 1, 1);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
})`;

/** A digest of every pixel of the board, with its size. */
const DIGEST = `(() => {
  const c = ${CANVAS};
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261, inked = 0;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked++;
  return c.width + 'x' + c.height + ':' + h.toString(16) + ':' + inked;
})`;

/** Number of pixels with any ink. */
const INKED = `(() => {
  const c = ${CANVAS};
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
})`;

const inkNear = (page: Page, [x, y]: Pt, r = 4) =>
  page.evaluate(`${INK_NEAR}(${JSON.stringify([x, y, r])})`) as Promise<Rgba>;
const paletteRgb = (page: Page, name: string) =>
  page.evaluate(`${PALETTE_RGB}(${JSON.stringify(name)})`) as Promise<[number, number, number]>;
const digest = (page: Page) => page.evaluate(`${DIGEST}()`) as Promise<string>;
const inked = (page: Page) => page.evaluate(`${INKED}()`) as Promise<number>;

/** Ink at (or within `r` units of) p. */
async function expectInk(page: Page, p: Pt, r = 4): Promise<void> {
  await expect
    .poll(async () => (await inkNear(page, p, r))[3], { message: `ink at ${p}` })
    .toBeGreaterThan(128);
}

/** No ink at all within `r` units of p. */
async function expectEmpty(page: Page, p: Pt, r = 4): Promise<void> {
  await expect
    .poll(async () => (await inkNear(page, p, r))[3], { message: `no ink at ${p}` })
    .toBe(0);
}

/** The ink at p is the palette colour `name` (±8 per channel for anti-aliasing). */
async function expectColour(page: Page, p: Pt, name: string): Promise<void> {
  const want = await paletteRgb(page, name);
  const [r, g, b, a] = await inkNear(page, p, 3);
  expect(a, `ink at ${p}`).toBeGreaterThan(200);
  for (const [got, exp] of [
    [r, want[0]],
    [g, want[1]],
    [b, want[2]],
  ] as const) {
    expect(
      Math.abs(got - exp),
      `${name} at ${p}: got ${[r, g, b]}, want ${want}`,
    ).toBeLessThanOrEqual(8);
  }
}

async function newBoard(page: Page, request: Parameters<typeof createSession>[0], name = "Ada") {
  const invite = await createSession(request);
  await join(page, invite, name);
  await openBoard(page);
  return invite;
}

test("AC-4: the pen in blue draws a blue freehand line along the dragged curve", async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await choose(page, "Pen");
  await choose(page, "Blue");

  // An arc: up from (200, 700) through (500, 300) and down to (800, 700).
  const curve: Pt[] = [];
  for (let t = 0; t <= 1.0001; t += 0.1) {
    curve.push([Math.round(200 + 600 * t), Math.round(700 - 1600 * t * (1 - t))]);
  }
  await confirmed(page, () => stroke(page, curve));

  for (const p of [curve[0], curve[3], curve[5], curve[8], curve[10]] as Pt[]) {
    await expectColour(page, p, "blue");
  }
  // Freehand, not a straight line between the ends: the chord's middle stays empty.
  await expectEmpty(page, [500, 700], 10);
  await expectEmpty(page, [500, 500], 10);
});

test("AC-5: box and circle span the dragged rectangle; a click places a standard shape centred on it", async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await choose(page, "Red");

  // Box from P to Q (dragged up-left to show either order works).
  await choose(page, "Box");
  const P: Pt = [600, 400];
  const Q: Pt = [200, 150];
  await confirmed(page, () => stroke(page, [P, Q]));
  for (const p of [
    P,
    Q,
    [200, 400],
    [600, 150],
    [400, 150],
    [400, 400],
    [200, 275],
    [600, 275],
  ] as Pt[]) {
    await expectInk(page, p);
  }
  await expectColour(page, [400, 150], "red");
  await expectEmpty(page, [400, 275], 20); // outlined, not filled
  await expectEmpty(page, [650, 275], 20); // nothing past the corners
  await expectEmpty(page, [400, 100], 20);

  // Circle in the rectangle (900, 150)–(1300, 400): touches its edge midpoints, not its corners.
  await choose(page, "Circle");
  await confirmed(page, () =>
    stroke(page, [
      [900, 150],
      [1300, 400],
    ]),
  );
  for (const p of [
    [1100, 150],
    [1100, 400],
    [900, 275],
    [1300, 275],
  ] as Pt[])
    await expectInk(page, p);
  await expectEmpty(page, [900, 150], 15);
  await expectEmpty(page, [1300, 400], 15);
  await expectEmpty(page, [1100, 275], 20);

  // A click with the box: a standard-size box centred on the click.
  await choose(page, "Box");
  const c: Pt = [400, 750];
  await confirmed(page, () => clickAt(page, c));
  for (const p of [
    [c[0] - STD_HALF_W, c[1] - STD_HALF_H],
    [c[0] + STD_HALF_W, c[1] + STD_HALF_H],
    [c[0], c[1] - STD_HALF_H],
    [c[0] - STD_HALF_W, c[1]],
  ] as Pt[]) {
    await expectInk(page, p);
  }
  await expectEmpty(page, c, 20);
  await expectEmpty(page, [c[0] + STD_HALF_W + 20, c[1]], 8);

  // A click with the circle: a standard-size ellipse centred on the click.
  await choose(page, "Circle");
  const e: Pt = [1100, 750];
  await confirmed(page, () => clickAt(page, e));
  for (const p of [
    [e[0], e[1] - STD_HALF_H],
    [e[0], e[1] + STD_HALF_H],
    [e[0] - STD_HALF_W, e[1]],
    [e[0] + STD_HALF_W, e[1]],
  ] as Pt[]) {
    await expectInk(page, p);
  }
  await expectEmpty(page, e, 20);
  await expectEmpty(page, [e[0] - STD_HALF_W, e[1] - STD_HALF_H], 10);
});

test("AC-6: the eraser dragged across a line's middle removes the middle and leaves both ends", async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await choose(page, "Pen");
  await confirmed(page, () =>
    stroke(page, [
      [200, 500],
      [1400, 500],
    ]),
  );
  await expectInk(page, [800, 500]);

  await choose(page, "Eraser");
  await confirmed(page, () =>
    stroke(page, [
      [800, 300],
      [800, 700],
    ]),
  );

  await expectEmpty(page, [800, 500], 4);
  for (const p of [
    [220, 500],
    [500, 500],
    [1100, 500],
    [1380, 500],
  ] as Pt[])
    await expectInk(page, p);
});

test("AC-11: after a reload the board looks exactly as before", async ({ page, request }) => {
  await newBoard(page, request);
  await choose(page, "Green");
  await choose(page, "Pen");
  await confirmed(page, () =>
    stroke(page, [
      [150, 150],
      [500, 300],
      [900, 200],
    ]),
  );
  await choose(page, "Box");
  await confirmed(page, () =>
    stroke(page, [
      [300, 500],
      [700, 850],
    ]),
  );
  await choose(page, "Purple");
  await choose(page, "Circle");
  await confirmed(page, () =>
    stroke(page, [
      [900, 450],
      [1400, 900],
    ]),
  );
  await choose(page, "Eraser");
  await confirmed(page, () =>
    stroke(page, [
      [500, 400],
      [500, 950],
    ]),
  );

  const hash = await hashOf(page);
  const pixels = await digest(page);
  expect(await inked(page)).toBeGreaterThan(0);

  await reload(page, "Ada");

  await expect(board(page)).toHaveAttribute("data-sketch-hash", hash ?? "");
  await expect.poll(() => digest(page)).toBe(pixels);
});

test("AC-12: Clear then Cancel changes nothing; Clear then confirm empties the board for everyone", async ({
  page,
  request,
  browser,
}) => {
  const invite = await newBoard(page, request);
  await choose(page, "Pen");
  await confirmed(page, () =>
    stroke(page, [
      [200, 200],
      [1200, 800],
    ]),
  );

  const [otherContext] = await openContexts(browser, 1);
  if (!otherContext) throw new Error("could not open a second browser context");
  const other = await otherContext.newPage();
  try {
    await join(other, invite, "Linus");
    await openBoard(other);
    await expect(board(other)).toHaveAttribute("data-sketch-hash", (await hashOf(page)) ?? "");
    await expect.poll(() => inked(other)).toBeGreaterThan(0);

    const hash = await hashOf(page);
    const pixels = await digest(page);
    const clear = sketchTools(page).getByRole("button", { name: "Clear", exact: true });
    const dialog = page.getByRole("dialog", { name: "Clear the sketch?" });

    await clear.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(board(page)).toHaveAttribute("data-sketch-hash", hash ?? "");
    expect(await digest(page)).toBe(pixels);
    expect(await inked(other)).toBeGreaterThan(0);

    await clear.click();
    await dialog.getByRole("button", { name: "Clear for everyone" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => inked(page)).toBe(0);
    await expect.poll(() => inked(other)).toBe(0);
  } finally {
    await otherContext.close();
  }
});

test("AC-15: after drawing and reloading, Undo is disabled and the line remains", async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  const undo = () => sketchTools(page).getByRole("button", { name: "Undo", exact: true });
  await expect(undo()).toBeDisabled();
  await expect(undo()).toHaveAccessibleDescription("Nothing of yours to undo in this visit.");

  await choose(page, "Pen");
  await confirmed(page, () =>
    stroke(page, [
      [300, 300],
      [1300, 300],
    ]),
  );
  await expect(undo()).toBeEnabled();

  await reload(page, "Ada");

  await expect(undo()).toBeDisabled();
  await expect(undo()).toHaveAccessibleDescription("Nothing of yours to undo in this visit.");
  for (const p of [
    [300, 300],
    [800, 300],
    [1300, 300],
  ] as Pt[])
    await expectInk(page, p);
});
