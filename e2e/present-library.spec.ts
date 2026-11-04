// Spec 013 (HTML presentations) end to end, the library and its editor sheet: an editor adds
// by file and by paste (AC-1), is told slides or single page before saving (AC-2), oversize
// and non-HTML uploads are refused and save nothing (AC-3), anyone filters by topic (AC-6),
// a non-editor and a signed-out visitor get no editor controls and the API refuses them
// (AC-7), and removing a presentation reaches a session that is open on it (AC-5).
// The fixture HTML is task 2's, linked from e2e/fixtures/presentations/.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
import { appPathname, appUrl, expect, signIn, sql, test } from "./fixtures";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "presentations");
const fixture = (name: string) => path.join(FIXTURES, name);

type Users = Record<string, { username: string; password: string }>;

interface Summary {
  id: string;
  title: string;
  topic: string;
  kind: "slides" | "page";
  slide_count: number;
}

const DNS = "Intro to DNS";
const COMPOSE = "Compose basics";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // Earlier specs on the same stack may have added presentations; start from an empty
  // library so "listed" and "unchanged" mean exactly what this spec added.
  sql(
    "update presentation set removed_at = now(), removed_by_sub = 'e2e' where removed_at is null",
  );
});

function user(users: Users, name: string): { username: string; password: string } {
  const found = users[name];
  if (!found) throw new Error(`no keycloak test user '${name}'`);
  return found;
}

async function openLibrary(browser: Browser, users: Users | null, name?: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  if (users && name) {
    const { username, password } = user(users, name);
    await signIn(page, username, password, "/present");
  } else {
    await page.goto(appUrl("/present"));
  }
  await expect(page.getByRole("heading", { name: "Present", level: 1 })).toBeVisible();
  return page;
}

async function library(request: APIRequestContext): Promise<Summary[]> {
  const res = await request.get(appUrl("/api/present/presentations"));
  expect(res.ok()).toBe(true);
  return (await res.json()) as Summary[];
}

const table = (page: Page) => page.getByRole("table");
const row = (page: Page, title: string) =>
  table(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: title }) });

/** Opens the add sheet and fills title and topic. */
async function addSheet(page: Page, title: string, topic: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add presentation" }).click();
  const sheet = page.locator("dialog[open]");
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Title", { exact: true }).fill(title);
  await sheet.getByLabel("Topic", { exact: true }).fill(topic);
  return sheet;
}

async function check(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: "Check" }).click();
}

async function save(page: Page, sheet: Locator): Promise<void> {
  const saved = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.endsWith("/api/present/presentations") &&
      res.request().method() === "POST",
  );
  await sheet.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(201);
  await expect(sheet).toHaveCount(0);
}

test("AC-1, AC-2: an editor adds by file and by paste, told slides or single page first", async ({
  browser,
  keycloak,
}) => {
  const page = await openLibrary(browser, keycloak.users, "editor1");

  // By file: four <section> children of <body>.
  let sheet = await addSheet(page, DNS, "Networking");
  await sheet.getByLabel("HTML file").setInputFiles(fixture("four-sections.html"));
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
  await check(sheet);
  await expect(sheet).toContainText("4 slides");
  await save(page, sheet);

  // By paste: no slide marks, so a single page.
  sheet = await addSheet(page, COMPOSE, "Docker");
  await sheet.getByRole("radio", { name: "Paste" }).click();
  await sheet
    .getByLabel("HTML", { exact: true })
    .fill(readFileSync(fixture("single-page.html"), "utf-8"));
  await check(sheet);
  await expect(sheet).toContainText(/single page/i);
  await save(page, sheet);

  for (const p of [page, await openLibrary(browser, null)]) {
    await expect(row(p, DNS)).toContainText("Networking");
    await expect(row(p, DNS)).toContainText("4 slides");
    await expect(row(p, COMPOSE)).toContainText("Docker");
    await expect(row(p, COMPOSE)).toContainText(/single page/i);
  }
  const listed = await library(page.request);
  expect(listed.map((p) => [p.title, p.topic, p.kind, p.slide_count]).sort()).toEqual([
    [COMPOSE, "Docker", "page", 0],
    [DNS, "Networking", "slides", 4],
  ]);
});

