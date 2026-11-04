// Spec 008: the chat always beside the description. In the session window's inspector the
// description sits above the chat, each its own region, split by a divider; against the
// production stack.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { appUrl, createSession, expect, openContexts, sql, test } from "./fixtures";

async function join(page: Page, invite: string, name = "Ada"): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const description = (page: Page) => inspector(page).getByRole("region", { name: "Description" });
const chat = (page: Page) => inspector(page).getByRole("region", { name: "Chat" });
const messageInput = (page: Page) => chat(page).getByLabel("Message", { exact: true });
const messageList = (page: Page) => chat(page).getByRole("list", { name: "Messages" });
/** The message input with its counter and actions: the chat's compose form. */
const compose = (page: Page) => messageInput(page).locator("xpath=ancestor::form[1]");

async function box(target: Locator) {
  const b = await target.boundingBox();
  if (!b) throw new Error(`${target} has no layout box`);
  return b;
}

/**
 * A copy of the seeded "Sum Two Numbers" with an 80-paragraph description, and a session on
 * it whose chat already holds `messages` messages from Ben; returns the invite id.
 */
async function longSession(request: APIRequestContext, messages: number): Promise<string> {
  const title = `Long description ${Date.now()}`;
  sql(
    `insert into problem (title, description, signature, function_name, params, return_type)
     select '${title}',
            (select string_agg('Paragraph ' || g || ': lorem ipsum dolor sit amet, consectetur adipiscing elit.', chr(10) || chr(10))
               from generate_series(1, 80) g),
            signature, function_name, params, return_type
       from problem where title = 'Sum Two Numbers' and deleted_at is null limit 1`,
  );
  const invite = await createSession(request, title);
  sql(
    `with s as (select id from session where invite_id = '${invite}'),
          p as (insert into participant (session_id, display_name, left_at)
                select id, 'Ben', now() from s returning id, session_id)
     insert into chat_message (session_id, participant_id, sender_name, body, sent_at)
     select p.session_id, p.id, 'Ben', 'message ' || g, now() - (${messages + 1} - g) * interval '1 second'
       from p, generate_series(1, ${messages}) g`,
  );
  return invite;
}

test("FR-1: the description and the chat are both visible, the description above the chat, with no tabs", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request));

  await expect(description(page)).toBeVisible();
  await expect(description(page)).toContainText("Add two integers and return their sum.");
  await expect(chat(page)).toBeVisible();
  const top = await box(description(page));
  const bottom = await box(chat(page));
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y + 1);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("FR-8: the description and the chat scroll independently, and the chat input stays pinned", async ({
  page,
  request,
}) => {
  await join(page, await longSession(request, 50));
  await expect(messageList(page).getByText("message 50", { exact: true })).toBeVisible();

  const scroller = description(page);
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const listTop = () => messageList(page).evaluate((el) => el.scrollTop);
  const listBefore = await listTop();
  const inputBefore = await box(compose(page));
  const textareaBefore = await box(messageInput(page));

  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
    .toBe(true);
  expect(await listTop()).toBe(listBefore);
  expect(await box(compose(page))).toEqual(inputBefore);
  expect(await box(messageInput(page))).toEqual(textareaBefore);

  await messageInput(page).fill("one more");
  await messageInput(page).press("Enter");
  await expect(messageList(page).getByText("one more", { exact: true })).toBeVisible();
  await expect(messageInput(page)).toHaveValue("");
  const input = await box(compose(page));
  const region = await box(chat(page));
  expect(Math.abs(input.y + input.height - (region.y + region.height))).toBeLessThanOrEqual(1);
});

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Session" });

/** The side area's content height: the inspector's content box, inside its padding. */
const sideAreaHeight = (page: Page) =>
  inspector(page).evaluate((el) => {
    const content = el.firstElementChild as HTMLElement;
    const style = getComputedStyle(content);
    return content.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  });

