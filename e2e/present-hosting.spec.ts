// Spec 013 task 28: hosting a presentation session end to end, on the production compose stack
// with its real host grace, shortened to 10 s for e2e (plan.md "Hosting"). Each participant is a separate browser
// context; closing a tab is page.close() and reopening is a new page in the same context, so
// the rejoin token in localStorage brings the same participant back (FR-16, FR-28).
// Covers AC-15 (host away, returns within the grace), AC-15b (hand-over), AC-15c (host gone
// for the grace: the longest-connected participant hosts — one test, ~grace real time),
// AC-15e (the former host returns as a follower) and AC-15f (everyone leaves, a newcomer
// within the grace sees the last slide and the host). AC-15d stays at integration level
// (test_present_hosting.py), which avoids a second wait.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { appUrl, expect, openContexts, REPO_ROOT, signIn, test } from "./fixtures";

const DECK = readFileSync(
  path.join(REPO_ROOT, "backend/tests/fixtures/presentations/four-data-slides.html"),
  "utf-8",
);
const SLIDES = 4;
/**
 * The stack's host grace (Settings.present_host_grace_seconds): global-setup.ts writes 10 s to
 * .env so this test need not wait the production default of 60 s.
 */
const GRACE_MS =
  Number(/^PRESENT_HOST_GRACE_SECONDS=(\d+(?:\.\d+)?)$/m.exec(readFileSync(path.join(REPO_ROOT, ".env"), "utf-8"))?.[1] ?? 60) * 1000;

/** An editor adds the four-slide deck; anyone then starts a session on it. Returns the invite. */
async function startSession(
  browser: Browser,
  request: APIRequestContext,
  editor: { username: string; password: string },
  title: string,
): Promise<string> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, editor.username, editor.password);
  const params = new URLSearchParams({ title, topic: "Hosting" });
  const added = await page.request.post(appUrl(`/api/present/presentations?${params}`), {
    data: DECK,
    headers: { "content-type": "text/html" },
  });
  expect(added.status()).toBe(201);
  const { id } = (await added.json()) as { id: string };
  await context.close();
  const started = await request.post(appUrl("/api/present/sessions"), {
    data: { presentation_id: id },
  });
  expect(started.status()).toBe(201);
  return ((await started.json()) as { invite_id: string }).invite_id;
}

const participants = (page: Page) =>
  page.getByRole("list", { name: "Participants" }).getByRole("listitem");
const nextButton = (page: Page) => page.getByRole("button", { name: "Next slide" });
const prevButton = (page: Page) => page.getByRole("button", { name: "Previous slide" });
const awayBanner = (page: Page, name: string) => page.getByText(`${name} (host) is away.`);

/** Opens the invite and joins under `name`; returns once this participant is in the list. */
async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/present/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(participants(page).filter({ hasText: "(you)" })).toHaveText(
    new RegExp(`^${name}\\b`),
  );
}

/** Reopens the session in a new tab of the same browser: the stored identity rejoins it. */
async function reopen(context: BrowserContext, invite: string, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(appUrl(`/present/s/${invite}`));
  await expect(participants(page).filter({ hasText: "(you)" })).toHaveText(
    new RegExp(`^${name}\\b`),
  );
  return page;
}

async function joinAll(browser: Browser, invite: string, names: string[]): Promise<Page[]> {
  const contexts = await openContexts(browser, names.length);
  const pages: Page[] = [];
  // In order: the first to connect hosts (FR-8), and order of joining decides FR-26.
  for (const [i, context] of contexts.entries()) {
    const page = await context.newPage();
    await join(page, invite, names[i] ?? "");
    pages.push(page);
  }
  return pages;
}

/** The page shows slide `n` (1-based): in the toolbar and in the presentation itself. */
async function expectSlide(page: Page, n: number): Promise<void> {
  await expect(page.getByText(`${n} / ${SLIDES}`, { exact: true })).toBeVisible();
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("heading", { name: `Slide ${n}` })).toBeVisible();
  for (let other = 1; other <= SLIDES; other++) {
    if (other !== n)
      await expect(frame.getByRole("heading", { name: `Slide ${other}` })).toBeHidden();
  }
}

/** `name` is marked host in this page's participants list. */
async function expectHost(page: Page, name: string, timeout?: number): Promise<void> {
  await expect(participants(page).filter({ hasText: "(host)" })).toHaveText(
    new RegExp(`^${name} \\(host\\)`),
    { timeout },
  );
}

/** Nothing this page does changes the slide: buttons disabled, shortcuts ignored. */
async function expectCannotLead(page: Page, slide: number): Promise<void> {
  await expect(nextButton(page)).toBeDisabled();
  await expect(prevButton(page)).toBeDisabled();
  await page.locator("body").press("ArrowRight");
  await page.waitForTimeout(300);
  await expectSlide(page, slide);
}

async function closeAll(pages: Page[]): Promise<void> {
  for (const page of pages) await page.context().close();
}

