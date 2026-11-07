// Spec 007 (chat GIF search) end to end, against the real stack with docker-compose.test.yml's
// fake GIPHY as the GIF service: the third-party notice before any search (FR-5), searching
// (FR-1), posting (FR-3) to everyone (FR-4), durable (FR-6), admin removal (FR-7), stale
// sessions (FR-8), the service down (FR-9), attribution (FR-11), a GIF gone from the service
// (FR-12) and no referrer on media loads (NFR-1). The fake answers "cat" with its cat set
// (one of them R-rated, which the backend drops) and its media URLs point at itself.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Browser, Locator, Page, Request } from "@playwright/test";
import {
  appPathname,
  appUrl,
  createSession as createSessionOn,
  expect,
  fakeGiphy,
  markStale,
  openContexts,
  signIn,
  test,
} from "./fixtures";

const FIRST = "Sum Two Numbers";
/** Where the fake's fixture media live, as the browser loads them (docker-compose.test.yml). */
const MEDIA_ORIGIN = `http://127.0.0.1:${process.env.TEST_GIPHY_PORT ?? "58280"}`;

const createSession = (request: APIRequestContext) => createSessionOn(request, FIRST);

/** Joins the session (already on its page, or going there); the chat is beside the description. */
async function joinChat(page: Page, invite: string, name: string): Promise<void> {
  if (appPathname(page.url()) !== `/s/${invite}`) await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/** Signed in, the page joins by itself under the account name, with no prompt (spec 012 FR-1). */
async function expectAutoJoined(page: Page): Promise<void> {
  await expect(page.locator(".cm-content")).toContainText("pass");
  await expect(page.getByLabel("Your name")).toHaveCount(0);
}

async function participants(browser: Browser, invite: string, names: string[]): Promise<Page[]> {
  const contexts = await openContexts(browser, names.length);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const [i, page] of pages.entries()) await joinChat(page, invite, names[i] ?? "");
  return pages;
}

const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const messageInput = (page: Page) => chat(page).getByLabel("Message", { exact: true });
const messages = (page: Page) => chat(page).getByRole("list", { name: "Messages" });
const groups = (page: Page) => messages(page).getByRole("listitem");
const gifButton = (page: Page) => chat(page).getByRole("button", { name: "GIF", exact: true });
const results = (page: Page) => chat(page).getByRole("listbox", { name: "GIFs" });

async function send(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await messageInput(page).press("Enter");
  await expect(messages(page).getByText(text, { exact: true })).toBeVisible();
}

/** Opens the picker, accepts the first-time notice if shown, and searches `term`. */
async function search(page: Page, term: string): Promise<void> {
  await gifButton(page).click();
  const proceed = chat(page).getByRole("button", { name: "Continue" });
  if (await proceed.isVisible()) await proceed.click();
  await chat(page).getByLabel("Search GIFs").fill(term);
}

/** Searches "cat" and picks the result titled `title`. */
async function postCat(page: Page, title: string): Promise<void> {
  await search(page, "cat");
  await results(page).getByRole("option", { name: title, exact: true }).click();
  await expect(results(page)).toHaveCount(0);
}

async function closeAll(pages: Page[]): Promise<void> {
  for (const page of pages) await page.context().close();
}

test.beforeEach(async () => {
  await fakeGiphy.reset();
});

test.afterEach(async () => {
  await fakeGiphy.on();
});

test("task 21: the fake GIPHY's control helper records requests and switches off and on", async () => {
  expect(await fakeGiphy.requests()).toEqual([]);
  const search = await fetch(`${MEDIA_ORIGIN}/v1/gifs/search?api_key=k&q=cat`);
  expect(search.status).toBe(200);
  expect((await fakeGiphy.requests()).map((r) => [r.path, r.query.q])).toEqual([
    ["/v1/gifs/search", "cat"],
  ]);

  await fakeGiphy.off();
  await expect(fetch(`${MEDIA_ORIGIN}/v1/gifs/trending?api_key=k`)).rejects.toThrow();
  await fakeGiphy.on();
  expect((await fetch(`${MEDIA_ORIGIN}/v1/gifs/trending?api_key=k`)).status).toBe(200);
  expect(await fakeGiphy.requests()).toHaveLength(2);
});

