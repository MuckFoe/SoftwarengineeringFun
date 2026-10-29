// Spec 003 AC-14 / FR-13: an unknown URL shows an empty state in the app's window, with
// a way back to the problems screen.
import { expect, test } from "./fixtures";

test("AC-14: /nope shows the empty state, and its link leads back to the problems", async ({
  page,
}) => {
  await page.goto("/nope");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("toolbar")).toBeVisible();
  await expect(page.getByRole("toolbar").getByRole("button", { name: "Appearance" })).toBeVisible();

  const back = main.getByRole("link", { name: "Back to problems" });
  await expect(back).toHaveAttribute("href", "/");
  await back.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("toolbar", { name: "Problems" }).getByRole("heading", { name: "Problems" }),
  ).toBeVisible();
});
