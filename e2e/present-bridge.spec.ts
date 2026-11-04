// Spec 013 task 8: bridge.js, the frame side of the bridge protocol, in real Chromium.
// No app stack: present-harness.ts serves a parent page and a frame built by the backend's
// own frame.py, on fake origins via page.route. Run it alone with the small config that
// skips playwright.config.ts's global setup (it also runs fine in the full suite):
//   npx playwright test --config present-bridge.config.ts
// Covers spec 013 AC-2 (parity with html_check), AC-10, AC-12, AC-13, AC-14 and NFR-2.
import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  type Anchor,
  buildFrames,
  FIXTURES,
  type Message,
  openHarness,
  type Rect,
  readFixture,
  visibleMarks,
} from "./present-harness";

const LOREM =
  "Presentations reflow with the width of the window they are shown in, so a pixel " +
  "position on one screen means nothing on another. The bridge therefore names places " +
  "by the element under them and a fraction of that element's box, which survives the " +
  "reflow. This sentence is long so that it wraps a different number of times at " +
  "different widths, and the headings below it move by different amounts.";

/** A single long page: 30 headings, each followed by paragraphs that reflow with width. */
function longPage(): string {
  const parts = Array.from(
    { length: 30 },
    (_, i) =>
      `<h2 id="h${i}">Heading ${i}</h2><p>${LOREM}</p><p>${LOREM} ${LOREM}</p>` +
      (i % 3 === 0 ? `<p>${LOREM} ${LOREM} ${LOREM}</p>` : ""),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Long</title>
<style>body{font:18px/1.5 sans-serif;margin:0 24px}</style></head><body><main>${parts.join("")}</main></body></html>`;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pointOf(rect: Rect, anchor: Anchor) {
  return { x: rect.x + anchor.fx * rect.w, y: rect.y + anchor.fy * rect.h };
}

function headingRect(frame: import("@playwright/test").Frame, id: string): Promise<Rect> {
  return frame.evaluate((sel) => {
    const r = document.getElementById(sel)?.getBoundingClientRect();
    if (!r) throw new Error(`no #${sel}`);
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, id);
}

