// Spec 022 task 17: the sketch board shared between participants of one coding session, end to
// end against the kept stack (FR-2, FR-3, FR-8–FR-10, FR-13, FR-14, NFR-1). Each participant
// is a separate browser context that joins by the invite link. What a board shows is read
// from its canvas pixels (`getImageData` at board coordinates); whether two boards are the
// same is their test-only `data-sketch-hash` (a hash of the confirmed actions on show).
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { appPathname, appUrl, createSession, expect, test } from "./fixtures";

/** The board's fixed logical size (plan, Board shape). */
const BOARD_W = 1600;
const BOARD_H = 1000;
/** Alpha at or above this near a point means something is drawn there; below BLANK, nothing. */
const INK = 64;
const BLANK = 16;
/** NFR-1: how soon a finished action reaches the others. */
const LATENCY_MS = 500;

/** A point in board units. */
type Pt = [x: number, y: number];

// --- Joining and the board ------------------------------------------------------------------

async function join(page: Page, invite: string, name: string): Promise<void> {
  if (appPathname(page.url()) !== `/s/${invite}`) await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/** One browser context per name, each joined to the session; `options` per participant. */
async function participants(
  browser: Browser,
  invite: string,
  names: string[],
  options: BrowserContextOptions[] = [],
): Promise<Page[]> {
  const contexts = await Promise.all(names.map((_, i) => browser.newContext(options[i] ?? {})));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const [i, page] of pages.entries()) await join(page, invite, names[i] ?? "");
  return pages;
}

async function closeAll(pages: Page[]): Promise<void> {
  await Promise.all(pages.map((p) => p.context().close()));
}

const toggle = (page: Page) => page.getByRole("button", { name: "Sketch", exact: true });
const sketch = (page: Page) => page.getByRole("region", { name: "Sketch", exact: true });
const board = (page: Page) => page.getByRole("img", { name: "Sketch board", exact: true });

async function openSketch(page: Page): Promise<void> {
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(board(page)).toBeVisible();
}

/** A tool or colour button, selected or not ("Pen" / "Pen, selected"). */
const control = (page: Page, name: string) =>
  sketch(page).getByRole("button", { name: new RegExp(`^${name}(, selected)?$`) });

async function choose(page: Page, ...names: string[]): Promise<void> {
  for (const name of names) {
    await control(page, name).click();
    await expect(control(page, name)).toHaveAttribute("aria-pressed", "true");
  }
}

const undoButton = (page: Page) => sketch(page).getByRole("button", { name: "Undo", exact: true });

// --- Drawing --------------------------------------------------------------------------------

/** Board units → page pixels on this participant's board. */
async function toPage(page: Page, [x, y]: Pt): Promise<Pt> {
  const box = await board(page).boundingBox();
  if (!box) throw new Error("the sketch board has no box");
  return [box.x + (x / BOARD_W) * box.width, box.y + (y / BOARD_H) * box.height];
}

/** Presses at the first point, moves through the rest, releases at the last. */
async function drag(page: Page, points: Pt[]): Promise<void> {
  await board(page).scrollIntoViewIfNeeded();
  const [first, ...rest] = await Promise.all(points.map((p) => toPage(page, p)));
  if (!first) return;
  await page.mouse.move(...first);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

/** A straight stroke from `a` to `b` through its midpoint (pen or eraser). */
const stroke = (page: Page, a: Pt, b: Pt) =>
  drag(page, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b]);

/** A box or circle with opposite corners `a` and `b`. */
const shape = (page: Page, a: Pt, b: Pt) => drag(page, [a, b]);

// --- Reading the board ----------------------------------------------------------------------

/** The bit of a canvas element read here (this package's tsconfig has no DOM lib). */
type Canvas = {
  width: number;
  getContext(kind: "2d"): {
    getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
  };
};

