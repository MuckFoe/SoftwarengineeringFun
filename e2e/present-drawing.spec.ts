// Spec 013 task 30: drawing over a presentation end to end (AC-18 to AC-23, AC-20b). Ana starts
// a session from the library and hosts; Ben, Cleo and Dana join by the invite link in their
// own browsers. Strokes are the overlay's <polyline>s; what the presentation itself received
// (selection, hover, clicks) is read from inside the sandboxed frame.
import type { Browser, BrowserContext, Frame, Page } from "@playwright/test";
import { appPathname, appUrl, expect, signIn, sql, test } from "./fixtures";
import type { KeycloakState } from "./global-setup";

const RUN = Date.now().toString(36);
const DECK_TITLE = `Drawing deck ${RUN}`;
const PAGE_TITLE = `Drawing page ${RUN}`;
const TOPIC = "Drawing";

const TEXT = "Routers read each header and forward the packet one hop closer to where it is going.";

/**
 * Four `data-slide` slides, each a heading and a paragraph with a link in it. Hovering the
 * link turns it red; clicking it counts in `body[data-clicks]` (and doesn't navigate).
 */
const DECK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Deck</title>
<style>
  body { margin: 0; font: 22px/1.6 sans-serif; }
  [data-slide] { padding: 40px; }
  a { color: rgb(0, 0, 238); }
  a:hover { color: rgb(255, 0, 0); }
</style></head>
<body>
${[1, 2, 3, 4]
  .map(
    (n) =>
      `  <div data-slide><h1>Slide ${n}</h1><p class="text">${TEXT} ${TEXT}</p>` +
      `<p><a class="link" href="#">A link on slide ${n}</a></p></div>`,
  )
  .join("\n")}
<script>
  let clicks = 0;
  for (const a of document.querySelectorAll("a.link")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      clicks += 1;
      document.body.dataset.clicks = String(clicks);
    });
  }
</script>
</body>
</html>`;

const LOREM =
  "Packets travel through routers that read each header and forward it one hop closer. ";

/** A long single page: five headings, each followed by a screenful of text and more. */
const LONG_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Page</title>
<style>
  body { margin: 0 24px; font: 18px/1.6 sans-serif; }
  h2 { margin: 48px 0; display: inline-block; padding: 0 8px; }
</style></head>
<body>
${[1, 2, 3, 4, 5]
  .map((n) => `  <div><h2 id="h${n}">Heading ${n}</h2></div>\n  <p>${LOREM.repeat(60)}</p>`)
  .join("\n")}
</body>
</html>`;

// --- Library -------------------------------------------------------------------------------

let library: Promise<void> | null = null;

/** Adds the two presentations once per run, as editor1. */
function ensureLibrary(browser: Browser, keycloak: KeycloakState): Promise<void> {
  library ??= (async () => {
    const editor = keycloak.users.editor1;
    if (!editor) throw new Error("no keycloak test user 'editor1'");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await signIn(page, editor.username, editor.password);
      for (const [title, html] of [
        [DECK_TITLE, DECK],
        [PAGE_TITLE, LONG_PAGE],
      ] as const) {
        const query = `title=${encodeURIComponent(title)}&topic=${encodeURIComponent(TOPIC)}`;
        const added = await context.request.post(appUrl(`/api/present/presentations?${query}`), {
          data: html,
          headers: { "content-type": "text/html" },
        });
        expect(added.status(), await added.text()).toBe(201);
      }
    } finally {
      await context.close();
    }
  })();
  return library;
}

// --- Session helpers -------------------------------------------------------------------------

async function newContext(browser: Browser, contexts: BrowserContext[]): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(context);
  return context;
}

async function newPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  return (await newContext(browser, contexts)).newPage();
}

const participants = (page: Page) => page.getByRole("list", { name: "Participants" });

async function joinAs(page: Page, name: string): Promise<void> {
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(participants(page)).toContainText(new RegExp(`${name}( \\(host\\))? \\(you\\)`));
}