test.describe("bridge.js", () => {
  test("AC-2 parity: ready reports the same kind and slide count as html_check", async ({
    page,
  }) => {
    const names = readdirSync(FIXTURES).filter((n) => n.endsWith(".html"));
    expect(names.length).toBeGreaterThanOrEqual(5);
    const built = buildFrames(Object.fromEntries(names.map((n) => [n, { html: readFixture(n) }])));
    for (const name of names) {
      const doc = built.docs[name];
      if (!doc) throw new Error(name);
      const h = await openHarness(page, built, name);
      const ready = await h.waitFor("ready");
      expect({ name, kind: ready.kind, slideCount: ready.slideCount }).toEqual({
        name,
        kind: doc.kind,
        slideCount: doc.slideCount,
      });
      if (doc.kind === "slides") {
        const shown = await visibleMarks(h.frame);
        expect(shown.length).toBe(doc.slideCount);
        expect(shown, name).toEqual(shown.map((_, i) => i === 0));
      }
      await page.unrouteAll();
    }
  });

  test("AC-10: show switches slides without reloading; #slide= applies before ready", async ({
    page,
  }) => {
    // An inline script right after the second mark sees, while the page is still parsing,
    // whether the bridge has already made it current.
    const html = readFixture("four-data-slides.html").replace(
      "<div data-slide><h1>Slide 2</h1></div>",
      '<div data-slide><h1>Slide 2</h1></div><script>window.__early = document.querySelectorAll("[data-slide]")[1].hasAttribute("data-sdd-current");</script>',
    );
    const built = buildFrames({
      deck: { html },
      plain: { html: readFixture("four-data-slides.html") },
      server: { html: readFixture("four-sections.html"), slide: 3 },
    });

    let h = await openHarness(page, built, "deck", { hash: "#slide=1" });
    expect(await h.frame.evaluate(() => (window as unknown as { __early: boolean }).__early)).toBe(
      true,
    );
    expect(await visibleMarks(h.frame)).toEqual([false, true, false, false]);
    await page.unrouteAll();

    h = await openHarness(page, built, "plain");
    await h.frame.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 42;
    });
    await h.send({ sdd: "show", slide: 2, anchor: null });
    await expect.poll(() => visibleMarks(h.frame)).toEqual([false, false, true, false]);
    // Same document: not reloaded.
    expect(await h.frame.evaluate(() => (window as unknown as { __marker: number }).__marker)).toBe(
      42,
    );
    await page.unrouteAll();

    // Without a hash, the slide the server built the frame with is shown.
    h = await openHarness(page, built, "server");
    expect(await visibleMarks(h.frame)).toEqual([false, false, false, true]);
  });

  test("AC-14: an anchor at a heading in 1920 px resolves inside it in 1024 px, mid-screen", async ({
    browser,
  }) => {
    const built = buildFrames({ long: { html: longPage() } });

    const wide = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    const host = await openHarness(wide, built, "long");
    // The host scrolls heading 12 to the middle of their screen; the bridge reports the place.
    await host.frame.evaluate(() => {
      const r = document.getElementById("h12")?.getBoundingClientRect();
      if (!r) throw new Error("no h12");
      window.scrollBy(0, r.top + r.height / 2 - window.innerHeight / 2);
    });
    await expect
      .poll(async () => (await host.messages()).filter((m) => m.sdd === "scrolled").length)
      .toBeGreaterThan(0);
    const scrolled = (await host.messages()).filter((m) => m.sdd === "scrolled").at(-1);
    const place = scrolled?.anchor as Anchor;
    expect(place).toBeTruthy();
    // And an anchor taken at the heading itself.
    const h12 = await headingRect(host.frame, "h12");
    const at = await host.request(
      { sdd: "anchorAt", x: h12.x + 40, y: h12.y + h12.h / 2 },
      "anchorAt",
    );
    const atHeading = at.anchor as Anchor;
    expect(atHeading).toBeTruthy();
    const atRect = at.rect as Rect;
    expect(atRect.y).toBeCloseTo(h12.y, 0);

    const narrow = await browser.newPage({
      viewport: { width: 1024, height: 768 },
    });
    const follower = await openHarness(narrow, built, "long");
    const resolved = await follower.request(
      { sdd: "resolve", anchors: [atHeading, null] },
      "resolved",
    );
    const rects = resolved.rects as (Rect | null)[];
    expect(rects[1]).toBeNull();
    const point = pointOf(rects[0] as Rect, atHeading);
    const box = await headingRect(follower.frame, "h12");
    expect(point.x).toBeGreaterThanOrEqual(box.x);
    expect(point.x).toBeLessThanOrEqual(box.x + box.w);
    expect(point.y).toBeGreaterThanOrEqual(box.y);
    expect(point.y).toBeLessThanOrEqual(box.y + box.h);

    // show {anchor}: the host's mid-screen point lands at the follower's vertical centre.
    await follower.send({ sdd: "show", slide: null, anchor: place });
    await expect
      .poll(async () => {
        const r = await follower.request({ sdd: "resolve", anchors: [place] }, "resolved");
        return Math.abs(pointOf((r.rects as Rect[])[0] as Rect, place).y - 768 / 2);
      })
      .toBeLessThanOrEqual(10);
    const mid = await headingRect(follower.frame, "h12");
    expect(mid.y).toBeLessThanOrEqual(384 + 10);
    expect(mid.y + mid.h).toBeGreaterThanOrEqual(384 - 10);

    // Clamped at the page ends: the last heading can't reach the centre of a page that ends.
    const children = await follower.frame.evaluate(
      () => document.querySelectorAll("main > *").length,
    );
    const last: Anchor = { path: [0, children - 1], fx: 0.5, fy: 1 };
    await follower.send({ sdd: "show", slide: null, anchor: last });
    await expect
      .poll(() =>
        follower.frame.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight - window.scrollY,
        ),
      )
      .toBeLessThanOrEqual(1);
    await follower.send({
      sdd: "show",
      slide: null,
      anchor: { path: [0, 0], fx: 0.5, fy: 0 },
    });
    await expect.poll(() => follower.frame.evaluate(() => window.scrollY)).toBe(0);

    await wide.close();
    await narrow.close();
  });

  test("AC-13: following, wheel and keyboard don't scroll; show still does", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const built = buildFrames({ long: { html: longPage() } });
    const h = await openHarness(page, built, "long");
    const scrollY = () => h.frame.evaluate(() => window.scrollY);

    await h.send({ sdd: "follow", on: true });
    await page.mouse.click(400, 300);
    await page.mouse.wheel(0, 800);
    for (const key of ["PageDown", "ArrowDown", "Space", "End"]) await page.keyboard.press(key);
    await pause(300);
    expect(await scrollY()).toBe(0);

    await h.send({
      sdd: "show",
      slide: null,
      anchor: { path: [0, 40], fx: 0.5, fy: 0.5 },
    });
    await expect.poll(scrollY).toBeGreaterThan(0);
    const shown = await scrollY();

    // Control: once not following, the same input scrolls.
    await h.send({ sdd: "follow", on: false });
    await page.mouse.wheel(0, 400);
    await expect.poll(scrollY).toBeGreaterThan(shown);
  });

  test("AC-13: slide keys are forwarded to the page", async ({ page }) => {
    const built = buildFrames({
      deck: { html: readFixture("four-data-slides.html") },
    });
    const h = await openHarness(page, built, "deck");
    await page.mouse.click(200, 200);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("End");
    await expect
      .poll(async () => (await h.messages()).filter((m) => m.sdd === "key").map((m) => m.key))
      .toEqual(["ArrowRight", "End"]);
    // The bridge doesn't change slides on its own: only show does.
    expect(await visibleMarks(h.frame)).toEqual([true, false, false, false]);
  });

  test("AC-12: the pointer over the frame is reported as an anchor, and its leaving", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const built = buildFrames({ long: { html: longPage() } });
    const h = await openHarness(page, built, "long", {
      width: 800,
      height: 600,
    });
    const h0 = await headingRect(h.frame, "h0");
    await page.mouse.move(h0.x + 30, h0.y + h0.h / 2);
    await expect
      .poll(async () => (await h.messages()).filter((m) => m.sdd === "pointer" && m.anchor).length)
      .toBeGreaterThan(0);
    const pointer = (await h.messages()).filter((m) => m.sdd === "pointer").at(-1) as Message;
    // Mouse events carry whole CSS pixels.
    expect(Math.abs((pointer.x as number) - (h0.x + 30))).toBeLessThanOrEqual(1);
    expect(Math.abs((pointer.y as number) - (h0.y + h0.h / 2))).toBeLessThanOrEqual(1);
    const resolved = await h.request({ sdd: "resolve", anchors: [pointer.anchor] }, "resolved");
    const point = pointOf((resolved.rects as Rect[])[0] as Rect, pointer.anchor as Anchor);
    expect(point.y).toBeGreaterThanOrEqual(h0.y);
    expect(point.y).toBeLessThanOrEqual(h0.y + h0.h);

    await page.mouse.move(1100, 650); // the parent page, outside the iframe
    await expect
      .poll(async () => (await h.messages()).filter((m) => m.sdd === "pointer").at(-1))
      .toEqual({ sdd: "pointer", anchor: null });
  });

  test("layout is posted on scroll and on slide change", async ({ page }) => {
    const built = buildFrames({
      deck: { html: readFixture("four-sections.html") },
    });
    const h = await openHarness(page, built, "deck");
    const layouts = async () => (await h.messages()).filter((m) => m.sdd === "layout").length;
    const before = await layouts();
    await h.send({ sdd: "show", slide: 1, anchor: null });
    await expect.poll(layouts).toBeGreaterThan(before);
  });

  test("NFR-2: no WebRTC in the frame; messages not from the parent are ignored", async ({
    page,
  }) => {
    const built = buildFrames({
      deck: { html: readFixture("four-data-slides.html") },
    });
    const h = await openHarness(page, built, "deck");
    expect(
      await h.frame.evaluate(() => [
        typeof (window as unknown as Record<string, unknown>).RTCPeerConnection,
        typeof (window as unknown as Record<string, unknown>).webkitRTCPeerConnection,
        typeof (window as unknown as Record<string, unknown>).RTCDataChannel,
      ]),
    ).toEqual(["undefined", "undefined", "undefined"]);

    // The presentation posting to itself is not the parent.
    await h.frame.evaluate(() => {
      window.postMessage({ sdd: "show", slide: 3, anchor: null }, "*");
      window.postMessage({ sdd: "follow", on: true }, "*");
    });
    await pause(300);
    expect(await visibleMarks(h.frame)).toEqual([true, false, false, false]);
    expect(await h.frame.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe(
      "hidden",
    );

    // The same message from the parent works.
    await h.send({ sdd: "show", slide: 3, anchor: null });
    await expect.poll(() => visibleMarks(h.frame)).toEqual([false, false, false, true]);
  });

  test("frame isolation headers reach the browser: the frame's origin is opaque", async ({
    page,
  }) => {
    const built = buildFrames({
      deck: { html: readFixture("single-page.html") },
    });
    const h = await openHarness(page, built, "deck");
    expect(await h.frame.evaluate(() => self.origin)).toBe("null");
  });
});
