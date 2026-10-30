// Spec 006 AC-1 (FR-1) and AC-10 (FR-10, NFR-2): the Learn area is reachable from the main
// navigation, and when one participant passes a step every participant is on the next one
// within 1 second. Runs against the real lesson `lessons/01-docker/01-basics`:
//   step 1 "Images and containers"  explanation (Continue)
//   step 2 "Image or container?"    choice, multiple; correct = options 1 and 3
//   step 3 "Run a container"        terminal
import type { APIRequestContext, Page } from "@playwright/test";
import { appPathname, appUrl, expect, openContexts, test } from "./fixtures";

const LESSON_KEY = "01-docker/01-basics";
const STEP_2_CORRECT = [
  "An image is a read-only template for containers",
  "One image can be used to start several containers at once",
];

async function startLearningSession(request: APIRequestContext): Promise<string> {
  const created = await request.post(appUrl("/api/learn/sessions"), {
    data: { lesson_key: LESSON_KEY },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/learn/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("list", { name: "Steps" })).toBeVisible();
}

/** The step the page marks as the group's current one (`aria-current="step"`). */
function currentStep(page: Page) {
  return page.getByRole("list", { name: "Steps" }).locator('button[aria-current="step"]');
}

// Browser-side, as strings (this package's tsconfig has no DOM lib). Both pages run in the
// same browser, so `performance.timeOrigin + performance.now()` is a shared clock.

/** Submitter: record when the quiz form is submitted, before the app handles it. */
const RECORD_SUBMIT = `() => {
  window.__submittedAt = null;
  document.addEventListener("submit", () => {
    window.__submittedAt ??= performance.timeOrigin + performance.now();
  }, true);
}`;

/** Every participant: record when the step list first marks step 3 as current. */
const RECORD_STEP_3 = `() => {
  window.__step3At = null;
  const list = document.querySelector('ol[aria-label="Steps"]');
  const check = () => {
    const current = list.querySelector('button[aria-current="step"]');
    if (window.__step3At === null && current && /^3\\./.test(current.textContent ?? "")) {
      window.__step3At = performance.timeOrigin + performance.now();
    }
  };
  new MutationObserver(check).observe(list, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });
}`;

test("AC-1: from the home page, the Learn entry in the main navigation opens the Learn area", async ({
  page,
}) => {
  await page.goto(appUrl("/"));
  const areas = page.getByRole("region", { name: "Areas" });
  await expect(areas.getByRole("link", { name: "Problems" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await areas.getByRole("link", { name: "Learn" }).click();

  await page.waitForURL((url) => appPathname(url) === "/learn");
  await expect(page.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();
  await expect(areas.getByRole("link", { name: "Learn" })).toHaveAttribute("aria-current", "page");
  // The Learn area lists the topics and their lessons, each startable.
  await expect(page.getByRole("heading", { level: 2, name: "Docker" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start session: Basics" }).first()).toBeVisible();
});

test("AC-10: when A passes step 2, A and B are both on step 3 within 1 second, passed by A", async ({
  browser,
  request,
  browserName,
}) => {
  const invite = await startLearningSession(request);
  const [contextA, contextB] = await openContexts(browser, 2);
  if (!contextA || !contextB) throw new Error("could not open two browser contexts");
  try {
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    await join(a, invite, "Ada");
    await join(b, invite, "Bob");

    // Both on step 2.
    await a.getByRole("button", { name: "Continue" }).click();
    for (const page of [a, b]) {
      await expect(currentStep(page)).toHaveText(/^2\. Image or container\?/);
      await expect(page.getByRole("heading", { level: 2, name: "Image or container?" })).toBeVisible();
    }

    await a.evaluate(`(${RECORD_SUBMIT})()`);
    await a.evaluate(`(${RECORD_STEP_3})()`);
    await b.evaluate(`(${RECORD_STEP_3})()`);

    for (const option of STEP_2_CORRECT) {
      await a.getByRole("checkbox", { name: option }).check();
    }
    await a.getByRole("button", { name: "Submit" }).click();

    for (const page of [a, b]) {
      await page.waitForFunction("window.__step3At !== null", null, { polling: "raf" });
      await expect(currentStep(page)).toHaveText(/^3\. Run a container/);
      await expect(page.getByRole("heading", { level: 2, name: "Run a container" })).toBeVisible();
    }

    const submittedAt = (await a.evaluate("window.__submittedAt")) as number;
    const latencyA = ((await a.evaluate("window.__step3At")) as number) - submittedAt;
    const latencyB = ((await b.evaluate("window.__step3At")) as number) - submittedAt;
    console.log(
      `AC-10 ${browserName}: step 3 reached ${latencyA.toFixed(1)} ms (A), ` +
        `${latencyB.toFixed(1)} ms (B) after A submitted`,
    );
    expect(latencyA).toBeLessThan(1000);
    expect(latencyB).toBeLessThan(1000);

    // Step 2 is recorded as passed by A, as both see when looking back at it.
    for (const page of [a, b]) {
      const step2 = page.getByRole("list", { name: "Steps" }).getByRole("button", {
        name: /^2\. Image or container\?/,
      });
      await expect(step2).toContainText("passed");
      await step2.click();
      await expect(page.getByText("Passed by Ada")).toBeVisible();
    }
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
