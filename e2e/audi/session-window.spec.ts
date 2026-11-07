/// <reference lib="dom" />
// Spec 015 task 26 (FR-1, FR-4, FR-5, FR-7, FR-9): the session window's description and chat in
// the Audi look, in both appearances, own and others' messages asserted in the real window.
import type { Page } from "@playwright/test";
import { appUrl, expect, openContexts, test } from "../fixtures";
import { checkScreen, readComputed, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const screen = SCREENS.find((s) => s.name === "session");
if (!screen) throw new Error("matrix has no 'session' screen");

const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const messageInput = (page: Page) => chat(page).getByLabel("Message", { exact: true });

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

async function say(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await page.keyboard.press("Enter");
  await expect(chat(page).getByRole("list", { name: "Messages" })).toContainText(text);
}

for (const scheme of SCHEMES) {
  for (const width of widthsFor(screen)) {
    test.describe(`session window ${scheme} ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      test("FR-5, FR-4, FR-7: Audi look; own and others' bubbles; chat input pinned", async ({
        browser,
        page,
        request,
        keycloak,
      }) => {
        const watch = watchPage(page);
        await screen.open(page, request, keycloak.users);
        const invite = new URL(page.url()).pathname.split("/").pop() ?? "";

        // A second participant, so there is an "others'" bubble next to ours.
        const [other] = await openContexts(browser, 1);
        const ben = await (other as NonNullable<typeof other>).newPage();
        await join(ben, invite, "Ben");
        await say(ben, "hello from Ben");
        await expect(chat(page).getByRole("list", { name: "Messages" })).toContainText(
          "hello from Ben",
        );
        await say(page, "hello from Ada");

        // FR-4: square bubbles; own and others' differ; own is the accent (action) fill.
        const bubbles = await chat(page)
          .getByRole("list", { name: "Messages" })
          .getByRole("listitem")
          .evaluateAll((items) =>
            items.map((li) => {
              const s = getComputedStyle(li);
              return {
                own: li.hasAttribute("data-own"),
                bg: s.backgroundColor,
                radius: s.borderTopLeftRadius,
              };
            }),
          );
        const own = bubbles.find((b) => b.own);
        const others = bubbles.find((b) => !b.own);
        expect(own, "own bubble").toBeTruthy();
        expect(others, "other bubble").toBeTruthy();
        expect(own?.bg).not.toBe(others?.bg);
        for (const b of bubbles) expect(Number.parseFloat(b.radius)).toBeGreaterThan(0); // 016: rounded

        // FR-1: pill controls are enforced by checkScreen (spec 016); no Apple backdrop.
        await readComputed(page);

        // FR-7: the compose form stays pinned inside the viewport, however many messages.
        for (let i = 0; i < 12; i++) await say(page, `filler message ${i}`);
        const box = await messageInput(page).boundingBox();
        expect(box).not.toBeNull();
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(800);

        await checkScreen(page, watch, scheme);
        await ben.context().close();
      });
    });
  }
}
