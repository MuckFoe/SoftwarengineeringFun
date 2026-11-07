// Spec 013 task 27: following the host, the host's cursor, different window sizes and the
// latency budget (AC-8 to AC-14, AC-24). Ana starts a session from the library and hosts;
// Ben (and Cleo) join by the invite link in their own browsers, without an account. Every
// check of what someone "sees" reads the presentation frame itself (sandboxed, opaque
// origin), not just the toolbar.
import type { Browser, BrowserContext, Frame, Page } from "@playwright/test";
import { appPathname, appUrl, expect, signIn, test } from "./fixtures";
import type { KeycloakState } from "./global-setup";

const RUN = Date.now().toString(36);
const DECK_TITLE = `Follow deck ${RUN}`;
const PAGE_TITLE = `Follow page ${RUN}`;
const TOPIC = "Following";

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

/** Four `data-slide` slides; every word of the line under the heading is its own element. */
const DECK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Deck</title>
<style>
  body { margin: 0; font: 24px/1.5 sans-serif; }
  [data-slide] { padding: 40px; }
  .w { display: inline-block; padding: 4px 8px; }
</style></head>
<body>
${[1, 2, 3, 4]
  .map(
    (n) =>
      `  <div data-slide><h1>Slide ${n}</h1><p>${WORDS.map(
        (w) => `<span class="w">${w}${n}</span>`,
      ).join(" ")}</p></div>`,
  )
  .join("\n")}
</body>
</html>`;

const LOREM =
  "Packets travel through routers that read each header and forward it one hop closer. ";

/** A long single page: five headings, each followed by text that reflows with the width. */
const LONG_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Page</title>
<style>
  body { margin: 0 24px; font: 18px/1.6 sans-serif; }
  h2 { margin: 32px 0; }
</style></head>
<body>
${[1, 2, 3, 4, 5]
  .map((n) => `  <h2 id="h${n}">Heading ${n}</h2>\n  <p>${LOREM.repeat(140)}</p>`)
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

type Viewport = { width: number; height: number };
const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

async function newPage(browser: Browser, contexts: BrowserContext[], viewport = DEFAULT_VIEWPORT) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  return context.newPage();
}

const participants = (page: Page) => page.getByRole("list", { name: "Participants" });

async function joinAs(page: Page, name: string): Promise<void> {
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(participants(page)).toContainText(new RegExp(`${name}( \\(host\\))? \\(you\\)`));
}

/** Ana starts a session on `title` from the library; returns the invite link (AC-8). */
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

/** The presentation frame of `page`, once its bridge has marked the document. */
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

/** Where an element of the frame is, in the frame's own viewport, and that viewport's size. */
async function inFrameViewport(page: Page, selector: string, retries = 3): Promise<{ top: number; bottom: number; height: number; scrollY: number }> {
  try {
    return await inFrameViewportOnce(page, selector);
  } catch (error) {
    if (retries > 0 && /context was destroyed/.test(String(error))) {
      return inFrameViewport(page, selector, retries - 1);
    }
    throw error;
  }
}

async function inFrameViewportOnce(page: Page, selector: string) {
  const frame = await presentationFrame(page);
  // The frame's document can be replaced while the page settles: ask again on that error.
  return frame.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    // Before the frame's document has the element: not in view yet.
    return { top: r ? r.top : -1, bottom: r ? r.bottom : -1, height: innerHeight, scrollY };
  })()`) as Promise<{ top: number; bottom: number; height: number; scrollY: number }>;
}

async function expectInView(page: Page, selector: string): Promise<void> {
  await expect
    .poll(async () => {
      const r = await inFrameViewport(page, selector);
      return r.top >= 0 && r.bottom <= r.height;
    })
    .toBe(true);
}

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await frameView(page).locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The simulated cursor's tip (its box's top-left corner) is inside `selector`'s box. */
async function expectCursorOn(page: Page, selector: string): Promise<void> {
  const cursor = page.locator("[data-cursor]");
  await expect(cursor).toHaveCount(1);
  await expect(cursor).toContainText("Ana");
  await expect
    .poll(async () => {
      const tip = await cursor.boundingBox();
      const target = await frameView(page).locator(selector).first().boundingBox();
      if (!tip || !target) return false;
      return (
        tip.x >= target.x - 1 &&
        tip.x <= target.x + target.width + 1 &&
        tip.y >= target.y - 1 &&
        tip.y <= target.y + target.height + 1
      );
    })
    .toBe(true);
}

