// Spec 013 task 31: a presentation session gone stale (AC-15g), its chat with text and GIFs
// (AC-15h), and the keyboard-only host with a WCAG AA scan (AC-25). Ana starts a session
// from the library and hosts; Ben (and Cleo) join by the invite link in their own browsers;
// admin1 signs in to reactivate and to moderate. The fake GIPHY of docker-compose.test.yml
// answers "cat" (as in gifs.spec.ts).
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { appPathname, appUrl, BASE_PATH, expect, fakeGiphy, signIn, sql, test } from "./fixtures";
import type { KeycloakState } from "./global-setup";

const RUN = Date.now().toString(36);
const DECK_TITLE = `Extras deck ${RUN}`;
const TOPIC = "Extras";

/** Four `data-slide` slides, each a heading and a paragraph. */
const DECK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Deck</title>
<style>
  body { margin: 0; font: 22px/1.6 sans-serif; }
  [data-slide] { padding: 40px; }
</style></head>
<body>
${[1, 2, 3, 4]
  .map(
    (n) =>
      `  <div data-slide><h1>Slide ${n}</h1>` +
      `<p class="text">Routers forward each packet one hop closer, slide ${n}.</p></div>`,
  )
  .join("\n")}
</body>
</html>`;

// --- Library -------------------------------------------------------------------------------

let library: Promise<void> | null = null;

/** Adds the deck once per run, as editor1. */
function ensureLibrary(browser: Browser, keycloak: KeycloakState): Promise<void> {
  library ??= (async () => {
    const editor = keycloak.users.editor1;
    if (!editor) throw new Error("no keycloak test user 'editor1'");
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await signIn(page, editor.username, editor.password);
      const query = `title=${encodeURIComponent(DECK_TITLE)}&topic=${encodeURIComponent(TOPIC)}`;
      const added = await context.request.post(appUrl(`/api/present/presentations?${query}`), {
        data: DECK,
        headers: { "content-type": "text/html" },
      });
      expect(added.status(), await added.text()).toBe(201);
    } finally {
      await context.close();
    }
  })();
  return library;
}

// --- Session helpers -------------------------------------------------------------------------

async function newPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  contexts.push(context);
  return context.newPage();
}

const participants = (page: Page) => page.getByRole("list", { name: "Participants" });

async function joinAs(page: Page, name: string): Promise<void> {
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(participants(page)).toContainText(new RegExp(`${name}( \\(host\\))? \\(you\\)`));
}

/** Signed in, `page` joined by itself under the account name, with no prompt (spec 012 FR-1). */
async function expectJoinedSignedIn(page: Page, username: string): Promise<void> {
  const you = participants(page).getByRole("listitem").filter({ hasText: "(you)" });
  await expect(you).toContainText(username);
  await expect(you).toContainText("signed in");
  await expect(page.getByLabel("Your name")).toHaveCount(0);
}

/** Ana starts a session on the deck from the library; returns the invite link. */
async function startFromLibrary(page: Page): Promise<string> {
  await page.goto(appUrl("/present"));
  await page.getByRole("button", { name: `Start session: ${DECK_TITLE}` }).click();
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

/** Reloads a page of someone who joined before: they come back as themselves, no prompt. */
async function reloadJoined(page: Page, name: string): Promise<void> {
  await page.reload();
  await expect(participants(page)).toContainText(new RegExp(`${name}( \\(host\\))? \\(you\\)`));
}

const inviteOf = (link: string) => appPathname(link).split("/").at(-1) ?? "";

const frameView = (page: Page) => page.frameLocator("iframe[sandbox]");
const strokes = (page: Page) => page.locator('[data-testid="present-overlay"] polyline');
const prevButton = (page: Page) => page.getByRole("button", { name: "Previous slide" });
const nextButton = (page: Page) => page.getByRole("button", { name: "Next slide" });
const drawButton = (page: Page) => page.getByRole("button", { name: "Draw", exact: true });
const clearButton = (page: Page) => page.getByRole("button", { name: "Clear drawings" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Presentation session" });

const messageInput = (page: Page) => page.getByLabel("Message", { exact: true });
const messages = (page: Page) => page.getByRole("list", { name: "Messages" });
const gifButton = (page: Page) => page.getByRole("button", { name: "GIF", exact: true });
const results = (page: Page) => page.getByRole("listbox", { name: "GIFs" });

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

/** Drags across the middle of the current slide's paragraph, with the left button held. */
async function strokeAcrossText(page: Page): Promise<void> {
  const box = await frameView(page).locator("[data-sdd-current] .text").boundingBox();
  if (!box) throw new Error("no text box");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  for (const f of [0.3, 0.5, 0.7, 0.9])
    await page.mouse.move(box.x + box.width * f, y, { steps: 3 });
  await page.mouse.up();
}

async function send(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
  await expect(messages(page).getByText(text, { exact: true })).toBeVisible();
}

/** Opens the GIF picker (accepting the first-time notice), searches "cat" and posts `title`. */
async function postCat(page: Page, title: string): Promise<void> {
  await gifButton(page).click();
  const proceed = page.getByRole("button", { name: "Continue" });
  if (await proceed.isVisible()) await proceed.click();
  await page.getByLabel("Search GIFs").fill("cat");
  await results(page).getByRole("option", { name: title, exact: true }).click();
  await expect(results(page)).toHaveCount(0);
}

/** Opens the session's WebSocket from the page and resolves with the code it is closed with. */
function socketCloseCode(page: Page, invite: string): Promise<number> {
  const path = `${BASE_PATH}/api/present/sessions/${invite}/ws?name=Probe`;
  return page.evaluate(`new Promise((resolve) => {
    const url = new URL(${JSON.stringify(path)}, location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url.href);
    ws.onclose = (e) => resolve(e.code);
  })`) as Promise<number>;
}

async function signInAdmin(
  browser: Browser,
  contexts: BrowserContext[],
  keycloak: KeycloakState,
  invite: string,
): Promise<Page> {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const page = await newPage(browser, contexts);
  await signIn(page, admin.username, admin.password, `/present/s/${invite}`);
  return page;
}

function admin1Name(keycloak: KeycloakState): string {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  return admin.username;
}

async function closeAll(contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map((c) => c.close()));
}

/** A WCAG 2 A/AA scan of the page; the presentation inside the frame is its author's. */
async function violations(page: Page): Promise<string[]> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const axe = await new AxeBuilder({ page })
    .exclude("iframe[sandbox]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return axe.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} ${n.target.join(" ")}: ${n.failureSummary}`),
  );
}