test("FR-2: Hide chat hides the chat and the description fills the side area", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request));
  await expect(chat(page)).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Hide chat" }).click();
  await expect(chat(page)).toBeHidden();
  await expect(description(page)).toBeVisible();
  await expect
    .poll(async () => Math.abs((await box(description(page))).height - (await sideAreaHeight(page))))
    .toBeLessThanOrEqual(1);
});

test("FR-3: Show chat brings the chat back below the description, at its newest message, with the draft kept", async ({
  browser,
  page,
  request,
}) => {
  // Ada has scrolled back to older messages before hiding, so only showing brings her to the end.
  const invite = await longSession(request, 50);
  await join(page, invite);
  await expect(messageList(page).getByText("message 50", { exact: true })).toBeVisible();
  await messageList(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(messageList(page).getByText("message 50", { exact: true })).not.toBeInViewport();
  await messageInput(page).fill("draft before hiding");
  await toolbar(page).getByRole("button", { name: "Hide chat" }).click();
  await expect(chat(page)).toBeHidden();

  const [benContext] = await openContexts(browser, 1);
  if (!benContext) throw new Error("no context for Ben");
  const ben = await benContext.newPage();
  await join(ben, invite, "Ben");
  for (let i = 1; i <= 30; i++) {
    await messageInput(ben).fill(`ben ${i}`);
    await messageInput(ben).press("Enter");
    await expect(messageList(ben).getByText(`ben ${i}`, { exact: true })).toBeVisible();
  }
  // The hidden chat is out of the accessibility tree, so look for the text, not the role.
  await expect(inspector(page).getByText("ben 30", { exact: true })).toBeAttached();

  await toolbar(page).getByRole("button", { name: "Show chat" }).click();
  await expect(chat(page)).toBeVisible();
  const top = await box(description(page));
  const bottom = await box(chat(page));
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y + 1);
  expect(await messageList(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect
    .poll(() =>
      messageList(page).evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1),
    )
    .toBe(true);
  await expect(messageList(page).getByText("ben 30", { exact: true })).toBeInViewport();
  await expect(messageInput(page)).toHaveValue("draft before hiding");
  await benContext.close();
});

test("FR-4: the chat choice is remembered in this browser, for any session", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request));
  await toolbar(page).getByRole("button", { name: "Hide chat" }).click();
  await expect(chat(page)).toBeHidden();

  await join(page, await createSession(request));
  await expect(description(page)).toBeVisible();
  await expect(chat(page)).toBeHidden();
  await expect(toolbar(page).getByRole("button", { name: "Show chat" })).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Show chat" }).click();
  await expect(chat(page)).toBeVisible();
  await page.reload();
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
  await expect(chat(page)).toBeVisible();
});

test("FR-5: dragging the divider up grows the chat and shrinks the description, down to their minimums", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request));
  await expect(chat(page)).toBeVisible();
  const divider = inspector(page).getByRole("separator", { name: "Resize description and chat" });
  const heights = async () => ({
    description: (await box(description(page))).height,
    chat: (await box(chat(page))).height,
  });

  /** Presses on the divider's middle, moves to `y` in steps and releases. */
  async function dragTo(y: number) {
    const d = await box(divider);
    const x = d.x + d.width / 2;
    await page.mouse.move(x, d.y + d.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  }

  const before = await heights();
  const start = await box(divider);
  await dragTo(start.y + start.height / 2 - 100);
  await expect
    .poll(async () => Math.abs((await heights()).chat - (before.chat + 100)))
    .toBeLessThanOrEqual(1);
  expect(Math.abs((await heights()).description - (before.description - 100))).toBeLessThanOrEqual(
    1,
  );

  const side = await box(inspector(page));
  await dragTo(side.y - 50);
  await expect
    .poll(async () => Math.abs((await heights()).description - 120))
    .toBeLessThanOrEqual(1);

  await dragTo(side.y + side.height + 50);
  await expect.poll(async () => Math.abs((await heights()).chat - 160)).toBeLessThanOrEqual(1);
});

