// Spec 013 AC-16 (FR-17, NFR-2) and AC-17 (FR-18): a presentation's scripts stay inside their
// frame, and a frame stuck in an endless loop stops nothing else in the session window.
// Fixtures: e2e/fixtures/presentations/hostile.html (records every break-out attempt in its
// own DOM, read here with frame.evaluate) and loop.html (slide 2's script never finishes).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Frame, Page } from "@playwright/test";
import { appPathname, appUrl, expect, openContexts, signIn, test } from "./fixtures";

// The full Chromium build ("chromium" channel, new headless), not Playwright's default
// chromium-headless-shell: the shell keeps a sandboxed frame in its parent's renderer
// process, so a frame stuck in `while(true){}` freezes the whole session page there, while
// full Chromium (what Chrome users run) gives it a process of its own (plan "Isolation" 5).
// Measured on 156.0.8078.4: shell, parent hung; full Chromium, parent kept running.
test.use({ channel: "chromium" });

const FIXTURES = path.join(import.meta.dirname, "fixtures", "presentations");

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function editor(users: Record<string, { username: string; password: string }>) {
  const user = users.editor1;
  if (!user) throw new Error("global setup created no editor1");
  return user;
}

/** editor1 adds the fixture as a presentation and anyone starts a session; returns its invite. */
async function startSession(
  browser: Browser,
  editor: { username: string; password: string },
  fixture: string,
  title: string,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, editor.username, editor.password);
    const added = await page.request.post(
      appUrl(
        `/api/present/presentations?title=${encodeURIComponent(title)}&topic=${encodeURIComponent("Security")}`,
      ),
      {
        data: readFileSync(path.join(FIXTURES, fixture)),
        headers: { "content-type": "text/html" },
      },
    );
    expect(added.status(), await added.text()).toBe(201);
    const { id } = (await added.json()) as { id: string };
    const started = await page.request.post(appUrl("/api/present/sessions"), {
      data: { presentation_id: id },
    });
    expect(started.status()).toBe(201);
    return ((await started.json()) as { invite_id: string }).invite_id;
  } finally {
    await context.close();
  }
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/present/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("list", { name: "Participants" })).toContainText(name);
}

/** The presentation's frame once it has loaded its document. */
async function presentationFrame(page: Page): Promise<Frame> {
  const iframe = page.locator("iframe");
  await expect(iframe).toHaveCount(1);
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("presentation iframe has no frame");
  await frame.waitForLoadState("load");
  return frame;
}

interface Outsider {
  url: string;
  kind: string;
  /** Why it never left, or null if it reached the network layer. */
  stopped: string | null;
}

/**
 * Every request (and WebSocket) the context starts for a host other than the app's.
 * Chromium reports a subresource the frame's CSP blocks as a request that failed with
 * "csp" (net::ERR_BLOCKED_BY_CSP): started by the page but never sent. Anything that reaches the
 * network layer is caught by the route below, recorded as unstopped and aborted.
 */
async function watchOutsiders(context: BrowserContext, appOrigin: string): Promise<Outsider[]> {
  const seen: Outsider[] = [];
  const appHost = new URL(appOrigin).host;
  const isOutside = (url: string) => /^(https?|wss?):/.test(url) && new URL(url).host !== appHost;
  context.on("request", (req) => {
    if (isOutside(req.url())) seen.push({ url: req.url(), kind: req.resourceType(), stopped: "?" });
  });
  context.on("requestfailed", (req) => {
    const entry = seen.find((o) => o.url === req.url() && o.stopped === "?");
    if (entry) entry.stopped = req.failure()?.errorText ?? "failed";
  });
  await context.route(
    (url) => isOutside(url.href),
    async (route) => {
      seen.push({ url: route.request().url(), kind: "reached network", stopped: null });
      await route.abort();
    },
  );
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      if (isOutside(ws.url())) seen.push({ url: ws.url(), kind: "websocket", stopped: null });
    });
  });
  return seen;
}