// --- AC-15g ----------------------------------------------------------------------------------

test("AC-15g: a stale session shows the last place read-only and refuses slides, drawing and chat until admin1 reactivates it", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana);
    const invite = inviteOf(link);
    expect(invite).toMatch(/^[\w-]+$/);
    const ben = await newPage(browser, contexts);
    await openLink(ben, link, "Ben");
    await send(ben, "before it went stale");
    await nextButton(ana).click();
    await nextButton(ana).click();
    for (const p of [ana, ben]) await expectSlide(p, 3);

    // Stale through the database, as the stale-session job would mark it.
    sql(`update presentation_session set stale_at = now() where invite_id = '${invite}'`);

    // Still connected, the server refuses all three: no slide change, no stroke reaches Ana,
    // and Ben's message is refused.
    await nextButton(ana).click();
    await drawButton(ben).click();
    await strokeAcrossText(ben);
    await messageInput(ben).fill("after it went stale");
    await messageInput(ben).press("Enter");
    await expect(ben.getByText("Messages can't be sent in a stale session.")).toBeVisible();
    await ana.waitForTimeout(500);
    for (const p of [ana, ben]) await expectSlide(p, 3);
    await expect(strokes(ana)).toHaveCount(0);
    await expect(messages(ana).getByText("after it went stale")).toHaveCount(0);
    expect(sql(`select slide from presentation_session where invite_id = '${invite}'`)).toBe("2");

    // Opened again: the last place, read-only, chat history kept, every control disabled.
    for (const p of [ana, ben]) {
      await p.reload();
      await expect(p.getByText(/gone stale/i)).toBeVisible();
      await expectSlide(p, 3);
      await expect(messages(p).getByText("before it went stale", { exact: true })).toBeVisible();
      await expect(messages(p).getByText("after it went stale")).toHaveCount(0);
      await expect(messageInput(p)).toBeDisabled();
      for (const control of [prevButton(p), nextButton(p), drawButton(p), clearButton(p)]) {
        await expect(control).toBeDisabled();
      }
      await expect(gifButton(p)).toHaveCount(0);
      await expect(p.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
    }
    // And nobody can join it: the socket is closed as stale (4410).
    expect(await socketCloseCode(ben, invite)).toBe(4410);

    // admin1 reactivates it.
    const admin = await signInAdmin(browser, contexts, keycloak, invite);
    await expect(admin.getByText(/gone stale/i)).toBeVisible();
    await admin.getByRole("button", { name: "Reactivate" }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: "Session reactivated" }),
    ).toBeVisible();
    // Signed in, admin1 is in at once, as admin1 (spec 012 FR-1).
    await expectJoinedSignedIn(admin, admin1Name(keycloak));
    expect(
      sql(`select stale_at is null from presentation_session where invite_id = '${invite}'`),
    ).toBe("t");

    // Everyone back, at the last place; all three work again.
    await reloadJoined(ana, "Ana");
    await expect(participants(ana)).toContainText("Ana (host) (you)");
    await reloadJoined(ben, "Ben");
    for (const p of [ana, ben, admin]) await expectSlide(p, 3);

    await nextButton(ana).click();
    for (const p of [ana, ben, admin]) await expectSlide(p, 4);

    await drawButton(ben).click();
    await expect(drawButton(ben)).toHaveAttribute("aria-pressed", "true");
    await strokeAcrossText(ben);
    for (const p of [ana, ben, admin]) await expect(strokes(p)).toHaveCount(1);

    await send(ben, "after reactivation");
    for (const p of [ana, admin]) {
      await expect(messages(p).getByText("after reactivation", { exact: true })).toBeVisible();
    }
  } finally {
    await closeAll(contexts);
  }
});

