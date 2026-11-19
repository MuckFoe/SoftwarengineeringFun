/// <reference lib="dom" />
// Spec 022 task 19: the sketch board read-only on a stale page (AC-16), with no dock or
// "Jump to anything" entry (AC-19), by keyboard and in the look matrix (AC-23): light and dark,
// 1024, 1920 and 390 px, reduced motion. Real browser, real stack.
import type { APIRequestContext, Page } from "@playwright/test";
import { expectReducedMotion } from "./audi/checks";
import type { Screen } from "./audi/matrix";
import { defineKeyboardSweep, defineSharedChecks } from "./audi/matrix-specs";
import { appUrl, createSession, expect, markStale, signIn, test, workerUser } from "./fixtures";

type Pt = [x: number, y: number];

const BOARD_W = 1600;
const BOARD_H = 1000;

const board = (page: Page) => page.getByRole("img", { name: "Sketch board", exact: true });
const sketchTools = (page: Page) => page.getByRole("toolbar", { name: "Sketch tools" });
const toggle = (page: Page) => page.getByRole("button", { name: "Sketch", exact: true });

/** Joins as a guest when asked for a name; a signed-in participant is let in directly. */
async function join(page: Page, invite: string, name = "Ada"): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  const nameField = page.getByLabel("Your name");
  const editor = page.locator(".cm-content");
  await expect(nameField.or(editor)).toBeVisible();
  if (await nameField.isVisible()) {
    await nameField.fill(name);
    await page.getByRole("button", { name: "Join" }).click();
  }
  await expect(editor).toContainText("pass");
}

/** Opens the board with the header toggle, unless this browser already has it open. */
async function openBoard(page: Page): Promise<void> {
  await expect(toggle(page)).toBeVisible();
  if ((await toggle(page).getAttribute("aria-pressed")) !== "true") await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
}

/** Board units → client pixels on the canvas named `name`. */
async function client(page: Page, [x, y]: Pt, name = "Sketch board"): Promise<Pt> {
  const box = await page.getByRole("img", { name, exact: true }).boundingBox();
  if (!box) throw new Error(`${name} not laid out`);
  return [box.x + (x / BOARD_W) * box.width, box.y + (y / BOARD_H) * box.height];
}

/** A mouse drag from `a` to `b` (board units) on the canvas named `name`. */
async function drag(page: Page, a: Pt, b: Pt, name = "Sketch board"): Promise<void> {
  await page.mouse.move(...(await client(page, a, name)));
  await page.mouse.down();
  const [bx, by] = await client(page, b, name);
  await page.mouse.move(bx, by, { steps: 10 });
  await page.mouse.up();
}

/** Draws a pen line and waits until the server has confirmed it (the seq hash changes). */
async function drawLine(page: Page, a: Pt = [300, 300], b: Pt = [1200, 700]): Promise<void> {
  await board(page).scrollIntoViewIfNeeded();
  const before = (await board(page).getAttribute("data-sketch-hash")) ?? "";
  await drag(page, a, b);
  await expect(board(page)).not.toHaveAttribute("data-sketch-hash", before);
}

// Browser-side script as a string, the canvas found by its hash attribute.
const INK_NEAR = `(([x, y, r]) => {
  const c = document.querySelector('canvas[data-sketch-hash]');
  const s = c.width / ${BOARD_W};
  const x0 = Math.max(0, Math.floor((x - r) * s)), y0 = Math.max(0, Math.floor((y - r) * s));
  const x1 = Math.min(c.width, Math.ceil((x + r) * s) + 1), y1 = Math.min(c.height, Math.ceil((y + r) * s) + 1);
  const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let a = 0;
  for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]);
  return a;
})`;
const INKED = `(() => {
  const c = document.querySelector('canvas[data-sketch-hash]');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
})`;
const inkNear = (page: Page, [x, y]: Pt, r = 6) =>
  page.evaluate(`${INK_NEAR}(${JSON.stringify([x, y, r])})`) as Promise<number>;
