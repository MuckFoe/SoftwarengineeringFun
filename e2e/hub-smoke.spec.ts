// Spec 005 FR1, first smoke test of the HUB=1 project (scripts/check-hub.sh): the app,
// deployed on the local hub stand-in, loads its start page at <stand-in>/collab/.
import { expect, test } from "./fixtures";

test("FR1: opening the app's address on the hub loads the start page", async ({ page, baseURL }) => {
  // "" resolves to the baseURL itself, <stand-in>/collab/; "/" would leave the app's path.
  const response = await page.goto("");

  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/collab/");
  expect(page.url()).toBe(baseURL);
  await expect(page.getByRole("toolbar", { name: "Problems" })).toBeVisible();
  // The starter problems came back through the hub, so the API answers under /collab/ too.
  await expect(page.getByRole("button", { name: /^Start session: / }).first()).toBeVisible();
});