// --- AC-15h ----------------------------------------------------------------------------------

test.describe("AC-15h: chat", () => {
  test.beforeEach(async () => {
    await fakeGiphy.reset();
  });

  test.afterEach(async () => {
    await fakeGiphy.on();
  });

  test("AC-15h: Ben's text and GIF reach everyone, survive everyone reloading, and admin1 removes one", async ({
    browser,
    keycloak,
  }) => {
    await ensureLibrary(browser, keycloak);
    const contexts: BrowserContext[] = [];
    try {
      const ana = await newPage(browser, contexts);
      const link = await startFromLibrary(ana);
      const invite = inviteOf(link);
      const ben = await newPage(browser, contexts);
      await openLink(ben, link, "Ben");
      const cleo = await newPage(browser, contexts);
      await openLink(cleo, link, "Cleo");
      const everyone: [Page, string][] = [
        [ana, "Ana"],
        [ben, "Ben"],
        [cleo, "Cleo"],
      ];

      await send(ben, "packets go hop by hop");
      await postCat(ben, "Happy cat");
      // Ben's own page shows his messages as "You" (spec 012 FR-3), everyone else's as Ben.
      const seesBoth = async (p: Page) => {
        await expect(messages(p).getByText("packets go hop by hop", { exact: true })).toBeVisible();
        await expect(messages(p).getByRole("img", { name: "Happy cat" })).toBeVisible();
        await expect(messages(p).getByText("via GIPHY")).toBeVisible();
        await expect(messages(p).getByRole("heading").first()).toContainText(
          p === ben ? "You" : "Ben",
        );
      };
      for (const [p] of everyone) await seesBoth(p);

      // Everyone reloads: both are still there.
      for (const [p, name] of everyone) await reloadJoined(p, name);
      for (const [p] of everyone) await seesBoth(p);

      // admin1 removes the GIF; the text stays, for everyone and after a reload.
      const admin = await signInAdmin(browser, contexts, keycloak, invite);
      await expectJoinedSignedIn(admin, admin1Name(keycloak));
      await seesBoth(admin);
      await messages(admin)
        .locator("div")
        .filter({ has: admin.getByRole("img", { name: "Happy cat" }) })
        .getByRole("button", { name: /^Remove message from Ben at / })
        .click();
      for (const p of [ana, ben, cleo, admin]) {
        await expect(messages(p).getByRole("img", { name: "Happy cat" })).toHaveCount(0);
        await expect(messages(p).getByText("packets go hop by hop", { exact: true })).toBeVisible();
      }
      await reloadJoined(cleo, "Cleo");
      await expect(
        messages(cleo).getByText("packets go hop by hop", { exact: true }),
      ).toBeVisible();
      await expect(messages(cleo).getByRole("img", { name: "Happy cat" })).toHaveCount(0);
      // Removed for good in the database, too.
      expect(
        sql(
          "select count(*) from presentation_chat_message m join presentation_session s " +
            `on s.id = m.session_id where s.invite_id = '${invite}' and m.kind = 'gif' ` +
            "and m.removed_at is not null",
        ),
      ).toBe("1");
    } finally {
      await closeAll(contexts);
    }
  });
});

