/// <reference lib="dom" />
// Spec 003 AC-18: ⌘Return runs code on macOS and Ctrl+Enter on Windows/Linux, and Esc
// closes an open sheet or popover. AC-18a: every shortcut in the list does what it says.
// AC-18c / FR-21: every screen can be used with the keyboard alone, in the planned Tab
// order. The platform is pinned per browser so the same keys are tested whatever machine
// runs the suite.
import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const PROBLEM = "Sum Two Numbers";

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get(`/api/problems?q=${encodeURIComponent(PROBLEM)}`);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === PROBLEM);
  if (!problem) throw new Error(`no seeded problem titled ${PROBLEM}`);
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

/** Makes the app see `platform` (navigator.platform and, where present, userAgentData). */
async function pinPlatform(
  target: Pick<Page | BrowserContext, "addInitScript">,
  platform: "MacIntel" | "Linux x86_64",
): Promise<void> {
  const uaPlatform = platform === "MacIntel" ? "macOS" : "Linux";
  await target.addInitScript(`(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => ${JSON.stringify(platform)} });
    if ("userAgentData" in navigator) {
      Object.defineProperty(Navigator.prototype, "userAgentData", {
        get: () => ({ platform: ${JSON.stringify(uaPlatform)}, brands: [], mobile: false }),
      });
    }
  })()`);
}

async function joinAndFocusEditor(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto(`/s/${await createSession(request)}`);
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("pass");
  await editor.click();
}

async function expectRunStarts(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Run results" });
  await expect(panel.getByText(/^Test 1: /)).toBeVisible({ timeout: 30_000 });
}

test("AC-18: ⌘Return in the editor runs the code (macOS, WebKit)", async ({
  playwright,
  request,
  baseURL,
}) => {
  // The suite's browser is Chromium; this one test needs Safari's engine.
  const browser = await playwright.webkit.launch();
  try {
    const page = await (await browser.newContext({ baseURL })).newPage();
    await pinPlatform(page, "MacIntel");
    await joinAndFocusEditor(page, request);
    const before = await page.locator(".cm-content").textContent();

    await page.keyboard.press("Meta+Enter");

    await expectRunStarts(page);
    // Consumed as a shortcut: the editor didn't also get a new line.
    expect(await page.locator(".cm-content").textContent()).toBe(before);
  } finally {
    await browser.close();
  }
});

test.describe("Linux in Chromium", () => {
  test("AC-18: Ctrl+Enter in the editor runs the code", async ({ page, request }) => {
    await pinPlatform(page, "Linux x86_64");
    await joinAndFocusEditor(page, request);
    const before = await page.locator(".cm-content").textContent();

    await page.keyboard.press("Control+Enter");

    await expectRunStarts(page);
    expect(await page.locator(".cm-content").textContent()).toBe(before);
  });

  test("AC-18: Esc closes the shortcut-list sheet and the appearance popover", async ({
    page,
  }) => {
    await pinPlatform(page, "Linux x86_64");
    await page.goto("/");
    await expect(page.getByRole("toolbar", { name: "Problems" })).toBeVisible();

    await page.keyboard.press("Control+Shift+Slash");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.keyboard.press("Control+Comma");
    const appearance = page.getByRole("radiogroup", { name: "Appearance" });
    await expect(appearance).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(appearance).toBeHidden();
  });
});

// ---- AC-18a and AC-18c: everything by keyboard (Windows/Linux keys, Chromium) ----

type Users = Record<string, { username: string; password: string }>;

function editorUser(users: Users) {
  const editor = users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  return editor;
}

const focused = (target: Locator) =>
  target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));

/** Presses `key` until focus is on (or inside) `target`. */
async function pressUntil(page: Page, target: Locator, key = "Tab", max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if ((await target.count()) > 0 && (await focused(target.first()))) return;
    await page.keyboard.press(key);
  }
  throw new Error(`pressing ${key} never reached ${target}`);
}

/** Tabs into the window toolbar, then arrows along it to the named item. */
async function toolbarItem(page: Page, toolbar: string, item: Locator): Promise<void> {
  await pressUntil(page, page.getByRole("toolbar", { name: toolbar }));
  await pressUntil(page, item, "ArrowRight", 20);
}

