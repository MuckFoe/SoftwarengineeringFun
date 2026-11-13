// Spec 020 (next-step hints from the self-hosted model) end to end, against the kept stack with
// docker-compose.test.yml's fake model `llm` as the model. The fake picks its answer from a
// directive in the question (fake:slow, fake:cold, ...), otherwise a safe one-step hint; the E2E
// timeouts are 3 s loaded and 6 s cold (global-setup.ts). `POST /cold` on the fake's control
// port is one-shot global state, so this file runs in the playwright config's serial "giphy"
// project, with the look matrix's warming-up screen that also uses it.
import type { Browser, Locator, Page } from "@playwright/test";
import { appUrl, createSession, expect, signedInContext, signIn, test } from "./fixtures";

/** The fake model's control port (docker-compose.test.yml `llm`). */
const LLM_CONTROL_URL = (
  process.env.TEST_LLM_CONTROL_URL ??
  `http://127.0.0.1:${process.env.TEST_LLM_CONTROL_PORT ?? "58381"}`
).replace(/\/$/, "");

/** `POST /cold`: the fake's next single `/api/ps` call reports the model cold (FR-14a). */
async function coldModel(): Promise<void> {
  const response = await fetch(`${LLM_CONTROL_URL}/cold`, { method: "POST" });
  if (!response.ok) throw new Error(`fake model POST /cold: ${response.status}`);
}

const WARMING = "Model is warming up. This answer takes longer.";
const UNAVAILABLE = "Hints are unavailable right now";

/** A visible line of the panel; the polite live region repeats some of them as role=status. */
const line = (page: Page, text: string) =>
  page.getByRole("paragraph").filter({ hasText: text });
const hintButton = (page: Page) => page.getByRole("button", { name: "Hint", exact: true });
const questionButton = (page: Page) => page.getByRole("button", { name: "Question", exact: true });
const questionField = (page: Page) => page.getByLabel("Your question");
const hintCard = (page: Page, n: number) =>
  page.getByRole("article", { name: `Hint ${n}`, exact: true });
const answerCard = (page: Page, n: number) =>
  page.getByRole("article", { name: `Question ${n}`, exact: true });