test("FR-5, FR-1, FR-11: the notice comes before any search; then 'cat' shows results 'Powered by GIPHY'", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada] = await participants(browser, invite, ["Ada"]);
  if (!ada) throw new Error("no participant");

  await gifButton(ada).click();
  await expect(
    chat(ada).getByText(/sends your search terms to GIPHY, a third-party service/),
  ).toBeVisible();
  await expect(chat(ada).getByLabel("Search GIFs")).toHaveCount(0);
  // The notice has been on screen; nothing has reached the GIF service.
  await ada.waitForTimeout(500);
  expect((await fakeGiphy.requests()).filter((r) => r.path.startsWith("/v1/"))).toEqual([]);

  await chat(ada).getByRole("button", { name: "Continue" }).click();
  await chat(ada).getByLabel("Search GIFs").fill("cat");
  for (const title of ["Happy cat", "Sleepy cat", "Cat dance"]) {
    await expect(results(ada).getByRole("option", { name: title, exact: true })).toBeVisible();
  }
  await expect(results(ada).getByRole("option", { name: "Rude cat" })).toHaveCount(0);
  await expect(chat(ada).getByText("Powered by GIPHY")).toBeVisible();

  const searches = (await fakeGiphy.requests()).filter((r) => r.path === "/v1/gifs/search");
  expect(searches.at(-1)?.query).toMatchObject({ q: "cat", rating: "pg-13" });
  await closeAll([ada]);
});

test("FR-3, FR-4, FR-6, FR-11, NFR-1: Ada's GIF reaches the others last, survives reload, and media load with no Referer", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada, ben, cy] = await participants(browser, invite, ["Ada", "Ben", "Cy"]);
  if (!ada || !ben || !cy) throw new Error("no participants");
  const media: Request[] = [];
  for (const page of [ada, ben, cy]) {
    page.on("request", (r) => {
      if (r.url().startsWith(`${MEDIA_ORIGIN}/media/`)) media.push(r);
    });
  }

  await send(ben, "before one");
  await send(cy, "before two");
  await postCat(ada, "Happy cat");

  // FR-3: Ada's own row is hers ("You" on her own screen, spec 012 FR-3), with the time and
  // the image, credited (FR-11).
  const own = groups(ada).last();
  await expect(own.getByRole("heading")).toContainText("You");
  await expect(own.getByRole("heading").locator("time")).toHaveText(/\d{1,2}[:.]\d{2}/);
  await expect(own.getByRole("img", { name: "Happy cat" })).toBeVisible();
  await expect(own.getByText("via GIPHY")).toBeVisible();

  // FR-4: the other two see it without reloading, after the messages before it.
  for (const page of [ben, cy]) {
    const last = groups(page).last();
    await expect(last.getByRole("img", { name: "Happy cat" })).toBeVisible();
    await expect(last.getByRole("heading")).toContainText("Ada");
    await expect(last.getByText("via GIPHY")).toBeVisible();
    await expect(groups(page)).toHaveCount(3);
    await expect(groups(page).nth(0)).toContainText("before one");
    await expect(groups(page).nth(1)).toContainText("before two");
  }
  const image = groups(ben).last().getByRole("img", { name: "Happy cat" });
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  // FR-6: after a reload it is still there, in its position.
  await ben.reload();
  await joinChat(ben, invite, "Ben");
  await expect(groups(ben)).toHaveCount(3);
  await expect(groups(ben).nth(0)).toContainText("before one");
  await expect(groups(ben).nth(1)).toContainText("before two");
  await expect(groups(ben).nth(2).getByRole("img", { name: "Happy cat" })).toBeVisible();

  // NFR-1: no media request carried a Referer, as the browser sent it and as the fake saw it.
  expect(media.length).toBeGreaterThan(0);
  // Chromium reports a suppressed referrer to Playwright as an empty header; the fake, below,
  // shows nothing went over the wire.
  for (const r of media) expect((await r.allHeaders()).referer ?? "").toBe("");
  const served = (await fakeGiphy.requests()).filter((r) => r.path.startsWith("/media/"));
  expect(served.length).toBeGreaterThan(0);
  for (const r of served) {
    expect(r.headers).not.toHaveProperty("referer");
    expect(JSON.stringify(r)).not.toContain(invite);
  }
  await closeAll([ada, ben, cy]);
});

