// FR-1, FR-2b: single sign-on against the real (test) Keycloak.
import { expect, signInViaKeycloak, test } from "./fixtures";

test("FR-1: a signed-out visitor opening 'new problem' lands on the Keycloak login page", async ({
  page,
}) => {
  await page.goto("/problems/new");

  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
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
  await page.getByRole("textbox", { name: "Username" }).fill(editor.username);
  await page.getByRole("textbox", { name: "Password" }).fill(editor.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: "New problem" })).toBeVisible();

  // Drop only our app's own session cookie; Keycloak's SSO cookie is untouched, so this
  // simulates a user who is signed in to Keycloak but has never visited our app before.
  await page.context().clearCookies({ name: "session" });

  await page.goto("/problems/new");

  await expect(page.getByRole("heading", { name: "New problem" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toHaveCount(0);
});

// Every other spec signs in with a cached session cookie (fixtures.signIn); this keeps the
// real Keycloak form and callback exercised once per role.
for (const name of ["admin1", "plain1", "editor2"] as const) {
  test(`FR-1: ${name} signs in through Keycloak's page and the app reports their roles`, async ({
    page,
    keycloak,
  }) => {
    const user = keycloak.users[name];
    if (!user) throw new Error(`no keycloak test user '${name}'`);
    await signInViaKeycloak(page, user.username, user.password, "/");
    const me = (await (await page.request.get("/api/me")).json()) as { roles?: string[] };
    expect([...(me.roles ?? [])].sort()).toEqual([...user.roles].sort());
  });
}