/** The highest alpha within `r` board units of `p` on this participant's canvas. */
async function inkNear(page: Page, [x, y]: Pt, r = 8): Promise<number> {
  return board(page).evaluate(
    (el, [bx, by, br, w]) => {
      const canvas = el as unknown as Canvas;
      const ctx = canvas.getContext("2d");
      const s = canvas.width / w;
      const x0 = Math.max(0, Math.floor((bx - br) * s));
      const y0 = Math.max(0, Math.floor((by - br) * s));
      const size = Math.max(1, Math.ceil(2 * br * s));
      const data = ctx.getImageData(x0, y0, size, size).data;
      let max = 0;
      for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i] ?? 0);
      return max;
    },
    [x, y, r, BOARD_W] as const,
  );
}

async function expectInk(pages: Page[], ...points: Pt[]): Promise<void> {
  for (const page of pages)
    for (const p of points)
      await expect.poll(() => inkNear(page, p), { message: `ink at ${p}` }).toBeGreaterThan(INK);
}

async function expectBlank(pages: Page[], ...points: Pt[]): Promise<void> {
  for (const page of pages)
    for (const p of points)
      await expect.poll(() => inkNear(page, p), { message: `blank at ${p}` }).toBeLessThan(BLANK);
}

const hashOf = async (page: Page) => (await board(page).getAttribute("data-sketch-hash")) ?? "";

/** Waits until every participant's board shows the same confirmed actions. */
async function expectSameBoard(pages: Page[]): Promise<void> {
  await expect
    .poll(async () => new Set(await Promise.all(pages.map(hashOf))).size, {
      message: "boards identical",
    })
    .toBe(1);
}

/** Runs `act` and waits until it has reached every board, and all boards agree. */
async function everywhere(pages: Page[], act: () => Promise<void>): Promise<void> {
  const before = await Promise.all(pages.map(hashOf));
  await act();
  for (const [i, page] of pages.entries())
    await expect(board(page)).not.toHaveAttribute("data-sketch-hash", before[i] ?? "");
  await expectSameBoard(pages);
}

// --- Tests ----------------------------------------------------------------------------------

test("AC-2: the board opens beside the editor, stays open on reload, and only for its opener", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const wide = { viewport: { width: 1280, height: 800 } };
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"], [wide, wide]);
  if (!ana || !ben) throw new Error("no participants");
  try {
    await openSketch(ana);
    await expect(board(ana)).toBeInViewport();
    await expect(ana.locator(".cm-content")).toBeInViewport();
    await expect(ana).toHaveURL(new RegExp(`/s/${invite}$`));

    await ana.reload();
    await join(ana, invite, "Ana");
    await expect(toggle(ana)).toHaveAttribute("aria-pressed", "true");
    await expect(board(ana)).toBeInViewport();
    await expect(ana.locator(".cm-content")).toBeInViewport();

    await expect(toggle(ben)).toHaveAttribute("aria-pressed", "false");
    await expect(sketch(ben)).toHaveCount(0);
  } finally {
    await closeAll([ana, ben]);
  }
});

test("AC-3: a box in the top-left quarter on 1920 px is in the top-left quarter on 1024 px", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ana, ben] = await participants(
    browser,
    invite,
    ["Ana", "Ben"],
    [{ viewport: { width: 1920, height: 1080 } }, { viewport: { width: 1024, height: 768 } }],
  );
  if (!ana || !ben) throw new Error("no participants");
  try {
    await openSketch(ana);
    await openSketch(ben);
    // The two boards are drawn at different sizes, so this is about scaling, not a copy.
    const [wideW, narrowW] = await Promise.all(
      [ana, ben].map(async (p) => (await board(p).boundingBox())?.width ?? 0),
    );
    expect(narrowW ?? 0).toBeGreaterThan(0);
    expect(narrowW).toBeLessThan(wideW ?? 0);
    await choose(ana, "Box");
    await everywhere([ana, ben], () => shape(ana, [100, 100], [600, 400]));

    // Its four sides, inside the top-left quarter (x < 800, y < 500); nothing elsewhere.
    await expectInk([ana, ben], [350, 100], [100, 250], [600, 250], [350, 400]);
    await expectBlank([ana, ben], [350, 250], [1200, 250], [350, 750], [1200, 750]);
  } finally {
    await closeAll([ana, ben]);
  }
});