const inked = (page: Page) => page.evaluate(`${INKED}()`) as Promise<number>;

/** No animation or transition running on the page (constitution-ui 20; NFR-6). */
async function expectStill(page: Page): Promise<void> {
  await expectReducedMotion(page);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => a.playState === "running")
            .map((a) => (a instanceof CSSTransition ? `transition ${a.transitionProperty}` : "animation")),
        ),
      { message: "animations or transitions running under reduced motion" },
    )
    .toEqual([]);
}

/** The focused element's accessible-name source and whether it shows a focus ring. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0;
    const ring = outline || (s.boxShadow !== "none" && s.boxShadow !== "");
    return {
      name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
      pressed: el.getAttribute("aria-pressed"),
      inToolbar: el.closest('[role="toolbar"][aria-label="Sketch tools"]') !== null,
      ring,
    };
  });
}

// The look matrix entry (AC-23): the session window with the board open and drawn on, under
// reduced motion. Joined at 390 px, as a phone would; the shared checks then widen to 1024 px and
// 1920 px. (Joined at desktop width and then narrowed, the pinned inspector keeps its 320 px and
// leaves the editor and board a sliver: a session-window trait, not the board's.)
const SKETCH_OPEN: Screen = {
  name: "session window with sketch open",
  lowerBound: 1024,
  narrow: true,
  async open(page: Page, request: APIRequestContext) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await join(page, await createSession(request));
    await openBoard(page);
    await drawLine(page);
    await expectStill(page);
  },
};

defineSharedChecks([SKETCH_OPEN]);
defineKeyboardSweep([SKETCH_OPEN]);

test("AC-16: a stale session shows its drawn board read-only, with no tool, Clear or Undo", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const invite = await createSession(request);
  await join(page, invite);
  await openBoard(page);
  await drawLine(page, [300, 300], [1200, 700]);

  markStale(invite);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Stale session" })).toBeVisible();
  await openBoard(page);

  const readOnly = page.getByRole("img", { name: "Sketch board (read-only)", exact: true });
  await expect(readOnly).toBeVisible();
  // The drawing is shown: ink along the line, none far from it.
  for (const p of [
    [300, 300],
    [750, 500],
    [1200, 700],
  ] as Pt[]) {
    await expect.poll(() => inkNear(page, p), { message: `ink at ${p}` }).toBeGreaterThan(128);
  }
  expect(await inkNear(page, [1300, 200], 20)).toBe(0);

  const sketch = page.getByRole("region", { name: "Sketch" });
  await expect(sketchTools(page)).toHaveCount(0);
  for (const name of [/^Pen/, /^Box/, /^Circle/, /^Eraser/, /^Ink/, /^Red/, /^Undo/, /^Clear/]) {
    await expect(sketch.getByRole("button", { name })).toHaveCount(0);
  }

  // A drag on the read-only board draws nothing.
  const before = await inked(page);
  await drag(page, [200, 800], [1400, 850], "Sketch board (read-only)");
  await page.waitForTimeout(300);
  expect(await inked(page)).toBe(before);
});

test("AC-19: the dock and 'Jump to anything' have no sketch entry", async ({
  page,
  request,
  keycloak,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const user = workerUser(keycloak.users);
  await signIn(page, user.username, user.password);
  const invite = await createSession(request);
  await join(page, invite);
  await openBoard(page);
  await drawLine(page);

  await page.goto(appUrl("/"));
  const dock = page.getByRole("navigation", { name: "Areas" });
  await expect(dock.getByRole("link").first()).toBeVisible();
  await expect(dock.getByText(/sketch/i)).toHaveCount(0);
  await expect(dock.getByRole("link", { name: /sketch/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Jump to anything" }).click();
  const jump = page.getByRole("dialog", { name: "Jump to anything" });
  const input = jump.getByRole("combobox", { name: "Jump to" });
  // The session with the drawn board is listed by its problem, as before.
  await input.fill("Sum Two Numbers");
  await expect(jump.getByRole("option").first()).toBeVisible();
  await input.fill("sketch");
  await expect(jump.getByRole("option")).toHaveCount(0);
  await input.fill("Sketch board");
  await expect(jump.getByRole("option")).toHaveCount(0);
});

test("AC-23: by keyboard every tool, colour, Undo and Clear is reachable in order, ringed, with its state in its name", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await join(page, await createSession(request));
  await openBoard(page);
  await drawLine(page); // Undo is enabled once there is something of one's own to undo

  // The board's one tab stop follows its resize handle.
  await page.getByRole("separator", { name: "Resize sketch" }).focus();
  await page.keyboard.press("Tab");

  const order = [
    "Pen, selected",
    "Box",
    "Circle",
    "Eraser",
    "Ink, selected",
    "Red",
    "Orange",
    "Yellow",
    "Green",
    "Blue",
    "Purple",
    "Pink",
    "Undo",
    "Clear",
  ];
  const seen: string[] = [];
  for (let i = 0; i < order.length; i++) {
    if (i > 0) await page.keyboard.press("ArrowRight");
    const f = await focused(page);
    expect(f?.inToolbar, `stop ${i + 1} is in the sketch toolbar`).toBe(true);
    expect(f?.ring, `${f?.name} shows a focus ring`).toBe(true);
    seen.push(f?.name ?? "");
  }
  expect(seen).toEqual(order);
  // Tools and colours are toggles: their state is in aria-pressed as well as the name.
  await expect(sketchTools(page).getByRole("button", { name: "Pen, selected" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sketchTools(page).getByRole("button", { name: "Red", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Arrows wrap; the toolbar is one tab stop, the canvas the next.
  await page.keyboard.press("ArrowRight");
  expect((await focused(page))?.name).toBe("Pen, selected");
  await page.keyboard.press("Tab");
  await expect(board(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect((await focused(page))?.name).toBe("Pen, selected");

  // Operable: Enter picks Box, Space picks Red; the names follow.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect((await focused(page))?.name).toBe("Box, selected");
  await expect(sketchTools(page).getByRole("button", { name: "Pen", exact: true })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  expect((await focused(page))?.name).toBe("Red");
  await page.keyboard.press("Space");
  expect((await focused(page))?.name).toBe("Red, selected");
  await expect(sketchTools(page).getByRole("button", { name: "Ink", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Clear by keyboard asks first, Cancel focused; Escape keeps the board.
  await page.keyboard.press("End");
  expect((await focused(page))?.name).toBe("Clear");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Clear the sketch?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await inked(page)).toBeGreaterThan(0);
});

test.describe("AC-23: dark, reduced motion, 390 px", () => {
  test.use({ colorScheme: "dark", reducedMotion: "reduce", viewport: { width: 390, height: 800 } });

  test("the board is reachable and usable without horizontal overflow", async ({ page, request }) => {
    await join(page, await createSession(request));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
      .toBe("dark");
    await openBoard(page);
    await board(page).scrollIntoViewIfNeeded();
    await expect(board(page)).toBeVisible();
    await expect(sketchTools(page)).toBeVisible();

    // Every control on screen, inside the window.
    for (const button of await sketchTools(page).getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box, "toolbar button laid out").not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
      }
    }
    const canvas = await board(page).boundingBox();
    expect(canvas && canvas.x >= 0 && canvas.x + canvas.width <= 390).toBe(true);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

    // Usable: a line drawn here reaches the server; Undo takes it back.
    await sketchTools(page).getByRole("button", { name: "Green", exact: true }).click();
    await board(page).scrollIntoViewIfNeeded();
    await drawLine(page, [200, 200], [1400, 800]);
    expect(await inked(page)).toBeGreaterThan(0);
    await expectStill(page);
    await sketchTools(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => inked(page)).toBe(0);
  });
});