test("FR-6: hiding and showing the side area brings back what was there; Show chat reopens it", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request));
  const divider = inspector(page).getByRole("separator", { name: "Resize description and chat" });
  const dividerY = async () => (await box(divider)).y;
  await expect(chat(page)).toBeVisible();
  const before = await dividerY();

  await toolbar(page).getByRole("button", { name: "Hide inspector" }).click();
  await expect(inspector(page)).toBeHidden();
  await toolbar(page).getByRole("button", { name: "Show inspector" }).click();
  await expect(description(page)).toBeVisible();
  await expect(chat(page)).toBeVisible();
  await expect.poll(async () => Math.abs((await dividerY()) - before)).toBeLessThanOrEqual(1);

  await toolbar(page).getByRole("button", { name: "Hide chat" }).click();
  await expect(chat(page)).toBeHidden();
  await toolbar(page).getByRole("button", { name: "Hide inspector" }).click();
  await expect(inspector(page)).toBeHidden();
  await toolbar(page).getByRole("button", { name: "Show inspector" }).click();
  await expect(description(page)).toBeVisible();
  await expect(chat(page)).toBeHidden();

  // With the side area hidden, Show chat (button or shortcut) opens it with the chat.
  await toolbar(page).getByRole("button", { name: "Hide inspector" }).click();
  await expect(inspector(page)).toBeHidden();
  await toolbar(page).getByRole("button", { name: "Show chat" }).click();
  await expect(description(page)).toBeVisible();
  await expect(chat(page)).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Hide inspector" }).click();
  await expect(inspector(page)).toBeHidden();
  const mac = await page.evaluate(() => /mac/i.test(navigator.platform));
  await page.keyboard.press(mac ? "Control+Meta+c" : "Control+Alt+c");
  await expect(description(page)).toBeVisible();
  await expect(chat(page)).toBeVisible();
});

test.describe("at 1024×768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("NFR-1: with the sidebar overlay, inspector and chat shown, nothing scrolls horizontally and the editor is usable", async ({
    page,
    request,
  }) => {
    await join(page, await createSession(request));
    await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
    await expect(description(page)).toBeVisible();
    await expect(chat(page)).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

    await page.locator(".cm-content > .cm-line").last().click();
    await page.keyboard.press("End");
    await page.keyboard.type("# typed at 1024");
    await expect(page.locator(".cm-content")).toContainText("# typed at 1024");
  });
});

const focused = (target: Locator) =>
  target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));

/** Presses `key` until focus is on (or inside) `target`; Esc first leaves the code editor. */
async function pressUntil(page: Page, target: Locator, key = "Tab", max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if ((await target.count()) > 0 && (await focused(target.first()))) return;
    const inEditor = await page.evaluate(() => !!document.activeElement?.closest(".cm-editor"));
    if (key === "Tab" && inEditor) await page.keyboard.press("Escape");
    await page.keyboard.press(key);
  }
  throw new Error(`pressing ${key} never reached ${target}`);
}

test("NFR-2: by keyboard alone the chat control and the divider work, and the regions are announced", async ({
  page,
  request,
}) => {
  await join(page, await createSession(request));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // Tab to the toolbar, arrow to "Hide chat", Space hides the chat and Space shows it again.
  const toolbar = page.getByRole("toolbar", { name: "Session" });
  await pressUntil(page, toolbar);
  await pressUntil(page, toolbar.getByRole("button", { name: "Hide chat" }), "ArrowRight", 20);
  await page.keyboard.press("Space");
  await expect(chat(page)).toBeHidden();
  await expect(toolbar.getByRole("button", { name: "Show chat" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(chat(page)).toBeVisible();

  // Tab to the divider; ↑ three times makes the chat taller.
  const divider = inspector(page).getByRole("separator", { name: "Resize description and chat" });
  await pressUntil(page, divider);
  const before = (await box(chat(page))).height;
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await box(chat(page))).height).toBeGreaterThan(before);

  // Separate, named regions, and no accessibility violations in the session window.
  await expect(page.getByRole("region", { name: "Description" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Chat" })).toHaveCount(1);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`)),
  ).toEqual([]);
});