/** A sample of the canvas pixels, read inside the frame. */
function canvasSample(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const canvas = document.getElementById("spinner") as HTMLCanvasElement;
    const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < (data?.length ?? 0); i += 4) {
      hash = (hash * 31 + (data?.[i] ?? 0) + i) | 0;
    }
    return String(hash);
  });
}

/** A drag across the drawing overlay, as pointer events, between two fractions of its box. */
async function dragOnOverlay(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.getByTestId("present-overlay").evaluate(
    async (overlay, [a, b]) => {
      const box = overlay.getBoundingClientRect();
      const at = (f: { x: number; y: number }) => ({
        clientX: box.left + f.x * box.width,
        clientY: box.top + f.y * box.height,
      });
      const fire = (type: string, point: { clientX: number; clientY: number }, buttons: number) =>
        overlay.dispatchEvent(
          new PointerEvent(type, {
            ...point,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      fire("pointerdown", at(a), 1);
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        fire(
          "pointermove",
          at({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }),
          1,
        );
      }
      fire("pointerup", at(b), 0);
    },
    [from, to] as const,
  );
}

/** Does the frame answer at all within `ms`? */
async function answers(frame: Frame, ms: number): Promise<boolean> {
  const probe = frame.evaluate(() => true).catch(() => false);
  return Promise.race([probe, pause(ms).then(() => false)]);
}

test.describe("presentation isolation", () => {
  test("AC-16: a hostile presentation's break-out attempts all fail; its animation runs", async ({
    browser,
    keycloak,
    baseURL,
  }) => {
    const appOrigin = baseURL ?? "http://127.0.0.1:8000";
    const invite = await startSession(
      browser,
      editor(keycloak.users),
      "hostile.html",
      `Hostile ${Date.now()}`,
    );
    const contexts = await openContexts(browser, 2);
    const outsiders = await Promise.all(contexts.map((c) => watchOutsiders(c, appOrigin)));
    try {
      const [ana, ben] = (await Promise.all(contexts.map((c) => c.newPage()))) as [Page, Page];
      await join(ana, invite, "Ana");
      await join(ben, invite, "Ben");
      const sessionUrl = ana.url();
      const sessionTitle = await ana.title();

      for (const page of [ana, ben]) {
        const frame = await presentationFrame(page);
        await expect(frame.locator("#results")).toHaveAttribute("data-done", "true", {
          timeout: 10_000,
        });
        const results = await frame.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("#results li")).map((li) => ({
            attempt: li.dataset.attempt ?? "",
            outcome: li.dataset.outcome ?? "",
            text: li.textContent ?? "",
          })),
        );
        // Every attempt the fixture makes reported back, and none of them got anywhere.
        expect(results.map((r) => r.attempt).sort()).toEqual(
          [
            "RTCPeerConnection",
            "beacon",
            "cookie-read",
            "cookie-write",
            "fetch-app",
            "fetch-outside",
            "img-outside",
            "localStorage",
            "open-popup",
            "parent-document-read",
            "parent-document-write",
            "parent-localStorage",
            "sessionStorage",
            "top-cookie",
            "top-navigation",
            "websocket",
            "xhr-outside",
          ].sort(),
        );
        for (const r of results) {
          // sendBeacon can only say it queued; the network watch below proves nothing left.
          expect(r.outcome, r.text).toBe(r.attempt === "beacon" ? "queued" : "blocked");
        }

        // The animation on its own slide runs for this participant.
        const before = await canvasSample(frame);
        await expect.poll(() => canvasSample(frame), { timeout: 5_000 }).not.toBe(before);
      }

      // The frame now tries to navigate itself to another host.
      const anaFrame = await presentationFrame(ana);
      await anaFrame.evaluate(() => {
        (window as unknown as { hostileLeave(): void }).hostileLeave();
      });
      await pause(1_000);

      for (const page of [ana, ben]) {
        // The session window is unchanged: same URL, same title, nothing written into it,
        // still one sandboxed frame on the session's frame document, controls still there.
        expect(page.url()).toBe(sessionUrl);
        expect(appPathname(page.url())).toBe(`/present/s/${invite}`);
        expect(await page.title()).toBe(sessionTitle);
        await expect(page.getByText("PWNED")).toHaveCount(0);
        const iframe = page.locator("iframe");
        await expect(iframe).toHaveCount(1);
        await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
        await expect(iframe).toHaveAttribute(
          "src",
          new RegExp(`/api/present/sessions/${invite}/frame`),
        );
        await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
        expect(await page.evaluate(() => document.cookie.includes("hostile"))).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem("hostile"))).toBeNull();
      }
      expect(contexts.every((c) => c.pages().length === 1)).toBe(true);
      // No request left either browser for a host other than the app's: every one the frame
      // started was stopped by its CSP before it was sent.
      const left = outsiders
        .flat()
        .filter((o) => o.stopped !== "csp" && o.stopped !== "net::ERR_BLOCKED_BY_CSP");
      expect(left).toEqual([]);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("AC-17: a presentation looping forever stops neither slides, following nor drawing", async ({
    browser,
    keycloak,
  }) => {
    test.setTimeout(90_000);
    const invite = await startSession(
      browser,
      editor(keycloak.users),
      "loop.html",
      `Runaway ${Date.now()}`,
    );
    const contexts = await openContexts(browser, 2);
    try {
      const [ana, ben] = (await Promise.all(contexts.map((c) => c.newPage()))) as [Page, Page];
      await join(ana, invite, "Ana");
      await join(ben, invite, "Ben");
      await expect(ana.getByRole("list", { name: "Participants" })).toContainText("Ana (host)");
      const anaFrame = await presentationFrame(ana);
      const benFrame = await presentationFrame(ben);
      await expect(ben.getByText("1 / 4")).toBeVisible();

      // Slide 2: its script starts looping in both frames.
      await ana.getByRole("button", { name: "Next slide" }).click();
      await expect(ana.getByText("2 / 4")).toBeVisible();
      await expect(ben.getByText("2 / 4")).toBeVisible();
      await expect.poll(() => answers(anaFrame, 1_000), { timeout: 10_000 }).toBe(false);
      await expect.poll(() => answers(benFrame, 1_000), { timeout: 10_000 }).toBe(false);

      // The host still changes slides and Ben's counter follows.
      await ana.getByRole("button", { name: "Next slide" }).click();
      await expect(ana.getByText("3 / 4")).toBeVisible();
      await expect(ben.getByText("3 / 4")).toBeVisible();
      await ana.getByRole("button", { name: "Previous slide" }).click();
      await ana.getByRole("button", { name: "Previous slide" }).click();
      await expect(ben.getByText("1 / 4")).toBeVisible();
      await ana.getByRole("button", { name: "Next slide" }).click();
      await ana.getByRole("button", { name: "Next slide" }).click();
      await expect(ben.getByText("3 / 4")).toBeVisible();
      // The frames are still stuck: everything above happened around them.
      expect(await answers(benFrame, 500)).toBe(false);

      // A stroke drawn by Ben shows for Ana.
      await ben.getByRole("button", { name: "Draw", exact: true }).click();
      await expect(ben.getByRole("button", { name: "Draw", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Ben's drag goes in as DOM pointer events on the overlay rather than page.mouse: in
      // Chromium 156 a hung out-of-process frame stalls every mouse move that follows a
      // mouse-down anywhere on the page (page.mouse never gets an ack, and the page receives
      // no further pointermove), even over an element far from the frame. That browser
      // behaviour is reported with task 29; what this checks is that the session's own
      // drawing path (overlay, frame link timing out, socket, Ana's overlay) keeps working.
      await dragOnOverlay(ben, { x: 0.3, y: 0.4 }, { x: 0.6, y: 0.55 });
      await expect(ben.getByTestId("present-overlay").locator("polyline")).toHaveCount(1);
      const anaStroke = ana.getByTestId("present-overlay").locator("polyline");
      await expect(anaStroke).toHaveCount(1, { timeout: 5_000 });
      await expect
        .poll(async () => ((await anaStroke.getAttribute("points")) ?? "").split(" ").length)
        .toBeGreaterThan(5);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});