// --- AC-25 -----------------------------------------------------------------------------------

test("AC-25: a keyboard-only host reaches and uses ◀ ▶, Draw and Clear with Tab and the toolbar's arrows", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana);
    const ben = await newPage(browser, contexts);
    await openLink(ben, link, "Ben");
    await expectSlide(ana, 1);

    // From the top of the page, Tab until focus is in the toolbar (its one tab stop).
    await ana.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const inToolbar = () => toolbar(ana).evaluate((el) => el.contains(document.activeElement));
    for (let i = 0; i < 40 && !(await inToolbar()); i++) await ana.keyboard.press("Tab");
    expect(await inToolbar()).toBe(true);
    await expect(prevButton(ana)).toBeFocused();

    // ▶ then ◀, with Enter and Space.
    await ana.keyboard.press("ArrowRight");
    await expect(nextButton(ana)).toBeFocused();
    await ana.keyboard.press("Enter");
    for (const p of [ana, ben]) await expectSlide(p, 2);
    await ana.keyboard.press("Enter");
    for (const p of [ana, ben]) await expectSlide(p, 3);
    await ana.keyboard.press("ArrowLeft");
    await expect(prevButton(ana)).toBeFocused();
    await ana.keyboard.press("Space");
    for (const p of [ana, ben]) await expectSlide(p, 2);

    // Draw toggles on and off.
    await ana.keyboard.press("ArrowRight");
    await ana.keyboard.press("ArrowRight");
    await expect(drawButton(ana)).toBeFocused();
    await ana.keyboard.press("Space");
    await expect(drawButton(ana)).toHaveAttribute("aria-pressed", "true");
    await expect(ana.getByTestId("present-overlay")).toHaveAttribute("data-drawing");
    await ana.keyboard.press("Enter");
    await expect(drawButton(ana)).toHaveAttribute("aria-pressed", "false");

    // Ben draws; Ana clears it for everyone from the keyboard.
    await drawButton(ben).click();
    await strokeAcrossText(ben);
    for (const p of [ana, ben]) await expect(strokes(p)).toHaveCount(1);
    await ana.keyboard.press("ArrowRight");
    await expect(clearButton(ana)).toBeFocused();
    await ana.keyboard.press("Enter");
    for (const p of [ana, ben]) await expect(strokes(p)).toHaveCount(0);

    // The arrow shortcuts, with focus outside the toolbar.
    await ana.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await ana.keyboard.press("ArrowRight");
    for (const p of [ana, ben]) await expectSlide(p, 3);
    await ana.keyboard.press("End");
    for (const p of [ana, ben]) await expectSlide(p, 4);
    await ana.keyboard.press("Home");
    for (const p of [ana, ben]) await expectSlide(p, 1);
  } finally {
    await closeAll(contexts);
  }
});

test("AC-25: the session and library windows have no WCAG 2 AA violations", async ({
  browser,
  keycloak,
}) => {
  await ensureLibrary(browser, keycloak);
  const contexts: BrowserContext[] = [];
  try {
    const ana = await newPage(browser, contexts);
    const link = await startFromLibrary(ana);
    const ben = await newPage(browser, contexts);
    await openLink(ben, link, "Ben");
    await expectSlide(ana, 1);
    expect.soft(await violations(ana), "session, host").toEqual([]);
    await drawButton(ben).click();
    await expect(drawButton(ben)).toHaveAttribute("aria-pressed", "true");
    expect.soft(await violations(ben), "session, follower drawing").toEqual([]);

    await ana.goto(appUrl("/present"));
    await expect(ana.getByRole("button", { name: `Start session: ${DECK_TITLE}` })).toBeVisible();
    expect.soft(await violations(ana), "library").toEqual([]);
  } finally {
    await closeAll(contexts);
  }
});