test("FR-7: an admin removes a GIF; it is gone for everyone and after reload", async ({
  browser,
  request,
  keycloak,
}) => {
  const admin = keycloak.users.admin1;
  if (!admin) throw new Error("no keycloak test user 'admin1'");
  const invite = await createSession(request);
  const [ada, ben] = await participants(browser, invite, ["Ada", "Ben"]);
  if (!ada || !ben) throw new Error("no participants");
  await send(ben, "keep me");
  await postCat(ada, "Sleepy cat");

  const [adminContext] = await openContexts(browser, 1);
  if (!adminContext) throw new Error("no browser context");
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, admin.username, admin.password, `/s/${invite}`);
  await expectAutoJoined(adminPage);
  const gifGroup = groups(adminPage).filter({
    has: adminPage.getByRole("img", { name: "Sleepy cat" }),
  });
  await gifGroup.getByRole("button", { name: /^Remove message from Ada at / }).click();

  for (const page of [ada, ben, adminPage]) {
    await expect(messages(page).getByRole("img", { name: "Sleepy cat" })).toHaveCount(0);
    await expect(messages(page).getByText("keep me", { exact: true })).toBeVisible();
  }
  await ada.reload();
  await joinChat(ada, invite, "Ada");
  await expect(messages(ada).getByText("keep me", { exact: true })).toBeVisible();
  await expect(messages(ada).getByRole("img", { name: "Sleepy cat" })).toHaveCount(0);
  await closeAll([ada, ben, adminPage]);
});

test("FR-8: a stale session shows its GIF and offers no GIF button", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada] = await participants(browser, invite, ["Ada"]);
  if (!ada) throw new Error("no participant");
  await postCat(ada, "Cat dance");
  await expect(messages(ada).getByRole("img", { name: "Cat dance" })).toBeVisible();

  markStale(invite);
  await ada.reload();
  await expect(ada.getByText(/gone stale/i)).toBeVisible();
  await expect(messageInput(ada)).toBeDisabled();
  await expect(messages(ada).getByRole("img", { name: "Cat dance" })).toBeVisible();
  await expect(messages(ada).getByText("via GIPHY")).toBeVisible();
  await expect(gifButton(ada)).toHaveCount(0);
  await closeAll([ada]);
});

test("FR-9: with the GIF service down, search says it is unavailable and text chat still works", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada, ben] = await participants(browser, invite, ["Ada", "Ben"]);
  if (!ada || !ben) throw new Error("no participants");

  await fakeGiphy.off();
  await search(ada, "cat");
  await expect(
    chat(ada).getByRole("status").filter({ hasText: "GIF search unavailable" }),
  ).toBeVisible();
  await expect(results(ada).getByRole("option")).toHaveCount(0);

  await chat(ada).getByLabel("Search GIFs").press("Escape");
  await send(ada, "still talking");
  await expect(messages(ben).getByText("still talking", { exact: true })).toBeVisible();
  await closeAll([ada, ben]);
});

test("FR-12: a GIF the service no longer serves shows a placeholder in its place, author and time kept", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada, ben] = await participants(browser, invite, ["Ada", "Ben"]);
  if (!ada || !ben) throw new Error("no participants");
  await send(ben, "first");
  await search(ada, "cat");
  // The fake's broken-media item: its media URLs are 404 paths, so it already fails to load.
  await results(ada).getByRole("option").filter({ hasText: "GIF no longer available" }).click();
  await expect(results(ada)).toHaveCount(0);
  await expect(groups(ben)).toHaveCount(2);
  await send(ben, "last");

  await ben.reload();
  await joinChat(ben, invite, "Ben");
  await expect(groups(ben)).toHaveCount(3);
  await expect(groups(ben).nth(0)).toContainText("first");
  const gone = groups(ben).nth(1);
  await expect(gone.getByRole("heading")).toContainText("Ada");
  await expect(gone.getByRole("heading").locator("time")).toHaveText(/\d{1,2}[:.]\d{2}/);
  await expect(gone.getByText("GIF no longer available")).toBeVisible();
  await expect(groups(ben).nth(2)).toContainText("last");
  await closeAll([ada, ben]);
});

