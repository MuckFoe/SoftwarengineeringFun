/// <reference lib="dom" />
// Spec 003 AC-20, AC-21 (NFR-2, NFR-4): at 1024×768, in light and in dark, every screen
// fits without horizontal scrolling or clipped controls, passes axe's colour-contrast
// rule, and shows a focus ring on everything Tab reaches.
import { execFileSync } from "node:child_process";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PROBLEM = "Sum Two Numbers";

type Users = Record<string, { username: string; password: string }>;

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get(`/api/problems?q=${encodeURIComponent(PROBLEM)}`);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === PROBLEM);
  if (!problem) throw new Error(`no seeded problem titled ${PROBLEM}`);
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

/** Marks the session stale in the stack's database, as the stale-session job would. */
function markStale(invite: string): void {
  if (!/^[\w-]+$/.test(invite)) throw new Error(`unexpected invite id ${invite}`);
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "update session set stale_at = now() where invite_id = '${invite}'"`,
    ],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );
}

async function signInAsEditor(page: Page, users: Users, next: string): Promise<void> {
  const editor = users.editor1;
  if (!editor) throw new Error("no keycloak test user 'editor1'");
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("textbox", { name: "Username" }).fill(editor.username);
  await page.getByRole("textbox", { name: "Password" }).fill(editor.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => url.pathname === next);
}

interface Screen {
  name: string;
  open(page: Page, request: APIRequestContext, users: Users): Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "problems",
    async open(page) {
      await page.goto("/");
      await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
    },
  },
  {
    name: "problem sheet",
    async open(page, _request, users) {
      await signInAsEditor(page, users, "/problems/new");
      await expect(page.getByRole("dialog", { name: "New problem" })).toBeVisible();
    },
  },
  {
    name: "session",
    async open(page, request) {
      await page.goto(`/s/${await createSession(request)}`);
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.getByLabel("Your name")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("textbox")).toContainText("pass");
    },
  },
  {
    name: "stale session",
    async open(page, request) {
      const invite = await createSession(request);
      markStale(invite);
      await page.goto(`/s/${invite}`);
      await expect(page.getByRole("status").filter({ hasText: /gone stale/ })).toBeVisible();
    },
  },
  {
    name: "empty state",
    async open(page) {
      await page.goto("/nope");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    },
  },
  {
    name: "Keycloak login",
    async open(page) {
      await page.goto("/api/auth/login?next=%2F");
      await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    },
  },
];

/**
 * Tabs from the top until focus comes back round; what each stop is and its outline. The
 * code editor keeps Tab, so it is left with Esc then Tab (FR-21), and its ring is drawn
 * on the editor's frame rather than its inner editable line box.
 */
async function tabStops(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: Array<{ element: string; outline: string }> = [];
  let first: string | null = null;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    // CodeMirror marks itself focused a frame after focus moves in.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el.closest(".cm-editor") ?? el);
      const name =
        el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName;
      return {
        // Identity for spotting the wrap-around, readable in a failure message.
        element: `${el.tagName.toLowerCase()}#${el.id}[${name.slice(0, 20)}]@${Array.from(
          el.parentElement?.children ?? [],
        ).indexOf(el)}`,
        outline: s.outlineStyle === "none" || s.outlineWidth === "0px" ? "none" : s.outlineStyle,
      };
    });
    if (!stop) continue;
    if (await page.evaluate(() => (document.activeElement as HTMLElement).isContentEditable)) {
      await page.keyboard.press("Escape");
    }
    if (stop.element === first) break;
    first ??= stop.element;
    stops.push(stop);
  }
  return stops;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} appearance at 1024×768`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1024, height: 768 } });

    for (const screen of SCREENS) {
      test(`${screen.name}: fits, contrast passes, every Tab stop shows a focus ring`, async ({
        page,
        request,
        keycloak,
      }) => {
        await screen.open(page, request, keycloak.users);
        if (screen.name !== "Keycloak login") {
          await expect
            .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
            .toBe(scheme);
        }

        // AC-20: no horizontal scroll, no control cut off at the sides.
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect.soft(overflow.scroll).toBeLessThanOrEqual(overflow.client);
        const clipped = await page.evaluate(() =>
          Array.from(document.querySelectorAll("button, a[href], [role=button]"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.left < 0 || r.right > window.innerWidth);
            })
            .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()),
        );
        expect.soft(clipped).toEqual([]);

        // AC-21: WCAG AA contrast on every text/control pair, measured once rows and sheets
        // have finished fading in.
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
        const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
        expect.soft(
          axe.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`)),
        ).toEqual([]);

        // AC-21: Tab reaches the controls, and each one shows a focus ring.
        const stops = await tabStops(page);
        expect(stops.length).toBeGreaterThan(0);
        expect(stops.filter((s) => s.outline === "none").map((s) => s.element)).toEqual([]);
      });
    }
  });
}