/** Records every WebSocket message `page` sends from now on. */
function recordSent(page: Page): string[] {
  const sent: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      if (typeof frame.payload === "string") sent.push(frame.payload);
    });
  });
  return sent;
}

const sentPlaces = (sent: string[]) =>
  sent.filter((p) => {
    try {
      return (JSON.parse(p) as { type?: string }).type === "place";
    } catch {
      return false;
    }
  });

async function closeAll(contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map((c) => c.close()));
}

// --- Tests ---------------------------------------------------------------------------------

test("AC-8–AC-13: Ben follows Ana's slides, sees her cursor, and can't lead", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    // AC-8: Ana starts a session from the library, is host and sees slide 1.
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana, DECK_TITLE);
    await expectSlide(ana, 1);

    // AC-9: Ben opens the link in a browser that has never signed in.
    const ben = await newPage(browser, contexts);
    const benSent = recordSent(ben);
    await openLink(ben, link, "Ben");
    await expect(participants(ben)).toContainText("Ana (host)");
    await expect(participants(ana)).toContainText("Ben");
    await expectSlide(ben, 1);

    // AC-10: slide 3, then back to 2.
    const next = ana.getByRole("button", { name: "Next slide" });
    const previous = ana.getByRole("button", { name: "Previous slide" });
    await next.click();
    await next.click();
    await expectSlide(ana, 3);
    await expectSlide(ben, 3);

    // AC-11: Ben reloads, Cleo joins for the first time: both on slide 3 straight away (the
    // frame is loaded at Ana's slide, not moved there afterwards).
    await ben.reload();
    await expect(participants(ben)).toContainText("Ben (you)"); // auto-rejoined, no prompt
    await expect(iframe(ben)).toHaveAttribute("src", /#slide=2$/);
    await expectSlide(ben, 3);
    const cleo = await newPage(browser, contexts);
    await openLink(cleo, link, "Cleo");
    await expect(iframe(cleo)).toHaveAttribute("src", /#slide=2$/);
    await expectSlide(cleo, 3);

    await previous.click();
    await expectSlide(ana, 2);
    await expectSlide(ben, 2);
    await expectSlide(cleo, 2);

    // AC-12: Ana's pointer over a word; Ben sees a cursor labelled "Ana" over the same word,
    // and it follows her to another word.
    await ana.mouse.move(...xy(await centre(ana, "[data-sdd-current] .w >> nth=1")));
    await expectCursorOn(ben, "[data-sdd-current] .w >> nth=1");
    await ana.mouse.move(...xy(await centre(ana, "[data-sdd-current] .w >> nth=4")));
    await expectCursorOn(ben, "[data-sdd-current] .w >> nth=4");
    await expect(ana.locator("[data-cursor]")).toHaveCount(0);
    // ...and it goes when her pointer leaves the presentation.
    await ana.getByRole("heading", { name: DECK_TITLE }).hover();
    await expect(ben.locator("[data-cursor]")).toHaveCount(0);

    // AC-13: Ben's next button, the arrow keys (on the page and inside the frame) and the
    // wheel change nothing, for him or anyone else.
    const benNext = ben.getByRole("button", { name: "Next slide" });
    await expect(benNext).toBeDisabled();
    await benNext.click({ force: true });
    await ben.locator("body").press("ArrowRight");
    await ben.keyboard.press("PageDown");
    await ben.keyboard.press("End");
    await ben.mouse.click(...xy(await centre(ben, "[data-sdd-current] h1")));
    await ben.keyboard.press("ArrowRight");
    await ben.keyboard.press("ArrowLeft");
    await ben.mouse.wheel(0, 600);
    await ben.waitForTimeout(700);
    await expectSlide(ben, 2);
    await expectSlide(ana, 2);
    await expectSlide(cleo, 2);
    expect(sentPlaces(benSent)).toEqual([]);

    // AC-12: the cursor is hidden for Ben once Ana leaves.
    await ana.mouse.move(...xy(await centre(ana, "[data-sdd-current] .w >> nth=2")));
    await expectCursorOn(ben, "[data-sdd-current] .w >> nth=2");
    await ana.close();
    await expect(ben.locator("[data-cursor]")).toHaveCount(0);
  } finally {
    await closeAll(contexts);
  }
});

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}