test("AC-8: tool and colour are each participant's own", async ({ browser, request }) => {
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");
  try {
    await openSketch(ana);
    await openSketch(ben);
    await choose(ana, "Eraser", "Red");
    await choose(ben, "Pen", "Green");

    for (const name of ["Eraser", "Red"]) {
      await expect(control(ana, name)).toHaveAttribute("aria-pressed", "true");
      await expect(control(ana, name)).toHaveAccessibleName(`${name}, selected`);
      await expect(control(ben, name)).toHaveAttribute("aria-pressed", "false");
    }
    for (const name of ["Pen", "Green"]) {
      await expect(control(ben, name)).toHaveAttribute("aria-pressed", "true");
      await expect(control(ben, name)).toHaveAccessibleName(`${name}, selected`);
      await expect(control(ana, name)).toHaveAttribute("aria-pressed", "false");
    }
  } finally {
    await closeAll([ana, ben]);
  }
});

const NOW = "performance.timeOrigin + performance.now()";

/** Drawer's page: when the pointer is released on the board (the circle is finished). */
const RECORD_UP = `(() => {
  window.__up = null;
  document.querySelector('[data-sketch-hash]').addEventListener(
    "pointerup", () => { window.__up = ${NOW}; }, { capture: true, once: true });
})()`;

/** Viewer's page: when its board first shows a different set of confirmed actions. */
const RECORD_SHOWN = `(() => {
  window.__shown = null;
  const canvas = document.querySelector('[data-sketch-hash]');
  new MutationObserver((_, observer) => {
    window.__shown = ${NOW};
    observer.disconnect();
  }).observe(canvas, { attributes: true, attributeFilter: ["data-sketch-hash"] });
})()`;

test("AC-9: a finished circle reaches the other participant within 500 ms, without reloading", async ({
  browser,
  request,
}) => {
  test.setTimeout(40_000);
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");
  try {
    await openSketch(ana);
    await openSketch(ben);
    await choose(ana, "Circle");

    const circles: [Pt, Pt][] = [
      [
        [100, 100],
        [500, 400],
      ],
      [
        [600, 100],
        [1000, 400],
      ],
      [
        [1100, 100],
        [1500, 400],
      ],
    ];
    const latencies: number[] = [];
    for (const [a, b] of circles) {
      await ana.evaluate(RECORD_UP);
      await ben.evaluate(RECORD_SHOWN);
      await shape(ana, a, b);
      await ben.waitForFunction("window.__shown !== null", null, { polling: "raf" });
      const up = (await ana.evaluate("window.__up")) as number;
      latencies.push(((await ben.evaluate("window.__shown")) as number) - up);
      // Its leftmost point, on Ben's board.
      await expectInk([ben], [a[0], (a[1] + b[1]) / 2]);
    }
    console.log(`AC-9: circle reached the other board in ${latencies.join(", ")} ms`);
    for (const ms of latencies) expect(ms).toBeLessThanOrEqual(LATENCY_MS);
    await expectSameBoard([ana, ben]);
  } finally {
    await closeAll([ana, ben]);
  }
});

test("AC-10: three participants draw at the same moment and end up with identical boards", async ({
  browser,
  request,
}) => {
  test.setTimeout(40_000);
  const invite = await createSession(request);
  const pages = await participants(browser, invite, ["Ana", "Ben", "Cleo"]);
  try {
    for (const page of pages) await openSketch(page);
    const empty = await hashOf(pages[0] as Page);

    const lines: [Pt, Pt][] = [
      [
        [200, 200],
        [1400, 200],
      ],
      [
        [200, 500],
        [1400, 500],
      ],
      [
        [200, 800],
        [1400, 800],
      ],
    ];
    await Promise.all(pages.map((page, i) => stroke(page, ...(lines[i] as [Pt, Pt]))));

    const middles = lines.map(([a, b]): Pt => [(a[0] + b[0]) / 2, a[1]]);
    await expectInk(pages, ...middles);
    await expectSameBoard(pages);
    expect(await hashOf(pages[0] as Page)).not.toBe(empty);
  } finally {
    await closeAll(pages);
  }
});

