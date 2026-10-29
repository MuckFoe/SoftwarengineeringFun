// Spec 002 FR2–FR6 and NFR Readability: an editor writes a formatted description with an
// image in the problem editor sheet, and participants see it rendered beside the shared
// editor. Runs against the production stack and the test Keycloak, as the seeded editor.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function signIn(page: Page, username: string, password: string, next = "/"): Promise<void> {
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => url.pathname === next);
}

async function signInAsEditor(
  page: Page,
  users: Record<string, { username: string; password: string }>,
): Promise<void> {
  const editor = users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  await signIn(page, editor.username, editor.password);
}

// A 1×1 PNG; the server decides the format from these bytes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Opens the new-problem sheet and fills everything but the description. */
async function newProblem(page: Page, title: string): Promise<Locator> {
  await page.getByRole("button", { name: "New problem" }).click();
  const sheet = page.locator("dialog[open]");
  await sheet.getByLabel("Title", { exact: true }).fill(title);
  await sheet.getByLabel("Signature", { exact: true }).fill("def add(a: int, b: int) -> int");
  await sheet.getByLabel("Test 1 args", { exact: true }).fill("[1, 2]");
  await sheet.getByLabel("Test 1 expected", { exact: true }).fill("3");
  return sheet;
}

async function create(page: Page, sheet: Locator): Promise<void> {
  const saved = page.waitForResponse(
    (res) => res.url().endsWith("/api/problems") && res.request().method() === "POST",
  );
  await sheet.getByRole("button", { name: "Create" }).click();
  expect((await saved).status()).toBe(201);
  await expect(sheet).toHaveCount(0);
}

async function problemId(page: Page, title: string): Promise<string> {
  const found = await page.request.get(`/api/problems?q=${encodeURIComponent(title)}`);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === title);
  if (!problem) throw new Error(`no problem titled ${title}`);
  return problem.id;
}

/** Starts a session on the problem and joins it as Ana in a separate browser. */
async function joinSessionOn(
  page: Page,
  id: string,
  viewport = { width: 1280, height: 800 },
): Promise<Page> {
  const created = await page.request.post("/api/sessions", { data: { problem_id: id } });
  expect(created.status()).toBe(201);
  const { invite_id } = (await created.json()) as { invite_id: string };
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser");
  const participant = await (await browser.newContext({ viewport })).newPage();
  await participant.goto(`/s/${invite_id}`);
  await participant.getByLabel("Your name").fill("Ana");
  await participant.getByRole("button", { name: "Join" }).click();
  await expect(participant.locator(".cm-content")).toContainText("pass");
  return participant;
}

const descriptionPanel = (p: Page) =>
  p.getByRole("complementary", { name: "Inspector" }).getByRole("tabpanel", { name: "Description" });

const CODE_BLOCK = "def f(x):\n    if x:\n        return  x";

test("FR2: a heading, numbered list, inline code and a code block render with their formatting", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  const title = `Formatted ${Date.now()}`;
  const sheet = await newProblem(page, title);
  await sheet
    .getByLabel("Description", { exact: true })
    .fill(
      `## Approach\n\n1. Read \`a\`\n2. Add \`b\`\n\n\`\`\`python\n${CODE_BLOCK}\n\`\`\`\n\nDone.`,
    );
  await create(page, sheet);

  const participant = await joinSessionOn(page, await problemId(page, title));
  const panel = descriptionPanel(participant);
  await expect(panel.getByRole("heading", { name: "Approach" })).toBeVisible();
  const items = panel.getByRole("list").getByRole("listitem");
  await expect(items).toHaveCount(2);
  expect(await panel.locator("ol").count()).toBe(1);
  await expect(panel.locator("li code").first()).toHaveText("a");
  const pre = panel.locator("pre");
  // Indentation and the double space are kept; only the final newline is optional.
  expect((await pre.textContent())?.replace(/\n$/, "")).toBe(CODE_BLOCK);
  expect(await pre.evaluate((el) => getComputedStyle(el).whiteSpace)).toMatch(/^pre/);
  await participant.context().close();
});

