/// <reference lib="dom" />
// Spec 012 FR-15..FR-18, NFR-5: preferences kept with the account and applied in every
// browser the user signs into, kept per browser while signed out, changed from the profile;
// and the profile is keyboard-reachable and passes WCAG AA in light and dark. Each browser
// or device is its own Playwright context, against the production stack and real Keycloak.
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { KeycloakState } from "./global-setup";
import {
  appPathname,
  appUrl,
  createSession,
  expect,
  signedInContext,
  resetPreferences,
  test,
} from "./fixtures";

/** Light OS everywhere, so a dark page can only come from the user's choice. */
const LIGHT_OS = { colorScheme: "light" as const };

interface StoredPrefs {
  appearance: "light" | "dark" | "system";
  chat_visible: boolean;
}

/**
 * Starts the accounts with no stored preferences, so the next sign-in is a "first" one
 * (FR-16). Only prefsuser's row goes: other specs run in parallel.
 */
async function resetPrefs(browser: Browser, keycloak: KeycloakState): Promise<void> {
  const user = keycloak.users.prefsuser;
  if (!user) throw new Error("no keycloak test user 'prefsuser'");
  await resetPreferences(browser, user);
}

const appearance = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-appearance"));

/** The account's stored preferences as `/api/me` returns them for this page's cookies. */
async function accountPrefs(page: Page): Promise<StoredPrefs | null> {
  const me = (await (await page.request.get(appUrl("/api/me"))).json()) as {
    preferences?: StoredPrefs | null;
  };
  return me.preferences ?? null;
}

/** After a first sign-in, the account has taken this browser's values (FR-16). */
async function accountSynced(page: Page): Promise<void> {
  await expect.poll(() => accountPrefs(page)).not.toBeNull();
}

/** The toolbar's appearance setting, as a user changes it where it is used. */
async function chooseAppearance(page: Page, choice: "Light" | "Dark" | "System"): Promise<void> {
  await page.getByRole("button", { name: "Appearance" }).first().click();
  await page.getByRole("menuitemradio", { name: choice }).click();
  await page.keyboard.press("Escape");
}

const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Inspector" }).getByRole("region", { name: "Chat" });

/** Opens a coding session as the signed-in user: no name prompt (task 19), editor loaded. */
async function openSession(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await expect(page.locator(".cm-content")).toContainText("pass");
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

test("FR-15: dark and chat unpinned on the laptop are dark and chat unpinned in another browser", async ({
  browser,
  keycloak,
  request,
}) => {
  await resetPrefs(browser, keycloak);
  const laptop = await signedInContext(browser, keycloak, "prefsuser", "/", LIGHT_OS);
  contexts.push(laptop.context);
  await accountSynced(laptop.page);

  await chooseAppearance(laptop.page, "Dark");
  expect(await appearance(laptop.page)).toBe("dark");
  await openSession(laptop.page, await createSession(request));
  await expect(chat(laptop.page)).toBeVisible();
  await laptop.page.getByRole("button", { name: "Unpin chat" }).click();
  await expect(chat(laptop.page)).toBeHidden();
  await expect
    .poll(() => accountPrefs(laptop.page))
    .toEqual({ appearance: "dark", chat_visible: false });

  const other = await signedInContext(browser, keycloak, "prefsuser", "/", LIGHT_OS);
  contexts.push(other.context);
  await expect.poll(() => appearance(other.page)).toBe("dark");
  await openSession(other.page, await createSession(request));
  expect(await appearance(other.page)).toBe("dark");
  await expect(other.page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
  await expect(chat(other.page)).toBeHidden();
});

test("FR-16: a dark browser's first sign-in keeps dark for the account; another browser is dark too", async ({
  browser,
  keycloak,
}) => {
  await resetPrefs(browser, keycloak);
  const first = await signedInContext(browser, keycloak, "prefsuser", "/", LIGHT_OS, async (page) => {
    await page.goto(appUrl("/"));
    await chooseAppearance(page, "Dark");
  });
  contexts.push(first.context);
  await expect.poll(() => accountPrefs(first.page)).toMatchObject({ appearance: "dark" });
  expect(await appearance(first.page)).toBe("dark");

  const second = await signedInContext(browser, keycloak, "prefsuser", "/", LIGHT_OS);
  contexts.push(second.context);
  await expect.poll(() => appearance(second.page)).toBe("dark");
});

test("FR-17: signed out, a visitor's light is kept in that browser and nothing is sent", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  contexts.push(context);
  const page = await context.newPage();
  const saves: string[] = [];
  page.on("request", (r) => {
    if (appPathname(r.url()) === "/api/me/preferences") saves.push(r.method());
  });

  await page.goto(appUrl("/"));
  await expect.poll(() => appearance(page)).toBe("dark");
  await chooseAppearance(page, "Light");
  expect(await appearance(page)).toBe("light");

  await page.reload();
  await expect.poll(() => appearance(page)).toBe("light");
  const another = await context.newPage();
  await another.goto(appUrl("/"));
  await expect.poll(() => appearance(another)).toBe("light");
  expect(saves).toEqual([]);
});

test("FR-17: prefsuser with dark signs out, and that browser stays dark after reload", async ({
  browser,
  keycloak,
}) => {
  await resetPrefs(browser, keycloak);
  const { context, page } = await signedInContext(browser, keycloak, "prefsuser", "/", LIGHT_OS);
  contexts.push(context);
  await accountSynced(page);
  await chooseAppearance(page, "Dark");
  await expect.poll(() => accountPrefs(page)).toMatchObject({ appearance: "dark" });

  await page.getByRole("link", { name: "prefsuser" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "You're not signed in" })).toBeVisible();
  const me = (await (await page.request.get(appUrl("/api/me"))).json()) as { signed_in: boolean };
  expect(me.signed_in).toBe(false);

  await page.reload();
  await expect(page.getByRole("heading", { name: "You're not signed in" })).toBeVisible();
  expect(await appearance(page)).toBe("dark");
  await page.goto(appUrl("/"));
  await expect.poll(() => appearance(page)).toBe("dark");
});