test("AC-10, AC-13: on a single page Ben follows Ana's scroll and can't scroll himself", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana, PAGE_TITLE);
    await expectInView(ana, "#h1");
    const ben = await newPage(browser, contexts);
    const benSent = recordSent(ben);
    await openLink(ben, link, "Ben");
    await expectInView(ben, "#h1");

    // Ana scrolls to the third heading (with the wheel, as a person would).
    const anaFrame = await presentationFrame(ana);
    await ana.mouse.move(...xy(await centre(ana, "#h1")));
    await expect
      .poll(async () => {
        const r = await inFrameViewport(ana, "#h3");
        if (r.top >= r.height * 0.25 && r.bottom <= r.height * 0.75) return true;
        await ana.mouse.wheel(0, Math.round(r.top - r.height / 2));
        return false;
      })
      .toBe(true);
    await expectInView(ben, "#h3");
    await expect.poll(async () => (await inFrameViewport(ben, "#h1")).bottom).toBeLessThan(0);

    // AC-13: Ben's wheel and keys don't move him (nor Ana).
    const before = await inFrameViewport(ben, "#h3");
    const anaBefore = (await anaFrame.evaluate("scrollY")) as number;
    await ben.mouse.move(...xy(await centre(ben, "#h3")));
    await ben.mouse.wheel(0, 900);
    await ben.mouse.click(...xy(await centre(ben, "#h3")));
    await ben.keyboard.press("PageDown");
    await ben.keyboard.press("ArrowDown");
    await ben.keyboard.press("Space");
    await ben.keyboard.press("End");
    await ben.waitForTimeout(700);
    expect((await inFrameViewport(ben, "#h3")).scrollY).toBe(before.scrollY);
    expect(await anaFrame.evaluate("scrollY")).toBe(anaBefore);
    expect(sentPlaces(benSent)).toEqual([]);
  } finally {
    await closeAll(contexts);
  }
});

test("AC-14: Ana at 1920 px and Ben at 1024 px see the same heading under the cursor", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts, { width: 1920, height: 1080 });
    const link = await startFromLibrary(ana, PAGE_TITLE);
    const ben = await newPage(browser, contexts, { width: 1024, height: 768 });
    await openLink(ben, link, "Ben");

    // The page really reflows: the fourth heading sits at different depths for the two.
    const anaFrame = await presentationFrame(ana);
    const benFrame = await presentationFrame(ben);
    const depth = (f: Frame) =>
      f.evaluate(`document.getElementById("h4").getBoundingClientRect().top + scrollY`);
    expect(Math.abs(Number(await depth(anaFrame)) - Number(await depth(benFrame)))).toBeGreaterThan(
      200,
    );

    // Ana brings the fourth heading half-way down her screen and points at it.
    await anaFrame.evaluate(
      `document.getElementById("h4").scrollIntoView({ block: "center", behavior: "instant" })`,
    );
    const r = await inFrameViewport(ana, "#h4");
    expect(Math.abs((r.top + r.bottom) / 2 - r.height / 2)).toBeLessThan(5);
    await ana.mouse.move(...xy(await centre(ana, "#h4")));

    await expectInView(ben, "#h4");
    await expectCursorOn(ben, "#h4");
  } finally {
    await closeAll(contexts);
  }
});

// --- AC-24 ---------------------------------------------------------------------------------

// Browser-side (strings: this package's tsconfig has no DOM lib). All pages and frames run
// in one browser on one machine, so `performance.timeOrigin + performance.now()` is a shared
// high-resolution clock, as in latency.spec.ts.
const NOW = "performance.timeOrigin + performance.now()";

/** Host page: when each slide button is clicked, before the app handles it. */
const RECORD_CLICKS = `(() => {
  window.__clicks = [];
  document.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest('button[aria-label$="slide"]')) {
      window.__clicks.push(${NOW});
    }
  }, true);
})()`;

