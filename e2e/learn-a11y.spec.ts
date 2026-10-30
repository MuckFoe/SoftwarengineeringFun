/// <reference lib="dom" />
// Spec 006 AC-27 (NFR-1): the Learn area and a learning session pass WCAG AA in light and
// dark at 1024 px, and a participant can focus the terminal, type, submit and read the
// output using only the keyboard.
//
// Same checks as a11y.spec.ts (which stays unedited, AC-29): at 1024×768 nothing overflows
// or is clipped, axe passes, and every Tab stop shows a focus ring. axe runs the WCAG 2.x
// A/AA rule set here, not only colour contrast, since AC-27 asks for WCAG AA as a whole.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { appUrl, expect, test } from "./fixtures";

const LESSON_KEY = "01-docker/01-basics";
const STEP_2_CORRECT = [
  "An image is a read-only template for containers",
  "One image can be used to start several containers at once",
];
// A known command for step 3 that isn't the accepted one, with its canned output.
const WRONG_COMMAND = "docker start web";
const WRONG_OUTPUT = "Error response from daemon: No such container: web";

async function startLearningSession(request: APIRequestContext): Promise<string> {
  const created = await request.post(appUrl("/api/learn/sessions"), {
    data: { lesson_key: LESSON_KEY },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

/**
 * Joins with the mouse and passes step 1. Narrower than 1200 px the sidebar floats over the
 * main area (spec 003 NFR-2), covering the step's left edge, so it is hidden while clicking
 * there and shown again afterwards: the screens are checked as they first appear.
 */
async function joinAtStep2(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/learn/s/${invite}`));
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Image or container?" })).toBeVisible();
}

/** Joins and brings the group to step 3, the first terminal step (sidebar hidden). */
async function joinAtTerminalStep(page: Page, invite: string): Promise<void> {
  await joinAtStep2(page, invite);
  for (const option of STEP_2_CORRECT) {
    await page.getByRole("checkbox", { name: option }).check();
  }
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Run a container" })).toBeVisible();
}

interface Screen {
  name: string;
  open(page: Page, request: APIRequestContext): Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "Learn area",
    async open(page) {
      await page.goto(appUrl("/learn"));
      await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
    },
  },
  {
    name: "learning session name prompt",
    async open(page, request) {
      await page.goto(appUrl(`/learn/s/${await startLearningSession(request)}`));
      await expect(page.getByLabel("Your name")).toBeVisible();
    },
  },
  {
    name: "learning session quiz step",
    async open(page, request) {
      await joinAtStep2(page, await startLearningSession(request));
      // A wrong attempt, so the attempts list is on screen too.
      await page.getByRole("checkbox", { name: STEP_2_CORRECT[0] ?? "" }).check();
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByRole("list", { name: "Attempts" })).toContainText("not correct");
      await page.getByRole("button", { name: "Show sidebar" }).click();
    },
  },
  {
    name: "learning session terminal step",
    async open(page, request) {
      await joinAtTerminalStep(page, await startLearningSession(request));
      const terminal = page.getByRole("log", { name: "Terminal history" });
      await page.getByRole("textbox", { name: "$" }).fill(WRONG_COMMAND);
      await page.getByRole("textbox", { name: "$" }).press("Enter");
      await expect(terminal).toContainText(WRONG_OUTPUT);
      await page.getByRole("button", { name: "Show sidebar" }).click();
    },
  },
];

/** Tabs from the top until focus comes back round; what each stop is and its outline. */
async function tabStops(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: Array<{ element: string; outline: string }> = [];
  let first: string | null = null;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const name =
        el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName;
      return {
        element: `${el.tagName.toLowerCase()}#${el.id}[${name.slice(0, 20)}]@${Array.from(
          el.parentElement?.children ?? [],
        ).indexOf(el)}`,
        outline: s.outlineStyle === "none" || s.outlineWidth === "0px" ? "none" : s.outlineStyle,
      };
    });
    if (!stop) continue;
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
      test(`AC-27 ${screen.name}: fits, passes axe WCAG AA, every Tab stop shows a focus ring`, async ({
        page,
        request,
      }) => {
        await screen.open(page, request);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
          .toBe(scheme);

        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect.soft(overflow.scroll).toBeLessThanOrEqual(overflow.client);
        const clipped = await page.evaluate(() =>
          Array.from(document.querySelectorAll("button, a[href], [role=button], input"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.left < 0 || r.right > window.innerWidth);
            })
            .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()),
        );
        expect.soft(clipped).toEqual([]);

        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
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

        const stops = await tabStops(page);
        expect(stops.length).toBeGreaterThan(0);
        expect(stops.filter((s) => s.outline === "none").map((s) => s.element)).toEqual([]);
      });
    }
  });
}

/** Presses Tab (at most 80 times) until the focused element is `target`. */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, what: string) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab never reached ${what}`);
}

test("AC-27: the terminal can be focused, typed in, submitted and read with the keyboard only", async ({
  page,
  request,
}) => {
  const invite = await startLearningSession(request);
  await page.goto(appUrl(`/learn/s/${invite}`));

  // Join and bring the group to the terminal step without the mouse.
  await tabTo(page, page.getByLabel("Your name"), "the name field");
  await page.keyboard.type("Ada");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Steps" })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Continue" }), "Continue");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Image or container?" })).toBeVisible();
  for (const option of STEP_2_CORRECT) {
    await tabTo(page, page.getByRole("checkbox", { name: option }), option);
    await page.keyboard.press("Space");
  }
  await tabTo(page, page.getByRole("button", { name: "Submit" }), "Submit");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Run a container" })).toBeVisible();

  // Focus the terminal input, type, submit with Enter.
  const input = page.getByRole("textbox", { name: "$" });
  const log = page.getByRole("log", { name: "Terminal history" });
  await tabTo(page, input, "the terminal input");
  await page.keyboard.type(WRONG_COMMAND);
  await expect(input).toHaveValue(WRONG_COMMAND);
  await page.keyboard.press("Enter");

  // The input is cleared and keeps focus; the output lands in the log (a live region).
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(log).toHaveAttribute("aria-live", "polite");
  await expect(log).toContainText(`Ada $ ${WRONG_COMMAND}`);
  await expect(log).toContainText(WRONG_OUTPUT);

  // The history comes just before the input in focus order, so it can be reached (and
  // scrolled) from the keyboard to read the output.
  await page.keyboard.press("Shift+Tab");
  await expect(log).toBeFocused();
  const read = await page.evaluate(() => document.activeElement?.textContent ?? "");
  expect(read).toContain(WRONG_OUTPUT);

  // Back to the input; the accepted command passes the step.
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await page.keyboard.type("docker run -d --name web nginx");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "List running containers" })).toBeVisible();
});