test("AC-15: the host closes the tab, followers stay and are told; she returns within the grace and still hosts", async ({
  browser,
  request,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  if (!editor) throw new Error("no editor1 test user");
  const invite = await startSession(browser, request, editor, `Hosting away ${Date.now()}`);
  const [ana, ben] = await joinAll(browser, invite, ["Ana", "Ben"]);
  if (!ana || !ben) throw new Error("participants missing");
  try {
    await expectHost(ben, "Ana");
    await nextButton(ana).click();
    await expectSlide(ben, 2);

    const anaContext = ana.context();
    await ana.close();
    await expect(awayBanner(ben, "Ana")).toBeVisible();
    await expectSlide(ben, 2);

    const back = await reopen(anaContext, invite, "Ana");
    await expectHost(back, "Ana");
    await expectHost(ben, "Ana");
    await expect(awayBanner(ben, "Ana")).toHaveCount(0);
    await expectSlide(back, 2);
    await nextButton(back).click();
    await expectSlide(back, 3);
    await expectSlide(ben, 3);
  } finally {
    for (const context of browser.contexts()) await context.close();
  }
});

test("AC-15b, AC-15f: hand-over to Cleo; Ana can no longer lead; a newcomer after everyone leaves sees slide 3 and Cleo as host", async ({
  browser,
  request,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  if (!editor) throw new Error("no editor1 test user");
  const invite = await startSession(browser, request, editor, `Hosting hand-over ${Date.now()}`);
  const pages = await joinAll(browser, invite, ["Ana", "Ben", "Cleo"]);
  const [ana, ben, cleo] = pages;
  if (!ana || !ben || !cleo) throw new Error("participants missing");
  try {
    await nextButton(ana).click();
    for (const page of pages) await expectSlide(page, 2);

    await ana.getByRole("button", { name: "Hand over…" }).click();
    await ana.getByRole("button", { name: "Cleo", exact: true }).click();
    for (const page of pages) {
      await expectHost(page, "Cleo");
      await expectSlide(page, 2);
    }
    await expect(ana.getByRole("button", { name: "Hand over…" })).toHaveCount(0);
    await expectCannotLead(ana, 2);
    for (const page of pages) await expectSlide(page, 2);

    await nextButton(cleo).click();
    for (const page of pages) await expectSlide(page, 3);

    // AC-15f: everyone leaves; Dana opens the invite within the grace (plan.md "Hosting").
    await closeAll(pages);
    const [dana] = await joinAll(browser, invite, ["Dana"]);
    if (!dana) throw new Error("Dana missing");
    await expectSlide(dana, 3);
    await expect(awayBanner(dana, "Cleo")).toBeVisible();
    await expectCannotLead(dana, 3);
    await closeAll([dana]);
  } finally {
    for (const context of browser.contexts()) await context.close();
  }
});

test.describe("host gone for the grace", () => {
  // The one real-time wait: the stack's host grace (AC-15c).
  test.describe.configure({ timeout: GRACE_MS + 20_000 });

  test("AC-15c, AC-15e: after the grace Ben (joined first) hosts and the place is kept; Ana returns as a follower", async ({
    browser,
    request,
    keycloak,
  }) => {
    const editor = keycloak.users.editor1;
    if (!editor) throw new Error("no editor1 test user");
    const invite = await startSession(browser, request, editor, `Hosting timeout ${Date.now()}`);
    const [ana, ben, cleo] = await joinAll(browser, invite, ["Ana", "Ben", "Cleo"]);
    if (!ana || !ben || !cleo) throw new Error("participants missing");
    try {
      await nextButton(ana).click();
      await expectSlide(ben, 2);
      await expectSlide(cleo, 2);

      const anaContext = ana.context();
      const left = Date.now();
      await ana.close();
      for (const page of [ben, cleo]) await expect(awayBanner(page, "Ana")).toBeVisible();

      // Not before the grace is up ...
      await ben.waitForTimeout(Math.max(0, GRACE_MS - 5_000 - (Date.now() - left)));
      for (const page of [ben, cleo]) await expect(awayBanner(page, "Ana")).toBeVisible();
      // ... and then Ben, who joined first after Ana, hosts; everyone stays on slide 2.
      await expectHost(ben, "Ben", 20_000);
      expect(Date.now() - left).toBeGreaterThanOrEqual(GRACE_MS - 1_000);
      for (const page of [ben, cleo]) {
        await expectHost(page, "Ben");
        await expect(awayBanner(page, "Ana")).toHaveCount(0);
        await expectSlide(page, 2);
      }
      await expect(nextButton(ben)).toBeEnabled();
      await expectCannotLead(cleo, 2);

      // AC-15e: Ana comes back as a participant following Ben.
      const back = await reopen(anaContext, invite, "Ana");
      await expectHost(back, "Ben");
      await expectSlide(back, 2);
      await expectCannotLead(back, 2);
      await nextButton(ben).click();
      for (const page of [back, ben, cleo]) await expectSlide(page, 3);
    } finally {
      for (const context of browser.contexts()) await context.close();
    }
  });
});