/** Follower's frame: when a slide mark becomes the current one. */
const RECORD_SLIDES = `(() => {
  window.__shown = [];
  new MutationObserver((records) => {
    const now = ${NOW};
    if (records.some((r) => r.target.hasAttribute("data-sdd-current"))) window.__shown.push(now);
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-sdd-current"] });
})()`;

/** Host's frame: when the pointer moves, before the bridge handles it. */
const RECORD_MOVES = `(() => {
  window.__moves = [];
  document.addEventListener("mousemove", () => window.__moves.push(${NOW}), true);
})()`;

/** Follower page: when the simulated cursor first shows at a new position. */
const RECORD_CURSOR = `(() => {
  window.__cursorAt = [];
  window.__lastCursor = null;
  const overlay = document.querySelector('[data-testid="present-overlay"]');
  new MutationObserver(() => {
    const now = ${NOW};
    const el = overlay.querySelector("[data-cursor]");
    const t = el ? el.style.transform : null;
    if (t && t !== window.__lastCursor) {
      window.__lastCursor = t;
      window.__cursorAt.push(now);
    }
  }).observe(overlay, { subtree: true, childList: true, attributes: true });
})()`;

const SAMPLES = 5;

/** SAMPLES is odd, so the median is the middle value. */
function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

test("AC-24: slide changes reach Ben within 500 ms and the cursor within 200 ms", async ({
  browser,
  keycloak,
  browserName,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana, DECK_TITLE);
    const ben = await newPage(browser, contexts);
    await openLink(ben, link, "Ben");
    await expectSlide(ben, 1);

    // Slide changes: click, then the follower's frame shows the new slide.
    await ana.evaluate(RECORD_CLICKS);
    const benFrame = await presentationFrame(ben);
    await benFrame.evaluate(RECORD_SLIDES);
    const steps = ["Next slide", "Next slide", "Next slide", "Previous slide", "Previous slide"];
    for (const [i, name] of steps.entries()) {
      await ana.getByRole("button", { name }).click();
      await benFrame.waitForFunction(`window.__shown.length >= ${i + 1}`, null, {
        polling: "raf",
      });
    }
    await expectSlide(ben, 2);
    const clicks = (await ana.evaluate("window.__clicks")) as number[];
    const shown = (await benFrame.evaluate("window.__shown")) as number[];
    expect(clicks).toHaveLength(SAMPLES);
    const slideLatencies = clicks.map((t, i) => (shown[i] ?? Number.NaN) - t);

    // Cursor: one pointer move inside Ana's frame, then Ben's cursor shows at a new place.
    const anaFrame = await presentationFrame(ana);
    await anaFrame.evaluate(RECORD_MOVES);
    await ben.evaluate(RECORD_CURSOR);
    const cursorLatencies: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const target = await centre(ana, `[data-sdd-current] .w >> nth=${i % WORDS.length}`);
      await anaFrame.evaluate("window.__moves = []");
      const seen = (await ben.evaluate("window.__cursorAt.length")) as number;
      await ana.mouse.move(target.x, target.y);
      await ben.waitForFunction(`window.__cursorAt.length > ${seen}`, null, { polling: "raf" });
      const moved = (await anaFrame.evaluate("window.__moves[0]")) as number;
      const at = (await ben.evaluate(`window.__cursorAt[${seen}]`)) as number;
      cursorLatencies.push(at - moved);
    }

    const slideMedian = median(slideLatencies);
    const cursorMedian = median(cursorLatencies);
    const fmt = (xs: number[]) => xs.map((x) => x.toFixed(1)).join(", ");
    console.log(
      `AC-24 ${browserName}: slide median ${slideMedian.toFixed(1)} ms (${fmt(slideLatencies)}); ` +
        `cursor median ${cursorMedian.toFixed(1)} ms (${fmt(cursorLatencies)})`,
    );
    // Every sample is a real measurement: arrival after the action, on the shared clock.
    for (const latency of [...slideLatencies, ...cursorLatencies]) {
      expect(latency).toBeGreaterThan(0);
    }
    expect(slideMedian).toBeLessThanOrEqual(500);
    expect(cursorMedian).toBeLessThanOrEqual(200);
  } finally {
    await closeAll(contexts);
  }
});