// Task 23 (NFR-6): keyboard only, WCAG AA, reduced motion.

const continueButton = (page: Page) => chat(page).getByRole("button", { name: "Continue" });

test("NFR-6: with the keyboard alone a participant opens the picker, searches, moves through results and posts one", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada, ben] = await participants(browser, invite, ["Ada", "Ben"]);
  if (!ada || !ben) throw new Error("no participants");

  // From here on, keys only: Tab from the message field to the GIF button.
  await messageInput(ada).focus();
  await ada.keyboard.press("Tab");
  await expect(gifButton(ada)).toBeFocused();
  await ada.keyboard.press("Enter");
  await expect(continueButton(ada)).toBeFocused();
  await ada.keyboard.press("Enter");
  const field = chat(ada).getByLabel("Search GIFs");
  await expect(field).toBeFocused();
  await ada.keyboard.type("cat");
  await expect(results(ada).getByRole("option", { name: "Cat dance", exact: true })).toBeVisible();

  await ada.keyboard.press("ArrowDown");
  await expect(results(ada)).toBeFocused();
  await ada.keyboard.press("ArrowRight");
  const active = await results(ada).getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(results(ada).locator(`[id="${active}"]`)).toHaveAccessibleName("Sleepy cat");
  await expect(
    results(ada).getByRole("option", { name: "Sleepy cat", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await ada.keyboard.press("Enter");

  await expect(results(ada)).toHaveCount(0);
  await expect(gifButton(ada)).toBeFocused();
  for (const page of [ada, ben]) {
    await expect(groups(page).last().getByRole("img", { name: "Sleepy cat" })).toBeVisible();
  }

  // Reopened (the notice is not shown again), Escape closes and focus is back on GIF.
  await ada.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await ada.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(gifButton(ada)).toBeFocused();
  await expect(gifButton(ada)).toHaveAttribute("aria-expanded", "false");
  await closeAll([ada, ben]);
});

test("NFR-6: the open picker, notice and results, has no WCAG AA violations", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const [ada] = await participants(browser, invite, ["Ada"]);
  if (!ada) throw new Error("no participant");

  async function violations(): Promise<string[]> {
    if (!ada) return [];
    await ada.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY).map((a) => a.finished.catch(() => undefined))));
    // The Chat region holding the picker; the code editor beside it is spec 003's concern.
    const axe = await new AxeBuilder({ page: ada })
      .include('[aria-label="Inspector"] section[aria-label="Chat"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return axe.violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id} ${n.target.join(" ")}: ${n.failureSummary}`),
    );
  }

  await gifButton(ada).click();
  await expect(continueButton(ada)).toBeVisible();
  expect.soft(await violations(), "notice").toEqual([]);

  await continueButton(ada).click();
  await chat(ada).getByLabel("Search GIFs").fill("cat");
  await expect(results(ada).getByRole("option", { name: "Happy cat", exact: true })).toBeVisible();
  await expect(chat(ada).getByText("Powered by GIPHY")).toBeVisible();
  expect.soft(await violations(), "results").toEqual([]);

  // With a result active, too.
  await chat(ada).getByLabel("Search GIFs").press("ArrowDown");
  await expect(results(ada)).toBeFocused();
  expect.soft(await violations(), "results, one active").toEqual([]);
  await closeAll([ada]);
});

test("NFR-6: with reduced motion on, GIFs show their still frame in the picker and in chat", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const ada = await context.newPage();
  await joinChat(ada, invite, "Ada");
  const still = `${MEDIA_ORIGIN}/media/cat-1/200w_s.gif`;
  const currentSrc = (img: Locator) =>
    img.evaluate((el: HTMLImageElement) => el.currentSrc);

  await search(ada, "cat");
  const option = results(ada).getByRole("option", { name: "Happy cat", exact: true });
  await expect(option).toBeVisible();
  await expect.poll(() => currentSrc(option.getByRole("img"))).toBe(still);

  await option.click();
  await expect(results(ada)).toHaveCount(0);
  const posted = groups(ada).last().getByRole("img", { name: "Happy cat" });
  await expect(posted).toBeVisible();
  await expect.poll(() => currentSrc(posted)).toBe(still);
  await closeAll([ada]);
});