/** Ana starts a session on `title` from the library; returns the invite link. */
async function startFromLibrary(page: Page, title: string): Promise<string> {
  await page.goto(appUrl("/present"));
  await page.getByRole("button", { name: `Start session: ${title}` }).click();
  await page.waitForURL((url) => /^\/present\/s\/[\w-]+$/.test(appPathname(url)));
  const link = page.url();
  await joinAs(page, "Ana");
  await expect(participants(page)).toContainText("Ana (host) (you)");
  return link;
}

async function openLink(page: Page, link: string, name: string): Promise<void> {
  await page.goto(link);
  await joinAs(page, name);
}

const iframe = (page: Page) => page.locator("iframe[sandbox]");
const frameView = (page: Page) => page.frameLocator("iframe[sandbox]");
const strokes = (page: Page) => page.locator('[data-testid="present-overlay"] polyline');
const drawButton = (page: Page) => page.getByRole("button", { name: "Draw", exact: true });
const clearButton = (page: Page) => page.getByRole("button", { name: "Clear drawings" });

async function presentationFrame(page: Page): Promise<Frame> {
  const handle = await iframe(page).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("no presentation frame");
  return frame;
}

/** `page` shows slide `n` (1-based) of four, in the frame and in the toolbar. */
async function expectSlide(page: Page, n: number): Promise<void> {
  const view = frameView(page);
  for (let i = 1; i <= 4; i++) {
    const heading = view.getByRole("heading", { name: `Slide ${i}`, exact: true });
    if (i === n) await expect(heading).toBeVisible();
    else await expect(heading).toBeHidden();
  }
  await expect(page.getByText(`${n} / 4`, { exact: true })).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await frameView(page).locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
}

async function toggleDraw(page: Page, on: boolean): Promise<void> {
  await drawButton(page).click();
  await expect(drawButton(page)).toHaveAttribute("aria-pressed", String(on));
}

/** Drags the mouse along `points` (page coordinates) with the left button held. */
async function drag(page: Page, points: [number, number][]): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  await page.mouse.move(...first);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p[0], p[1], { steps: 3 });
  await page.mouse.up();
}

/** A horizontal line across the middle of the box, from 10 % to 90 % of its width. */
function across(box: Box): [number, number][] {
  const y = box.y + box.height / 2;
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => [box.x + box.width * f, y]);
}

/** A closed ellipse `margin` px outside the box, starting at its left. */
function around(box: Box, margin: number): [number, number][] {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2 + margin;
  const ry = box.height / 2 + margin;
  const points: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI + (i / 24) * 2 * Math.PI;
    points.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return points;
}

/** The colours of the strokes `page` shows, in drawing order. */
async function strokeColours(page: Page): Promise<string[]> {
  return strokes(page).evaluateAll((els) => els.map((el) => el.getAttribute("stroke") ?? ""));
}

/** Stroke `i`'s box relative to the presentation frame's box. */
async function strokeInFrame(page: Page, i: number): Promise<Box> {
  const line = await strokes(page).nth(i).boundingBox();
  const frame = await iframe(page).boundingBox();
  if (!line || !frame) throw new Error("no stroke or frame box");
  return { x: line.x - frame.x, y: line.y - frame.y, width: line.width, height: line.height };
}

/** Stroke `i` of `page` surrounds the element `selector` of its frame. */
async function expectStrokeAround(page: Page, selector: string, i = 0): Promise<void> {
  await expect
    .poll(async () => {
      const line = await strokes(page).nth(i).boundingBox();
      const target = await frameView(page).locator(selector).boundingBox();
      if (!line || !target) return false;
      return (
        line.x < target.x &&
        line.y < target.y &&
        line.x + line.width > target.x + target.width &&
        line.y + line.height > target.y + target.height
      );
    })
    .toBe(true);
}

/** Records every WebSocket message `page` sends (or receives) from now on. */
function recordFrames(page: Page, direction: "framesent" | "framereceived"): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => {
    const keep = (frame: { payload: string | Buffer }) => {
      if (typeof frame.payload === "string") frames.push(frame.payload);
    };
    if (direction === "framesent") ws.on("framesent", keep);
    else ws.on("framereceived", keep);
  });
  return frames;
}