test("AC-3: a 6 MB file and a PNG renamed to .html are refused; the library is unchanged", async ({
  browser,
  keycloak,
}) => {
  const page = await openLibrary(browser, keycloak.users, "editor1");
  const before = await library(page.request);

  // Valid HTML, just too big: the size alone refuses it.
  const big = Buffer.from(
    `<!doctype html><html><body><p>${"x".repeat(6 * 1024 * 1024)}</p></body></html>`,
  );
  const sheet = await addSheet(page, "Too big", "Networking");
  await sheet
    .getByLabel("HTML file")
    .setInputFiles({ name: "big.html", mimeType: "text/html", buffer: big });
  await check(sheet);
  await expect(sheet).toContainText("5 MB limit");
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();

  await sheet.getByLabel("HTML file").setInputFiles(fixture("png-renamed.html"));
  await check(sheet);
  await expect(sheet).toContainText("That file isn't HTML.");
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);

  // Straight to the API as well: the server refuses what the sheet never sends.
  const direct = await page.request.post(
    appUrl("/api/present/presentations?title=Too%20big&topic=Networking"),
    { headers: { "Content-Type": "text/html" }, data: big },
  );
  expect(direct.status()).toBe(413);
  expect(await direct.json()).toMatchObject({ error: "too_large", limit_bytes: 5 * 1024 * 1024 });

  expect(await library(page.request)).toEqual(before);
  await page.reload();
  await expect(row(page, DNS)).toBeVisible();
  await expect(table(page).getByRole("row")).toHaveCount(before.length + 1); // + header
});

test("AC-6: anyone filters the library by topic", async ({ browser }) => {
  const page = await openLibrary(browser, null);
  const topics = page.getByRole("listbox", { name: "Topics" });
  await topics.getByRole("option", { name: "Docker" }).click();
  await expect(topics.getByRole("option", { name: "Docker" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(row(page, COMPOSE)).toContainText("Docker");
  await expect(row(page, DNS)).toHaveCount(0);
  await expect(table(page).getByRole("row")).toHaveCount(2); // header + Compose basics

  await topics.getByRole("option", { name: "All" }).click();
  await expect(row(page, DNS)).toContainText("Networking");
});

test("AC-7: a non-editor and a signed-out visitor get no editor controls; the API refuses them", async ({
  browser,
  keycloak,
}) => {
  const editor = await openLibrary(browser, keycloak.users, "editor1");
  const before = await library(editor.request);
  const target = before.find((p) => p.title === DNS);
  if (!target) throw new Error("no presentation from AC-1");
  const html = Buffer.from("<!doctype html><html><body><section>One</section></body></html>");

  for (const [who, page, status] of [
    ["plain1", await openLibrary(browser, keycloak.users, "plain1"), 403],
    ["signed out", await openLibrary(browser, null), 401],
  ] as const) {
    await expect(row(page, DNS), who).toBeVisible();
    await expect(row(page, DNS).getByRole("button", { name: /^Start session/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add presentation" }), who).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Replace HTML|Remove):/ }), who).toHaveCount(0);

    const raw = { headers: { "Content-Type": "text/html" }, data: html };
    const refused = [
      await page.request.post(appUrl("/api/present/analyze"), raw),
      await page.request.post(appUrl("/api/present/presentations?title=Sneaky&topic=Docker"), raw),
      await page.request.put(appUrl(`/api/present/presentations/${target.id}/html`), raw),
      await page.request.delete(appUrl(`/api/present/presentations/${target.id}`)),
    ];
    expect(
      refused.map((r) => r.status()),
      who,
    ).toEqual([status, status, status, status]);
  }

  expect(await library(editor.request)).toEqual(before);
});

test("AC-5: removing a presentation shows 'no longer available' in its open session", async ({
  browser,
  keycloak,
}) => {
  const editor = await openLibrary(browser, keycloak.users, "editor1");
  const title = "Removable deck";
  const added = await editor.request.post(
    appUrl(`/api/present/presentations?title=${encodeURIComponent(title)}&topic=Docker`),
    {
      headers: { "Content-Type": "text/html" },
      data: readFileSync(fixture("four-data-slides.html")),
    },
  );
  expect(added.status()).toBe(201);
  await editor.reload();

  // Someone starts a session from the library and is in it.
  const viewer = await openLibrary(browser, null);
  await row(viewer, title)
    .getByRole("button", { name: `Start session: ${title}` })
    .click();
  await viewer.waitForURL((url) => appPathname(url).startsWith("/present/s/"));
  await viewer.getByLabel("Your name").fill("Ana");
  await viewer.getByRole("button", { name: "Join" }).click();
  await expect(viewer.getByRole("list", { name: "Participants" })).toContainText("Ana");
  await expect(viewer.locator("iframe")).toBeVisible();

  await row(editor, title)
    .getByRole("button", { name: `Remove: ${title}` })
    .click();
  const sheet = editor.locator("dialog[open]");
  await sheet.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row(editor, title)).toHaveCount(0);
  expect((await library(editor.request)).map((p) => p.title)).not.toContain(title);

  await expect(viewer.getByText("This presentation is no longer available")).toBeVisible();
  await expect(viewer.locator("iframe")).toHaveCount(0);
  // Coming back to the session later shows the same.
  await viewer.reload();
  await expect(viewer.getByText("This presentation is no longer available")).toBeVisible();
});
