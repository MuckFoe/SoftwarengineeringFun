/// <reference lib="dom" />
// Spec 015 task 29 (FR-1, FR-5, FR-10): GIF search and the chat GIF tile in the Audi look, in
// both appearances at each width. The fake GIPHY (docker-compose.test.yml) serves the media.
import type { Page } from "@playwright/test";
import { appUrl, createSession, expect, fakeGiphy, test } from "../fixtures";
import { checkScreen, luminance, watchPage } from "./checks";
import { SCHEMES, type Scheme } from "./matrix";

const WIDTHS = [1024, 1920];

const chat = (page: Page) => page.getByRole("region", { name: "Chat" });

async function join(page: Page, invite: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(chat(page).getByRole("button", { name: "GIF", exact: true })).toBeVisible();
}

async function openPicker(page: Page, term?: string): Promise<void> {
  await chat(page).getByRole("button", { name: "GIF", exact: true }).click();
  if (term === undefined) return;
  // The notice is shown once per page load; the second open in a test goes straight to search.
  const cont = chat(page).getByRole("button", { name: "Continue" });
  if (await cont.isVisible()) await cont.click();
  await chat(page).getByLabel("Search GIFs").fill(term);
  await expect(chat(page).getByRole("option", { name: "Happy cat", exact: true })).toBeVisible();
}

test.beforeEach(async () => {
  await fakeGiphy.reset();
});

for (const scheme of SCHEMES as readonly Scheme[]) {
  for (const width of WIDTHS) {
    test.describe(`gif ${scheme} ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      test("FR-5: the third-party notice passes the FR-1 check", async ({ page, request }) => {
        const watch = watchPage(page);
        await join(page, await createSession(request));
        await openPicker(page);
        await expect(chat(page).getByText(/third-party service/)).toBeVisible();
        await checkScreen(page, watch, scheme);
      });

      test("FR-5: search results pass the FR-1 check; cells are rounded on a neutral tile", async ({
        page,
        request,
      }) => {
        const watch = watchPage(page);
        await join(page, await createSession(request));
        await openPicker(page, "cat");
        const cell = chat(page).getByRole("option", { name: "Happy cat", exact: true });
        const style = await cell.evaluate((el) => {
          const s = getComputedStyle(el);
          return { radius: s.borderTopLeftRadius, bg: s.backgroundColor };
        });
        expect(style.radius).toBe("8px");
        expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
        await checkScreen(page, watch, scheme);
      });

      test("spec 016 FR-8: the user's own bubble is accent-coloured, others' are not", async ({
        page,
        request,
      }) => {
        await join(page, await createSession(request));
        await chat(page).getByLabel("Message", { exact: true }).fill("hello there");
        await chat(page).getByRole("button", { name: "Send" }).click();
        const own = chat(page).locator('li[data-own="true"]');
        await expect(own).toBeVisible();
        const bg = (l: ReturnType<typeof own.locator>) =>
          l.evaluate((el) => getComputedStyle(el).backgroundColor);
        const accent = await page.evaluate(() => {
          const p = document.createElement("span");
          p.style.color = "var(--accent)";
          document.body.appendChild(p);
          const c = getComputedStyle(p).color;
          p.remove();
          return c;
        });
        expect(await bg(own)).toBe(accent);
        const others = chat(page).locator('li.chat-bubble:not([data-own="true"])');
        for (const el of await others.all()) expect(await bg(el)).not.toBe(accent);
      });

      test("FR-10: a posted GIF and a missing GIF's placeholder stay legible", async ({
        page,
        request,
      }) => {
        const watch = watchPage(page);
        await join(page, await createSession(request));
        await openPicker(page, "cat");
        await chat(page).getByRole("option", { name: "Happy cat", exact: true }).click();
        const img = chat(page).getByRole("list", { name: "Messages" }).getByRole("img", {
          name: "Happy cat",
        });
        await expect(img).toBeVisible();
        const tile = await img.evaluate((el) => {
          const t = el.closest("picture");
          return t ? getComputedStyle(t).backgroundColor : null;
        });
        expect(tile, "the GIF sits in a tile with a placeholder background").not.toBeNull();
        expect(tile).not.toBe("rgba(0, 0, 0, 0)");

        // The fake's broken-media item renders the placeholder with its caption.
        await openPicker(page, "cat");
        await chat(page)
          .getByRole("option")
          .filter({ hasText: "GIF no longer available" })
          .click();
        const caption = chat(page).getByText("GIF no longer available").last();
        await expect(caption).toBeVisible();
        const colours = await caption.evaluate((el) => {
          const s = getComputedStyle(el);
          return { fg: s.color, bg: s.backgroundColor };
        });
        // Text luminance contrasts with the page canvas side of the scheme.
        if (scheme === "dark") expect(luminance(colours.fg)).toBeGreaterThan(0.4);
        else expect(luminance(colours.fg)).toBeLessThan(0.2);
        await checkScreen(page, watch, scheme);
      });
    });
  }
}
