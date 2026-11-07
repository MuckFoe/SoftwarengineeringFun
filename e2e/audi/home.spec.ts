/// <reference lib="dom" />
// Spec 017 task 17: the home screen in the Audi look (spec 016 shared checks), both appearances,
// at each width, and with reduced motion (no endless animation, no transition running).
import { expect, test } from "../fixtures";
import { checkScreen, emulateReducedMotion, expectReducedMotion, watchPage } from "./checks";
import { SCHEMES, SCREENS, widthsFor } from "./matrix";

const home = SCREENS.find((s) => s.name === "home screen");
if (!home) throw new Error("matrix lacks the home screen");

for (const scheme of SCHEMES) {
  for (const width of widthsFor(home)) {
    test.describe(`home ${scheme} ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      test("Look: the home screen passes the shared checks", async ({ page, request, keycloak }) => {
        const watch = watchPage(page);
        await home.open(page, request, keycloak.users);
        await checkScreen(page, watch, scheme);
      });
    });
  }

  test.describe(`home reduced motion ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1024, height: 800 } });

    test("Look: reduced motion leaves nothing animating or transitioning", async ({
      page,
      request,
      keycloak,
    }) => {
      await emulateReducedMotion(page);
      await home.open(page, request, keycloak.users);
      await expectReducedMotion(page);
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => (a instanceof CSSTransition ? `transition ${a.transitionProperty}` : "animation")),
      );
      expect(running, "animations or transitions running under reduced motion").toEqual([]);
    });
  });
}