test("FR3, FR6: an image between paragraphs 2 and 3 is shown between them, beside the editor", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  const title = `With image ${Date.now()}`;
  const sheet = await newProblem(page, title);
  const source = sheet.getByLabel("Description", { exact: true });
  await source.fill("First paragraph.\n\nSecond paragraph.\n\n\n\nThird paragraph.");
  // The cursor on the empty line between the second and third paragraphs.
  await source.evaluate((el: HTMLTextAreaElement) => {
    const at = el.value.indexOf("Second paragraph.") + "Second paragraph.\n\n".length;
    el.setSelectionRange(at, at);
  });
  await sheet
    .getByLabel("Image file", { exact: true })
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
  await expect(source).toHaveValue(/Second paragraph\.\n\n!\[dot\]\(\/api\/images\/[\w-]+\)\n\nThird/);
  await create(page, sheet);

  const participant = await joinSessionOn(page, await problemId(page, title));
  const panel = descriptionPanel(participant);
  const image = panel.getByRole("img", { name: "dot" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(1);
  const order = await panel.evaluate((root) =>
    [...root.querySelectorAll("p")].map((p) => (p.querySelector("img") ? "IMG" : p.textContent)),
  );
  expect(order).toEqual(["First paragraph.", "Second paragraph.", "IMG", "Third paragraph."]);

  // FR6: beside the shared editor, not over it.
  const editorBox = await participant.getByRole("main").boundingBox();
  const panelBox = await panel.boundingBox();
  if (!editorBox || !panelBox) throw new Error("no layout boxes");
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(panelBox.x + 1);
  await expect(participant.locator(".cm-content")).toBeInViewport();
  await expect(image).toBeInViewport();
  await participant.context().close();
});

test("FR4: a 3 MB image and a PDF are refused with the limit or the formats; the text is unchanged", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  const sheet = await newProblem(page, `Refusals ${Date.now()}`);
  const source = sheet.getByLabel("Description", { exact: true });
  await source.fill("Keep this text.");
  const file = sheet.getByLabel("Image file", { exact: true });

  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024 - PNG.length)]);
  await file.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
  await expect(sheet.getByText("This image is too large. The limit is 2 MB.")).toBeVisible();
  await expect(source).toHaveValue("Keep this text.");

  const pdf = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  await file.setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(
    sheet.getByText("This file can't be added. Use a PNG, JPEG, GIF or WebP image."),
  ).toBeVisible();
  await expect(source).toHaveValue("Keep this text.");
});

test("FR5: Preview shows unsaved changes rendered; closing without saving leaves the problem unchanged", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  const title = `Previewed ${Date.now()}`;
  const sheet = await newProblem(page, title);
  await sheet.getByLabel("Description", { exact: true }).fill("Saved text.");
  await create(page, sheet);
  const id = await problemId(page, title);

  await page.goto(`/problems/${id}/edit`);
  const editSheet = page.locator("dialog[open]");
  const source = editSheet.getByLabel("Description", { exact: true });
  await expect(source).toHaveValue("Saved text.");
  await source.fill("# Unsaved heading\n\nWith **bold** text.");
  await editSheet.getByRole("radio", { name: "Preview" }).click();
  await expect(editSheet.getByRole("heading", { name: "Unsaved heading" })).toBeVisible();
  await expect(editSheet.locator("strong", { hasText: "bold" })).toBeVisible();

  await editSheet.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/problems/${id}`)).json()) as {
    description: string;
  };
  expect(saved.description).toBe("Saved text.");
});

test("NFR Readability: at 1024 px a wide image is scaled to fit, with no horizontal scrolling", async ({
  page,
  keycloak,
}) => {
  await signInAsEditor(page, keycloak.users);
  // A 2400 px wide PNG, drawn in the browser and uploaded as the editor's Image button would.
  const url = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#3478f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png"),
    );
    const res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    if (res.status !== 201) throw new Error(`upload: ${res.status}`);
    return ((await res.json()) as { url: string }).url;
  });
  const title = `Wide ${Date.now()}`;
  const sheet = await newProblem(page, title);
  await sheet.getByLabel("Description", { exact: true }).fill(`Look:\n\n![wide](${url})`);
  await create(page, sheet);

  const participant = await joinSessionOn(page, await problemId(page, title), {
    width: 1024,
    height: 768,
  });
  const image = descriptionPanel(participant).getByRole("img", { name: "wide" });
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(2400);
  const fit = await image.evaluate((img: HTMLImageElement) => {
    const panel = img.closest('[role="tabpanel"]') as HTMLElement;
    const scroller = img.closest('[aria-label="Inspector"] > *') as HTMLElement;
    return {
      rendered: img.getBoundingClientRect().width,
      panel: panel.getBoundingClientRect().width,
      scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(fit.rendered).toBeLessThanOrEqual(fit.panel);
  expect(fit.scrollerOverflow).toBeLessThanOrEqual(0);
  expect(fit.pageOverflow).toBeLessThanOrEqual(0);
  await expect(participant.locator(".cm-content")).toBeInViewport();
  await participant.context().close();
});
