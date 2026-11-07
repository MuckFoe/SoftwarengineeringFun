/// <reference lib="dom" />
// Spec 015 task 30 (FR-5, FR-10): the HTML presentations library and session render in the
// Audi look (the FR-1 shared checks), and a presentation that sets no background stays legible
// in dark appearance because its stage is white with a 1 px divider border.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { appUrl, expect, REPO_ROOT, test } from "../fixtures";
import { checkScreen, luminance, watchPage } from "./checks";
import { SCHEMES } from "./matrix";

// single-page.html sets no background and no colour: browser defaults, black on transparent.
const PAGE_HTML = readFileSync(
  path.join(REPO_ROOT, "backend/tests/fixtures/presentations/single-page.html"),
  "utf-8",
);

async function startSession(
  page: Page,
  request: APIRequestContext,
  editor: { username: string; password: string },
): Promise<string> {
  const { signIn } = await import("../fixtures");
  await signIn(page, editor.username, editor.password);
  const params = new URLSearchParams({ title: `Audi stage ${Date.now()}`, topic: "Audi" });
  const added = await page.request.post(appUrl(`/api/present/presentations?${params}`), {
    data: PAGE_HTML,
    headers: { "content-type": "text/html" },
  });
  expect(added.status()).toBe(201);
  const { id } = (await added.json()) as { id: string };
  const started = await request.post(appUrl("/api/present/sessions"), {
    data: { presentation_id: id },
  });
  expect(started.status()).toBe(201);
  return ((await started.json()) as { invite_id: string }).invite_id;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

for (const scheme of SCHEMES) {
  test.describe(`presentations ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1024, height: 768 } });

    test("FR-5: the library renders in the Audi look, without a duplicate area nav", async ({
      page,
    }) => {
      const watch = watchPage(page);
      await page.goto(appUrl("/present"));
      await expect(page.getByRole("heading", { name: "Present", level: 1 })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.appearance))
        .toBe(scheme);
      // Area tabs live in the header only; the sidebar holds the topic filter alone.
      await expect(page.getByRole("tablist", { name: "Areas" })).toHaveCount(1);
      await checkScreen(page, watch, scheme);
    });

    test("FR-5/FR-10: a session renders in the Audi look on a white, bordered stage", async ({
      page,
      request,
      keycloak,
    }) => {
      const editor = keycloak.users["editor1"];
      if (!editor) throw new Error("no keycloak test user 'editor1'");
      const invite = await startSession(page, request, editor);
      const watch = watchPage(page);
      await page.goto(appUrl(`/present/s/${invite}`));
      // A signed-in editor joins as their account, without the name prompt.
      const iframe = page.locator("iframe");
      await expect(iframe).toBeVisible();
      await expect(page.frameLocator("iframe").getByRole("heading", { level: 1 })).toBeVisible();

      const stage = await iframe.evaluate((el) => {
        const frame = el.parentElement as HTMLElement;
        const s = getComputedStyle(frame);
        return {
          background: s.backgroundColor,
          scheme: s.colorScheme,
          border: s.borderTopWidth,
          borderColor: s.borderTopColor,
        };
      });
      expect(stage.background).toBe("rgb(255, 255, 255)");
      expect(stage.scheme).toBe("light");
      expect(stage.border).toBe("1px");

      // FR-10: the page's own text against the stage is at least 4.5:1.
      const text = await page
        .frameLocator("iframe")
        .getByRole("heading", { level: 1 })
        .evaluate((el) => getComputedStyle(el).color);
      expect(ratio(text, stage.background)).toBeGreaterThanOrEqual(4.5);

      await checkScreen(page, watch, scheme);
    });
  });
}