function ofType(frames: string[], type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of frames) {
    try {
      const msg = JSON.parse(p) as Record<string, unknown>;
      if (msg.type === type) out.push(msg);
    } catch {
      // not JSON
    }
  }
  return out;
}

// Browser-side (strings: this package's tsconfig has no DOM lib). All pages run in one
// browser, so `performance.timeOrigin + performance.now()` is a shared clock (as in
// latency.spec.ts and present-follow.spec.ts).
const NOW = "performance.timeOrigin + performance.now()";

/** Drawer's page: when the pointer goes down on the overlay. */
const RECORD_DOWN = `(() => {
  window.__down = null;
  document.querySelector('[data-testid="present-overlay"]').addEventListener(
    "pointerdown", () => { window.__down = ${NOW}; }, { capture: true, once: true });
})()`;

/** Viewer's page: when it first shows `n` strokes. */
const recordShown = (n: number) => `(() => {
  window.__shown = null;
  const overlay = document.querySelector('[data-testid="present-overlay"]');
  const check = () => {
    if (window.__shown === null && overlay.querySelectorAll("polyline").length >= ${n}) {
      window.__shown = ${NOW};
    }
  };
  new MutationObserver(check).observe(overlay, { subtree: true, childList: true, attributes: true });
})()`;

/**
 * `drawer` draws along `points`; returns how long until each viewer first shows `count`
 * strokes, from the drawer's pointer-down.
 */
async function timedStroke(
  drawer: Page,
  viewers: Page[],
  points: [number, number][],
  count: number,
): Promise<number[]> {
  await drawer.evaluate(RECORD_DOWN);
  for (const v of viewers) await v.evaluate(recordShown(count));
  await drag(drawer, points);
  const down = (await drawer.evaluate("window.__down")) as number;
  const latencies: number[] = [];
  for (const v of viewers) {
    await v.waitForFunction("window.__shown !== null", null, { polling: "raf" });
    latencies.push(((await v.evaluate("window.__shown")) as number) - down);
  }
  return latencies;
}

async function closeAll(contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map((c) => c.close()));
}

// --- Tests ---------------------------------------------------------------------------------

