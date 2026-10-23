// FR-1, FR-2b: single sign-on against the real (test) Keycloak.
import { expect, test } from "./fixtures";

test("FR-1: a signed-out visitor opening 'new problem' lands on the Keycloak login page", async ({
  page,
}) => {
  await page.goto("/problems/new");

  await expect(page.locator("#kc-form-login")).toBeVisible();
  await expect(page).toHaveURL(/\/realms\/collab-test\/protocol\/openid-connect\/auth/);
});

test("FR-2b: already signed in to Keycloak, the form appears with no credential prompt", async ({
  page,
  keycloak,
}) => {
  const editor = keycloak.users.editor1;
  if (!editor) {
    throw new Error("no keycloak test user 'editor1'");
  }

  // First sign-in: establishes both our app's session and Keycloak's own SSO session.
  await page.goto("/problems/new");
  await page.locator("#username").fill(editor.username);
  await page.locator("#password").fill(editor.password);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "New problem" })).toBeVisible();

  // Drop only our app's own session cookie; Keycloak's SSO cookie is untouched, so this
  // simulates a user who is signed in to Keycloak but has never visited our app before.
  await page.context().clearCookies({ name: "session" });

  await page.goto("/problems/new");

  await expect(page.getByRole("heading", { name: "New problem" })).toBeVisible();
  await expect(page.locator("#kc-form-login")).toHaveCount(0);
});