/** The Keycloak form focuses the username field on arrival. */
async function signInByKeyboard(page: Page, users: Users): Promise<void> {
  const editor = editorUser(users);
  const username = page.getByRole("textbox", { name: "Username" });
  await expect(username).toBeFocused();
  await page.keyboard.type(editor.username);
  await page.keyboard.press("Tab");
  await page.keyboard.type(editor.password);
  await page.keyboard.press("Enter");
}

const hud = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

test.describe("keyboard only, Windows/Linux keys", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await pinPlatform(context, "Linux x86_64");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(baseURL ?? "").origin,
    });
  });

  test("AC-18a: every shortcut in the list does what the list says", async ({
    page,
    context,
    request,
    keycloak,
  }) => {
    const editor = editorUser(keycloak.users);
    await page.goto("/api/auth/login?next=%2F");
    await page.getByRole("textbox", { name: "Username" }).fill(editor.username);
    await page.getByRole("textbox", { name: "Password" }).fill(editor.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("toolbar", { name: "Problems" })).toBeVisible();

    // The list itself, read from the screen: action label → its keys.
    await page.keyboard.press("Control+Shift+Slash");
    const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(list).toBeVisible();
    const rows = await list.getByRole("row").evaluateAll((trs) =>
      trs.slice(1).map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")),
    );
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    const keysFor = new Map(rows.map(([action, keys]) => [action ?? "", keys ?? ""]));

    const combo = (action: string) => {
      const keys = keysFor.get(action);
      if (!keys) throw new Error(`the shortcut list has no row for "${action}"`);
      const names: Record<string, string> = { Ctrl: "Control", Esc: "Escape" };
      return keys
        .split("+")
        .map((k) => names[k] ?? (k.length === 1 ? k.toLowerCase() : k))
        .join("+");
    };
    const press = (action: string) => page.keyboard.press(combo(action));

    const session = (p: Page) => p.getByRole("toolbar", { name: "Session" });
    const effects: Record<string, (p: Page) => Promise<void>> = {
      "Shortcut list": async () => {
        await press("Shortcut list");
        await expect(list).toBeVisible();
      },
      "Close sheet or popover": async () => {
        await press("Close sheet or popover");
        await expect(list).toBeHidden();
      },
      "Default button": async () => {
        await press("Shortcut list");
        await expect(list).toBeVisible();
        await press("Default button");
        await expect(list).toBeHidden();
      },
      "Appearance setting": async () => {
        await press("Appearance setting");
        await expect(page.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
        await page.keyboard.press("Escape");
      },
      "Focus search": async () => {
        await press("Focus search");
        await expect(page.getByRole("searchbox", { name: "Search problems" })).toBeFocused();
        await page.keyboard.press("Tab");
      },
      "Show or hide sidebar": async () => {
        const sidebar = page.getByRole("navigation", { name: "Sidebar" });
        await press("Show or hide sidebar");
        await expect(sidebar).toBeHidden();
        await press("Show or hide sidebar");
        await expect(sidebar).toBeVisible();
      },
      "New problem": async () => {
        await press("New problem");
        await expect(page.getByRole("dialog", { name: "New problem" })).toBeVisible();
      },
      "Save problem": async () => {
        const sheet = page.getByRole("dialog", { name: "New problem" });
        await sheet.getByLabel("Title").fill("Saved by shortcut");
        await sheet.getByLabel("Description", { exact: true }).fill("Double a number.");
        await sheet.getByLabel("Signature").fill("def double(x: int) -> int");
        await sheet.getByLabel("Test 1 args").fill("[2]");
        await sheet.getByLabel("Test 1 expected").fill("4");
        await press("Save problem");
        await expect(hud(page, "Problem saved")).toBeVisible();
        await expect(sheet).toBeHidden();
      },
    };
    const sessionEffects: Record<string, (p: Page) => Promise<void>> = {
      "Run code": async (p) => {
        await p.keyboard.press(combo("Run code"));
        await expectRunStarts(p);
      },
      "Show or hide run panel": async (p) => {
        const panel = p.getByRole("region", { name: "Run results" });
        await p.keyboard.press(combo("Show or hide run panel"));
        await expect(panel).toBeHidden();
        await p.keyboard.press(combo("Show or hide run panel"));
        await expect(panel).toBeVisible();
      },
      "Next problem": async (p) => {
        const title = session(p).getByRole("heading");
        const before = await title.textContent();
        await p.keyboard.press(combo("Next problem"));
        await expect(title).not.toHaveText(before ?? "");
      },
      "Previous problem": async (p) => {
        await p.keyboard.press(combo("Previous problem"));
        await expect(session(p).getByRole("heading")).toHaveText(PROBLEM);
      },
      "Copy invite link": async (p) => {
        await p.keyboard.press(combo("Copy invite link"));
        await expect(hud(p, "Invite link copied")).toBeVisible();
      },
      "Show or hide chat": async (p) => {
        const chat = p.getByRole("tabpanel", { name: "Chat" });
        await p.keyboard.press(combo("Show or hide chat"));
        await expect(chat).toBeVisible();
        await p.keyboard.press(combo("Show or hide chat"));
        await expect(chat).toBeHidden();
      },
    };

    expect(new Set(keysFor.keys())).toEqual(
      new Set([...Object.keys(effects), ...Object.keys(sessionEffects)]),
    );

    for (const [action, effect] of Object.entries(effects)) {
      await test.step(action, () => effect(page));
    }

    const inSession = await context.newPage();
    await inSession.goto(`/s/${await createSession(request)}`);
    await inSession.getByLabel("Your name").fill("Ada");
    await inSession.keyboard.press("Enter");
    await expect(inSession.locator(".cm-content")).toContainText("pass");
    for (const [action, effect] of Object.entries(sessionEffects)) {
      await test.step(action, () => effect(inSession));
    }
  });

  test("AC-18c: the problems screen by keyboard alone: search, create, edit, save, delete", async ({
    page,
    keycloak,
  }) => {
    await page.goto("/api/auth/login?next=%2F");
    await signInByKeyboard(page, keycloak.users);
    await page.waitForURL((url) => url.pathname === "/");
    const rows = page.getByRole("main").getByRole("row");
    await expect(rows.nth(1)).toBeVisible();

    // Search.
    const search = page.getByRole("searchbox", { name: "Search problems" });
    await page.keyboard.press("Control+f");
    await expect(search).toBeFocused();
    await page.keyboard.type("Sum Two");
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < "Sum Two".length; i++) await page.keyboard.press("Backspace");

    // Create.
    await page.keyboard.press("Control+Alt+n");
    const created = page.getByRole("dialog", { name: "New problem" });
    await expect(created).toBeVisible();
    await pressUntil(page, created.getByLabel("Title"));
    await page.keyboard.type("Typed problem");
    await pressUntil(page, created.getByLabel("Description", { exact: true }));
    await page.keyboard.type("Double a number.");
    await pressUntil(page, created.getByLabel("Signature"));
    await page.keyboard.type("def double(x: int) -> int");
    await pressUntil(page, created.getByLabel("Test 1 args"));
    await page.keyboard.type("[2]");
    await page.keyboard.press("Tab");
    await page.keyboard.type("4");
    await page.keyboard.press("Enter");
    await expect(hud(page, "Problem saved")).toBeVisible();
    await expect(created).toBeHidden();

    // Edit and save.
    await page.keyboard.press("Control+f");
    await page.keyboard.type("Typed problem");
    await expect(rows).toHaveCount(2);
    await pressUntil(page, page.getByRole("button", { name: "Edit Typed problem" }));
    await page.keyboard.press("Enter");
    const edited = page.getByRole("dialog", { name: "Edit problem" });
    await expect(edited.getByLabel("Title")).toHaveValue("Typed problem");
    await pressUntil(page, edited.getByLabel("Title"));
    await page.keyboard.press("End");
    await page.keyboard.type(" v2");
    await page.keyboard.press("Enter");
    await expect(edited).toBeHidden();
    await expect(page.getByRole("cell", { name: "Typed problem v2", exact: true })).toBeVisible();

    // Delete, through the confirmation.
    await pressUntil(page, page.getByRole("button", { name: "Edit Typed problem v2" }));
    await page.keyboard.press("Enter");
    await expect(edited.getByLabel("Title")).toHaveValue("Typed problem v2");
    await pressUntil(page, edited.getByRole("button", { name: "Delete…" }));
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await pressUntil(page, alert.getByRole("button", { name: "Delete", exact: true }));
    await page.keyboard.press("Enter");
    await expect(hud(page, "Problem deleted")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Typed problem v2", exact: true })).toHaveCount(0);
  });

  test("AC-18c: the session screen by keyboard alone, in the planned Tab order", async ({
    page,
    request,
    keycloak,
  }) => {
    const invite = await createSession(request);
    await page.goto(`/s/${invite}`);

    // Join.
    await pressUntil(page, page.getByLabel("Your name"));
    await page.keyboard.type("Ada");
    await page.keyboard.press("Enter");
    const editor = page.locator(".cm-content");
    await expect(editor).toContainText("pass");

    // Tab order: sidebar → toolbar → main → panels; Esc then Tab leaves the editor.
    const regionOfFocus = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        if (el.closest("nav")) return "sidebar";
        if (el.closest("[role=toolbar]")) return "toolbar";
        if (el.closest("main")) return "main";
        if (el.closest("section, [role=region]")) return "panel";
        return "other";
      });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const order: string[] = [];
    for (let i = 0; i < 30 && order.length < 4; i++) {
      await page.keyboard.press("Tab");
      if (await focused(editor)) await page.keyboard.press("Escape");
      const region = await regionOfFocus();
      if (region && region !== "other" && order.at(-1) !== region && !order.includes(region)) {
        order.push(region);
      }
    }
    // The run panel is a stop only once it holds something focusable.
    const panelHasStop = await page
      .getByRole("region", { name: "Run results" })
      .evaluate((el) => el.querySelector("button, a[href], input, [tabindex='0']") !== null);
    expect(order).toEqual(["sidebar", "toolbar", "main", ...(panelHasStop ? ["panel"] : [])]);

    const toolbar = page.getByRole("toolbar", { name: "Session" });
    const button = (name: string) => toolbar.getByRole("button", { name, exact: true });

    // Switch problem from the sidebar.
    const problems = page.getByRole("listbox", { name: "Problems" });
    await pressUntil(page, problems);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(toolbar.getByRole("heading")).not.toHaveText(PROBLEM);

    // Run.
    await toolbarItem(page, "Session", button("Run"));
    await page.keyboard.press("Enter");
    await expectRunStarts(page);

    // Invite.
    await toolbarItem(page, "Session", button("Invite"));
    await page.keyboard.press("Enter");
    await expect(hud(page, "Invite link copied")).toBeVisible();

    // Toggles.
    await toolbarItem(page, "Session", button("Hide run results"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Run results" })).toBeHidden();
    await expect(button("Show run results")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Run results" })).toBeVisible();
    await toolbarItem(page, "Session", button("Hide sidebar"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeHidden();
    await expect(button("Show sidebar")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();

    // Appearance.
    await toolbarItem(page, "Session", button("Appearance"));
    await page.keyboard.press("Enter");
    const appearance = page.getByRole("radiogroup", { name: "Appearance" });
    await expect(appearance).toBeVisible();
    // A native popover's controls follow its button in Tab order.
    await pressUntil(page, appearance);
    await pressUntil(page, appearance.getByRole("radio", { name: "Dark" }), "ArrowLeft", 4);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.appearance)).toBe(
      "dark",
    );
    await page.keyboard.press("Escape");
    await expect(appearance).toBeHidden();

    // Sign in, back to this session.
    await toolbarItem(page, "Session", toolbar.getByRole("link", { name: "Sign in" }));
    await page.keyboard.press("Enter");
    await signInByKeyboard(page, keycloak.users);
    await page.waitForURL((url) => url.pathname === `/s/${invite}`);
    await expect(toolbar.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  });

  test("AC-18c: the empty state's link back, by keyboard alone", async ({ page }) => {
    await page.goto("/nope");
    await pressUntil(page, page.getByRole("link", { name: "Back to problems" }));
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("toolbar", { name: "Problems" })).toBeVisible();
  });
});