test("AC-13: Undo and Ctrl/Cmd+Z reverse only your own latest action, for everyone", async ({
  browser,
  request,
}) => {
  test.setTimeout(40_000);
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");
  const both = [ana, ben];
  try {
    await openSketch(ana);
    await openSketch(ben);
    const line: Pt = [450, 200];
    const boxTop: Pt = [1100, 100];
    const circleLeft: Pt = [200, 700];

    await everywhere(both, () => stroke(ana, [200, 200], [700, 200]));
    await choose(ana, "Box");
    await everywhere(both, () => shape(ana, [900, 100], [1300, 400]));
    await choose(ben, "Circle");
    await everywhere(both, () => shape(ben, [200, 500], [600, 900]));
    await expectInk(both, line, boxTop, circleLeft);

    await everywhere(both, () => undoButton(ana).click());
    await expectBlank(both, boxTop);
    await expectInk(both, line, circleLeft);

    await everywhere(both, () => undoButton(ana).click());
    await expectBlank(both, line, boxTop);
    await expectInk(both, circleLeft);
    // Ben's circle is not Ana's to undo.
    await expect(undoButton(ana)).toBeDisabled();

    // Ctrl/Cmd+Z with the board focused does what Undo does.
    await choose(ana, "Pen");
    const second: Pt = [450, 300];
    await everywhere(both, () => stroke(ana, [200, 300], [700, 300]));
    await expectInk(both, second);
    await everywhere(both, async () => {
      await board(ana).focus();
      await ana.keyboard.press("ControlOrMeta+z");
    });
    await expectBlank(both, second);
    await expectInk(both, circleLeft);

    // With nothing of Ana's left, it leaves Ben's circle alone.
    const settled = await hashOf(ben);
    await board(ana).focus();
    await ana.keyboard.press("ControlOrMeta+z");
    await expect(undoButton(ana)).toBeDisabled();
    await expectInk(both, circleLeft);
    expect(await hashOf(ben)).toBe(settled);
  } finally {
    await closeAll(both);
  }
});

test("AC-14: undo removes what is left of a line, restores what an erase or a clear removed", async ({
  browser,
  request,
}) => {
  test.setTimeout(40_000);
  const invite = await createSession(request);
  const [ana, ben] = await participants(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("no participants");
  const both = [ana, ben];
  try {
    await openSketch(ana);
    await openSketch(ben);

    // Ana's line, its right half rubbed out by Ben; Ana undoes the line: the rest goes too.
    const leftHalf: Pt = [400, 200];
    const rightHalf: Pt = [800, 200];
    await everywhere(both, () => stroke(ana, [200, 200], [1000, 200]));
    await choose(ben, "Eraser");
    await everywhere(both, () => stroke(ben, [600, 200], [1040, 200]));
    await expectBlank(both, rightHalf);
    await expectInk(both, leftHalf);
    await everywhere(both, () => undoButton(ana).click());
    await expectBlank(both, leftHalf, rightHalf);

    // Ben's box, its top side partly rubbed out by Ana; Ana undoes the erase: the box is whole.
    const boxTop: Pt = [1100, 400];
    const boxLeft: Pt = [900, 600];
    await choose(ben, "Box");
    await everywhere(both, () => shape(ben, [900, 400], [1300, 800]));
    await choose(ana, "Eraser");
    await everywhere(both, () => stroke(ana, [1100, 360], [1100, 440]));
    await expectBlank(both, boxTop);
    await expectInk(both, boxLeft);
    await everywhere(both, () => undoButton(ana).click());
    await expectInk(both, boxTop, boxLeft);

    // Ana clears the board, then undoes: the box returns for everyone.
    await everywhere(both, async () => {
      await sketch(ana).getByRole("button", { name: "Clear", exact: true }).click();
      await ana.getByRole("dialog", { name: "Clear the sketch?" }).getByRole("button", {
        name: "Clear for everyone",
      }).click();
    });
    await expectBlank(both, boxTop, boxLeft);
    await everywhere(both, () => undoButton(ana).click());
    await expectInk(both, boxTop, boxLeft);
  } finally {
    await closeAll(both);
  }
});
