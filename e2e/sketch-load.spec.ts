// Spec 022 AC-21 (NFR-2): five participants draw on one session's sketch board at once for
// 30 seconds. When it ends all five boards hold the same confirmed actions (equal
// `data-sketch-hash`), and every participant's own stroke was on their canvas before the
// server's echo of it arrived (the stroke is drawn locally, then kept as pending; plan
// "Own strokes feel instant").
//
// One session and one 30 s run carry every assertion (plan Constitution compliance 2), so
// the file costs about 30 s plus joining.
//
// The echo check runs in the page: an init script wraps WebSocket, notes each `sketch_add`
// the app sends, and listens for messages ahead of the app's own handler. When the echo
// (`sketch_added` with that client_id) arrives, it samples the canvas at the stroke's middle
// point before the app has seen the message. Participants draw short vertical pen strokes in
// their own band of the board, spaced so no stroke's sample can hit another stroke.
import type { Page } from "@playwright/test";
import { appUrl, createSession, expect, openContexts, test } from "./fixtures";

const PARTICIPANTS = 5;
const DRAW_MS = 30_000;
/** At most one stroke per this many ms per participant: continuous, but within the grid. */
const STROKE_EVERY_MS = 250;
const BOARD_W = 1600;
const BOARD_H = 1000;
/** Stroke grid inside each participant's band: columns STEP apart, two rows per band. */
const BAND_H = BOARD_H / PARTICIPANTS;
const STEP = 20;
const MARGIN = 20;
const COLUMNS = Math.floor((BOARD_W - 2 * MARGIN) / STEP);
const ROWS = 2;
const STROKE_H = 70;

/** Browser-side (a string: this package's tsconfig has no DOM lib). */
const WATCH_ECHOES = `() => {
  const sent = new Map();
  const log = { sent: 0, echoed: 0, drawnBeforeEcho: 0, missing: [], refused: [] };
  window.__sketchLoad = log;
  const Native = window.WebSocket;
  const sample = (points) => {
    const canvas = document.querySelector('canvas[aria-label="Sketch board"]');
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx || canvas.width === 0) return false;
    const n = Math.floor(points.length / 2);
    const mid = Math.floor(n / 2);
    const scale = canvas.width / ${BOARD_W};
    const x = Math.round(points[2 * mid] * scale);
    const y = Math.round(points[2 * mid + 1] * scale);
    const data = ctx.getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  };
  class Watched extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "sketch_refused") log.refused.push(msg.reason);
        if (msg.type !== "sketch_added") return;
        const points = sent.get(msg.action.client_id);
        if (!points) return;
        sent.delete(msg.action.client_id);
        log.echoed += 1;
        if (sample(points)) log.drawnBeforeEcho += 1;
        else log.missing.push(msg.action.client_id);
      });
    }
    send(data) {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "sketch_add") {
            sent.set(msg.client_id, msg.action.points);
            log.sent += 1;
          }
        } catch {}
      }
      return super.send(data);
    }
  }
  window.WebSocket = Watched;
}`;

type LoadLog = {
  sent: number;
  echoed: number;
  drawnBeforeEcho: number;
  missing: string[];
  refused: string[];
};

async function joinWithBoard(page: Page, invite: string, name: string): Promise<void> {
  await page.addInitScript(`(${WATCH_ECHOES})()`);
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
  await page.getByRole("button", { name: "Sketch" }).click();
  await expect(page.getByRole("img", { name: "Sketch board" })).toBeVisible();
}

/** Draws pen strokes in participant `p`'s band until `until` (a Date.now() time). */
async function drawUntil(page: Page, p: number, until: number): Promise<number> {
  const canvas = page.getByRole("img", { name: "Sketch board" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the sketch board has no box");
  const toClient = (x: number, y: number) => ({
    x: box.x + (x / BOARD_W) * box.width,
    y: box.y + (y / BOARD_H) * box.height,
  });
  let strokes = 0;
  while (Date.now() < until && strokes < COLUMNS * ROWS) {
    const started = Date.now();
    const column = strokes % COLUMNS;
    const row = Math.floor(strokes / COLUMNS);
    const x = MARGIN + column * STEP + STEP / 2;
    const top = p * BAND_H + 15 + row * (BAND_H / ROWS);
    const from = toClient(x, top);
    const to = toClient(x, top + STROKE_H);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    strokes += 1;
    const rest = STROKE_EVERY_MS - (Date.now() - started);
    if (rest > 0) await page.waitForTimeout(rest);
  }
  return strokes;
}

test("AC-21: five participants draw for 30 s; boards end identical, own strokes show before the echo", async ({
  browser,
  request,
}) => {
  test.setTimeout(DRAW_MS + 60_000);
  const startedAt = Date.now();
  const invite = await createSession(request);
  const contexts = await openContexts(browser, PARTICIPANTS);
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((page, i) => joinWithBoard(page, invite, `Drawer ${i + 1}`)));

    const until = Date.now() + DRAW_MS;
    const strokes = await Promise.all(pages.map((page, i) => drawUntil(page, i, until)));
    const total = strokes.reduce((a, b) => a + b, 0);

    // Every own stroke is echoed, and its pixels were on the canvas before the echo.
    for (const [i, page] of pages.entries()) {
      await expect
        .poll(async () => ((await page.evaluate("window.__sketchLoad")) as LoadLog).echoed, {
          timeout: 10_000,
        })
        .toBe(strokes[i]);
      const log = (await page.evaluate("window.__sketchLoad")) as LoadLog;
      expect(log.refused, `Drawer ${i + 1}: refusals`).toEqual([]);
      expect(log.sent, `Drawer ${i + 1}: strokes sent`).toBe(strokes[i]);
      expect(log.missing, `Drawer ${i + 1}: strokes not drawn before their echo`).toEqual([]);
      expect(log.drawnBeforeEcho).toBe(strokes[i]);
    }

    // All five boards hold the same confirmed actions.
    const hashes = () =>
      Promise.all(
        pages.map((page) =>
          page.getByRole("img", { name: "Sketch board" }).getAttribute("data-sketch-hash"),
        ),
      );
    await expect.poll(async () => new Set(await hashes()).size, { timeout: 10_000 }).toBe(1);

    console.log(
      `AC-21: ${total} strokes (${strokes.join(", ")}) by ${PARTICIPANTS} participants; ` +
        `test took ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