test("FR-18: Light in the profile turns the app light at once, and a session then shows light", async ({
  browser,
  keycloak,
  request,
}) => {
  await resetPrefs(browser, keycloak);
  const { context, page } = await signedInContext(browser, keycloak, "prefsuser", "/", LIGHT_OS);
  contexts.push(context);
  await accountSynced(page);
  await chooseAppearance(page, "Dark");
  await expect.poll(() => accountPrefs(page)).toMatchObject({ appearance: "dark" });

  await page.getByRole("link", { name: "prefsuser" }).click();
  const prefs = page.getByRole("region", { name: "Preferences" });
  await prefs.getByRole("radio", { name: "Light" }).click();
  // "At once": applied by the click itself, before any reload or request round trip.
  expect(await appearance(page)).toBe("light");
  await expect(prefs.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => accountPrefs(page)).toMatchObject({ appearance: "light" });

  await openSession(page, await createSession(request));
  expect(await appearance(page)).toBe("light");
});

/**
 * Every keyboard-focusable control on the page (native or tabindex ≥ 0, visible, enabled),
 * tagged with an index so the Tab walk can say which it reached.
 */
async function tagControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          el.tabIndex >= 0 &&
          !(el as HTMLButtonElement).disabled &&
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(el).visibility !== "hidden"
        );
      })
      .map((el, i) => {
        el.dataset.e2eControl = String(i);
        return `${i}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName}`;
      });
  });
}

/** Tabs from the top until focus comes round again; the tagged controls it reached. */
async function tabReached(page: Page, budget = 60): Promise<Set<string>> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached = new Set<string>();
  for (let i = 0; i < budget; i++) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.e2eControl ?? null,
    );
    if (tag === null) continue;
    if (reached.has(tag)) break;
    reached.add(tag);
  }
  return reached;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`NFR-5: the profile in ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const who of ["signed in", "signed out"] as const) {
      test(`${who}: every control is reachable by keyboard and WCAG AA passes`, async ({
        browser,
        keycloak,
        request,
      }) => {
        let page: Page;
        if (who === "signed in") {
          await resetPrefs(browser, keycloak);
          const signed = await signedInContext(browser, keycloak, "prefsuser", "/", {
            colorScheme: scheme,
          });
          contexts.push(signed.context);
          page = signed.page;
          // A session in the list, so its Open link and Hide button are on the page too.
          await openSession(page, await createSession(request));
          await page.goto(appUrl("/profile?from=%2F"));
          await expect(page.getByRole("region", { name: "Preferences" })).toBeVisible();
          await expect(page.getByRole("button", { name: /^Hide / }).first()).toBeVisible();
        } else {
          const context = await browser.newContext({ colorScheme: scheme });
          contexts.push(context);
          page = await context.newPage();
          await page.goto(appUrl("/profile?from=%2F"));
          await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
        }
        await expect.poll(() => appearance(page)).toBe(scheme);
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY).map((a) => a.finished.catch(() => undefined))));

        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect
          .soft(
            axe.violations.flatMap((v) =>
              v.nodes.map((n) => `${v.id} ${n.target.join(" ")}: ${n.failureSummary}`),
            ),
          )
          .toEqual([]);

        const controls = await tagControls(page);
        expect(controls.length).toBeGreaterThan(0);
        const reached = await tabReached(page, controls.length + 20);
        expect(controls.filter((c) => !reached.has(c.split(":")[0] ?? ""))).toEqual([]);
      });
    }
  });
}