test("AC-18–AC-23: drawing on slides, live for everyone, cleared, and never kept", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const anaContext = await newContext(browser, contexts);
    const ana = await anaContext.newPage();
    const link = await startFromLibrary(ana, DECK_TITLE);
    await ana.getByRole("button", { name: "Next slide" }).click();
    await expectSlide(ana, 2);

    const ben = await newPage(browser, contexts);
    const benSent = recordFrames(ben, "framesent");
    await openLink(ben, link, "Ben");
    const cleo = await newPage(browser, contexts);
    await openLink(cleo, link, "Cleo");
    for (const p of [ben, cleo]) await expectSlide(p, 2);
    const benFrame = await presentationFrame(ben);

    // AC-18: Ben turns Draw on, drags across the text: a stroke, nothing selected or clicked
    // in the presentation; Ana's tool stays off.
    await toggleDraw(ben, true);
    await expect(drawButton(ana)).toHaveAttribute("aria-pressed", "false");
    await expect(drawButton(cleo)).toHaveAttribute("aria-pressed", "false");
    await drag(ben, across(await boxOf(ben, "[data-sdd-current] .text")));
    // A drag that starts and ends on the link would be a click on it, were it to get through.
    await drag(ben, across(await boxOf(ben, "[data-sdd-current] .link")));
    await expect(strokes(ben)).toHaveCount(2);
    expect(await benFrame.evaluate("getSelection().toString()")).toBe("");
    expect(await benFrame.evaluate("document.body.dataset.clicks ?? null")).toBeNull();
    for (const p of [ana, cleo]) await expect(strokes(p)).toHaveCount(2);
    // Ana's pointer still reaches her presentation: her overlay doesn't take the pointer.
    await expect(ana.getByTestId("present-overlay")).not.toHaveAttribute("data-drawing");

    // AC-18: Draw off again: hover and click reach the link, a drag selects text.
    await toggleDraw(ben, false);
    const linkBox = await boxOf(ben, "[data-sdd-current] .link");
    await ben.mouse.move(...centre(linkBox));
    await expect
      .poll(() =>
        benFrame.evaluate(
          `getComputedStyle(document.querySelector("[data-sdd-current] .link")).color`,
        ),
      )
      .toBe("rgb(255, 0, 0)");
    await ben.mouse.click(...centre(linkBox));
    await expect.poll(() => benFrame.evaluate("document.body.dataset.clicks ?? null")).toBe("1");
    // Along the first line of the paragraph (its vertical middle can fall exactly between two
    // wrapped lines, where Chrome starts no selection).
    const textBox = await boxOf(ben, "[data-sdd-current] .text");
    await drag(ben, across({ ...textBox, height: textBox.height / 2 }));
    expect(
      ((await benFrame.evaluate("getSelection().toString()")) as string).length,
    ).toBeGreaterThan(10);
    await expect(strokes(ben)).toHaveCount(2); // no stroke while Draw is off
    await benFrame.evaluate("getSelection().removeAllRanges()");

    // AC-19: Ben and Cleo each draw; everyone sees both within 500 ms, in two colours, on the
    // same content.
    await toggleDraw(ben, true);
    await toggleDraw(cleo, true);
    const heading = await boxOf(ben, "[data-sdd-current] h1");
    const benLatency = await timedStroke(ben, [ana, cleo], around(heading, 12), 3);
    const text = await boxOf(cleo, "[data-sdd-current] .text");
    const cleoLatency = await timedStroke(
      cleo,
      [ana, ben],
      across({ ...text, y: text.y + text.height / 4, height: 0 }),
      4,
    );
    console.log(`AC-19: Ben's stroke ${benLatency} ms, Cleo's ${cleoLatency} ms`);
    for (const ms of [...benLatency, ...cleoLatency]) expect(ms).toBeLessThanOrEqual(500);
    for (const p of [ana, ben, cleo]) await expect(strokes(p)).toHaveCount(4);
    const colours = await strokeColours(ana);
    expect(new Set(colours.slice(0, 3)).size).toBe(1); // all Ben's
    expect(colours[3]).not.toBe(colours[0]); // Cleo's
    expect(await strokeColours(ben)).toEqual(colours);
    expect(await strokeColours(cleo)).toEqual(colours);
    for (let i = 0; i < 4; i++) {
      const at = await strokeInFrame(ana, i);
      for (const p of [ben, cleo]) {
        const there = await strokeInFrame(p, i);
        expect(Math.abs(there.x - at.x)).toBeLessThan(3);
        expect(Math.abs(there.y - at.y)).toBeLessThan(3);
        expect(Math.abs(there.width - at.width)).toBeLessThan(3);
      }
    }
    for (const p of [ana, ben, cleo]) await expectStrokeAround(p, "[data-sdd-current] h1", 2);

    // AC-22: Dana joins and sees the strokes on screen, in the same colours.
    const dana = await newPage(browser, contexts);
    await openLink(dana, link, "Dana");
    await expectSlide(dana, 2);
    await expect(strokes(dana)).toHaveCount(4);
    expect(await strokeColours(dana)).toEqual(colours);

    // AC-21: Cleo clears drawings for everyone.
    await clearButton(cleo).click();
    for (const p of [ana, ben, cleo, dana]) await expect(strokes(p)).toHaveCount(0);

    // AC-20: a stroke on slide 2; Ana moves to slide 3: none; back to slide 2: still none.
    await drag(ben, across(await boxOf(ben, "[data-sdd-current] .text")));
    for (const p of [ana, ben, cleo, dana]) await expect(strokes(p)).toHaveCount(1);
    await ana.getByRole("button", { name: "Next slide" }).click();
    for (const p of [ana, ben, cleo, dana]) {
      await expectSlide(p, 3);
      await expect(strokes(p)).toHaveCount(0);
    }
    await ana.getByRole("button", { name: "Previous slide" }).click();
    for (const p of [ana, ben, cleo, dana]) await expectSlide(p, 2);
    await ana.waitForTimeout(500);
    for (const p of [ana, ben, cleo, dana]) await expect(strokes(p)).toHaveCount(0);

    // AC-23: strokes on screen, everyone leaves, Ana reopens: none, and none stored.
    await drag(ben, across(await boxOf(ben, "[data-sdd-current] .text")));
    await drag(cleo, across(await boxOf(cleo, "[data-sdd-current] h1")));
    for (const p of [ana, ben, cleo, dana]) await expect(strokes(p)).toHaveCount(2);
    const strokeIds = ofType(benSent, "stroke_start").map((m) => String(m.id));
    expect(strokeIds.length).toBeGreaterThanOrEqual(5);
    for (const p of [ben, cleo, dana, ana]) await p.close();
    await new Promise((resolve) => setTimeout(resolve, 500)); // the server sees them go

    const back = await anaContext.newPage();
    const backReceived = recordFrames(back, "framereceived");
    await back.goto(link);
    await expect(participants(back)).toContainText("Ana (host) (you)"); // rejoined, no prompt
    await expectSlide(back, 2);
    const welcome = ofType(backReceived, "welcome");
    expect(welcome).toHaveLength(1);
    expect(welcome[0]?.strokes).toEqual([]);
    await back.waitForTimeout(500);
    await expect(strokes(back)).toHaveCount(0);

    const tables = sql(
      "select table_name from information_schema.tables " +
        "where table_schema = 'public' and table_name like 'presentation%'",
    )
      .split("\n")
      .filter(Boolean);
    expect(tables).toContain("presentation_session");
    for (const id of strokeIds) {
      expect(id).toMatch(/^[\w-]+$/);
      for (const table of tables) {
        expect(sql(`select count(*) from ${table} t where t::text like '%${id}%'`), table).toBe(
          "0",
        );
      }
    }
  } finally {
    await closeAll(contexts);
  }
});