/** Joins a coding session as a guest under `name`, by its invite link. */
async function joinAsGuest(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

/** Asks a question (FR-17); the fake model reads its directives from it. */
async function askQuestion(page: Page, question: string): Promise<void> {
  await questionButton(page).click();
  await questionField(page).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

/** A hint as everyone sees it: the model label, its number and the asker (FR-6). */
async function expectHint(card: Locator, by: string): Promise<void> {
  await expect(card).toBeVisible();
  await expect(card.getByText("Model hint", { exact: true })).toBeVisible();
  await expect(card).toContainText(`Asked by ${by}`);
}

/** An answer as everyone sees it: the model label, the asker and the question (FR-18). */
async function expectAnswer(card: Locator, by: string, question: string): Promise<void> {
  await expect(card).toBeVisible();
  await expect(card.getByText("Model answer")).toBeVisible();
  await expect(card).toContainText(`Asked by ${by}`);
  await expect(card).toContainText(question);
}

test("AC-3, AC-12, AC-13, AC-12a, AC-18: a guest's hint and question reach everyone, survive a reload; slow and cold models", async ({
  browser,
  request,
  keycloak,
}) => {
  test.setTimeout(45_000);
  const invite = await createSession(request);
  const { context, page: ada } = await signedInContext(browser, keycloak, "editor1", `/s/${invite}`);
  const guestContext = await browser.newContext();
  try {
    await expect(ada.locator(".cm-content")).toContainText("pass");
    await expect(ada.getByLabel("Your name")).toHaveCount(0);
    const grace = await guestContext.newPage();
    await joinAsGuest(grace, invite, "Grace");
    const both = [ada, grace];

    await test.step("AC-12: a model slower than the timeout → 'unavailable', Hint usable again", async () => {
      await askQuestion(grace, "fake:slow");
      // FR-17: everyone sees that an answer is being prepared, who asked and the question.
      for (const page of both) {
        await expect(page.getByText("Answering the question…")).toBeVisible();
        await expect(page.getByText("Asked by Grace · fake:slow")).toBeVisible();
      }
      // The E2E loaded timeout is 3 s; the message follows it within a few hundred ms.
      for (const page of both) {
        await expect(line(page, UNAVAILABLE)).toBeVisible({ timeout: 6_000 });
        await expect(hintButton(page)).toBeEnabled();
      }
      await expect(grace.getByRole("article")).toHaveCount(0);
    });

    await test.step("AC-3, AC-17: the guest asks for a hint, no input; both see Hint 1 with her name", async () => {
      await hintButton(grace).click();
      await expect(grace.getByRole("textbox", { name: "Your question" })).toHaveCount(0);
      for (const page of both) await expectHint(hintCard(page, 1), "Grace");
    });

    await test.step("AC-18: the guest asks a question; both see Question 1 with it", async () => {
      await askQuestion(grace, "what does enumerate return?");
      // No number was used by the failed request (FR-14): this is Question 1.
      for (const page of both) {
        await expectAnswer(answerCard(page, 1), "Grace", "what does enumerate return?");
      }
    });

    await test.step("AC-13: after a reload the hint and the answer are still shown", async () => {
      await ada.reload();
      await expect(ada.locator(".cm-content")).toContainText("pass");
      await expectHint(hintCard(ada, 1), "Grace");
      await expectAnswer(answerCard(ada, 1), "Grace", "what does enumerate return?");
    });

    await test.step("AC-12a: a cold model → the warming-up line, then the answer", async () => {
      await questionButton(grace).click();
      await questionField(grace).fill("fake:cold");
      // Set cold as late as possible: the next request's model check consumes it.
      await coldModel();
      await grace.getByRole("button", { name: "Ask", exact: true }).click();
      for (const page of both) await expect(line(page, WARMING)).toBeVisible();
      // The fake answers a cold request after about 2 s, inside the 6 s cold timeout.
      for (const page of both) {
        await expectAnswer(answerCard(page, 2), "Grace", "fake:cold");
        await expect(line(page, WARMING)).toHaveCount(0);
      }
    });
  } finally {
    await guestContext.close();
    await context.close();
  }
});

test("AC-19: only the asker is asked before an answer that gives the solution away", async ({
  browser,
  request,
}) => {
  const invite = await createSession(request);
  const adaContext = await browser.newContext();
  const graceContext = await browser.newContext();
  try {
    const ada = await adaContext.newPage();
    const grace = await graceContext.newPage();
    await joinAsGuest(ada, invite, "Ada");
    await joinAsGuest(grace, invite, "Grace");
    const confirmBox = (page: Page) =>
      page.getByRole("region", { name: "Answer would reveal the solution" });

    await askQuestion(grace, "fake:reveal write it for me");
    await expect(confirmBox(grace)).toBeVisible();
    await expect(confirmBox(grace)).toContainText("basically the solution");
    await expect(line(ada, "Grace is deciding")).toBeVisible();
    await expect(confirmBox(ada)).toHaveCount(0);

    await test.step("declined: nothing is shown", async () => {
      await grace.getByRole("button", { name: "Keep trying" }).click();
      for (const page of [ada, grace]) {
        await expect(confirmBox(page)).toHaveCount(0);
        await expect(line(page, "Grace is deciding")).toHaveCount(0);
        await expect(page.getByRole("article")).toHaveCount(0);
      }
    });

    await test.step("confirmed: everyone sees the answer, marked as revealing", async () => {
      await askQuestion(grace, "fake:reveal write it for me");
      await grace.getByRole("button", { name: "Show the answer" }).click();
      for (const page of [ada, grace]) {
        const card = answerCard(page, 1);
        await expect(card).toContainText("reveals the solution");
        await expect(card).toContainText("def ");
      }
    });
  } finally {
    await adaContext.close();
    await graceContext.close();
  }
});

test("AC-16: by keyboard alone at 390 px, with a focus ring and no horizontal overflow", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  try {
    const page = await context.newPage();
    await joinAsGuest(page, await createSession(request), "Kim");
    // On a phone the description, where Hint lives, starts unpinned: its strip peeks it.
    await page.getByRole("button", { name: "Description", exact: true }).click();
    const hint = hintButton(page);
    await expect(hint).toBeEnabled();

    // Tab to Hint; Tab indents inside the code editor, so Escape leaves it first.
    const isFocused = () => hint.evaluate((el) => el === document.activeElement);
    for (let i = 0; i < 80 && !(await isFocused()); i++) {
      if (await page.evaluate(() => !!document.activeElement?.closest(".cm-editor"))) {
        await page.keyboard.press("Escape");
      }
      await page.keyboard.press("Tab");
    }
    expect(await isFocused()).toBe(true);
    // The focus indicator is an outline or the box-shadow ring (as in a11y.spec.ts).
    const ring = await hint.evaluate((el) => {
      const s = getComputedStyle(el);
      return (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none";
    });
    expect(ring).toBe(true);

    // Hint asks at once (AC-17).
    await page.keyboard.press("Enter");
    await expectHint(hintCard(page, 1), "Kim");
    // Hint is usable again. (Focus is not asserted: Hint is disabled while the hint is
    // prepared, which drops the focus Enter left on it, depending on timing.)
    await expect(hint).toBeEnabled();

    // Question by keyboard: it opens its field focused, Enter sends.
    await questionButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(questionField(page)).toBeFocused();
    await page.keyboard.type("which case is missing");
    await page.keyboard.press("Enter");
    await expectAnswer(answerCard(page, 1), "Kim", "which case is missing");

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  } finally {
    await context.close();
  }
});

/** A presentation in the library to start a session on: any present, else one added. */
async function presentationId(page: Page): Promise<string> {
  const listed = await page.request.get(appUrl("/api/present/presentations"));
  expect(listed.ok()).toBe(true);
  const existing = (await listed.json()) as Array<{ id: string }>;
  if (existing[0]) return existing[0].id;
  const html = "<!doctype html><html><body><div data-slide><h1>Hints</h1></div></body></html>";
  const params = new URLSearchParams({ title: `Hints E2E ${Date.now()}`, topic: "Hints" });
  const added = await page.request.post(appUrl(`/api/present/presentations?${params}`), {
    data: html,
    headers: { "content-type": "text/html" },
  });
  expect(added.status()).toBe(201);
  return ((await added.json()) as { id: string }).id;
}

async function guestPage(browser: Browser, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(appUrl(path));
  await page.getByLabel("Your name").fill("Lee");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  return page;
}

test("AC-1: learning, presentation and chess windows have no Hint", async ({
  browser,
  request,
  keycloak,
}) => {
  const pages: Page[] = [];
  try {
    const learning = await request.post(appUrl("/api/learn/sessions"), {
      data: { lesson_key: "01-docker/01-basics" },
    });
    expect(learning.status()).toBe(201);
    const learn = await guestPage(
      browser,
      `/learn/s/${((await learning.json()) as { invite_id: string }).invite_id}`,
    );
    pages.push(learn);
    await expect(learn.getByRole("main")).toBeVisible();
    await expect(hintButton(learn)).toHaveCount(0);

    const chessCreated = await request.post(appUrl("/api/games/chess/sessions"));
    expect(chessCreated.status()).toBe(201);
    const chess = await guestPage(
      browser,
      `/games/chess/s/${((await chessCreated.json()) as { invite_id: string }).invite_id}`,
    );
    pages.push(chess);
    await expect(chess.getByRole("region", { name: "Seats" })).toContainText("Lee");
    await expect(hintButton(chess)).toHaveCount(0);

    const editor = keycloak.users.editor1;
    if (!editor) throw new Error("no keycloak test user 'editor1'");
    const present = await (await browser.newContext()).newPage();
    pages.push(present);
    await signIn(present, editor.username, editor.password);
    const started = await request.post(appUrl("/api/present/sessions"), {
      data: { presentation_id: await presentationId(present) },
    });
    expect(started.status()).toBe(201);
    await present.goto(
      appUrl(`/present/s/${((await started.json()) as { invite_id: string }).invite_id}`),
    );
    await expect(present.locator("iframe")).toBeVisible();
    await expect(hintButton(present)).toHaveCount(0);
  } finally {
    for (const page of pages) await page.context().close();
  }
});