function centre(box: Box): [number, number] {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Ana scrolls her frame so the element is mid-screen (the bridge reports it, Ben follows). */
async function scrollTo(frame: Frame, id: string): Promise<void> {
  await frame.evaluate(
    `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: "center", behavior: "instant" })`,
  );
}

/** Where an element of the frame is, in the frame's own viewport. */
async function inFrameViewport(page: Page, id: string) {
  const frame = await presentationFrame(page);
  return frame.evaluate(`(() => {
    const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: innerHeight };
  })()`) as Promise<{ top: number; bottom: number; height: number }>;
}

test("AC-20b: on a single page, a stroke around heading 2 scrolls with it and stays", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana, PAGE_TITLE);
    const anaFrame = await presentationFrame(ana);
    const ben = await newPage(browser, contexts);
    await openLink(ben, link, "Ben");

    await scrollTo(anaFrame, "h2");
    const inView = async (p: Page) => {
      const r = await inFrameViewport(p, "h2");
      return r.top >= 0 && r.bottom <= r.height;
    };
    for (const p of [ana, ben]) await expect.poll(() => inView(p)).toBe(true);

    // Ben circles the second heading.
    await toggleDraw(ben, true);
    await drag(ben, around(await boxOf(ben, "#h2"), 14));
    for (const p of [ana, ben]) {
      await expect(strokes(p)).toHaveCount(1);
      await expectStrokeAround(p, "#h2");
    }

    // Ana scrolls until the heading is off screen: the stroke goes with it, not cleared.
    await scrollTo(anaFrame, "h4");
    for (const p of [ana, ben]) {
      await expect.poll(async () => (await inFrameViewport(p, "h2")).bottom).toBeLessThan(0);
      await expect(strokes(p)).toHaveCount(1);
      await expectStrokeAround(p, "#h2");
    }

    // ...and back up: still around the second heading, for everyone.
    await scrollTo(anaFrame, "h2");
    for (const p of [ana, ben]) {
      await expect.poll(() => inView(p)).toBe(true);
      await expect(strokes(p)).toHaveCount(1);
      await expectStrokeAround(p, "#h2");
    }
  } finally {
    await closeAll(contexts);
  }
});
