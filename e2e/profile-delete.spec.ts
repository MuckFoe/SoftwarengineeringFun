// Spec 019 task 13: a host deletes a presentation session from their profile, end to end.
// AC-4: cancelling the confirmation (by keyboard: Tab to Delete, Enter, Escape) deletes nothing,
// focus returns to Delete and the invite link still works. AC-6: with a second browser context
// in the session, deleting it shows that context "This session was deleted" within 2 s. AC-7:
// reopening the invite link shows the deleted page with a link home.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { appPathname, appUrl, expect, REPO_ROOT, signedInContext, test } from "./fixtures";

const DECK = readFileSync(
  path.join(REPO_ROOT, "backend/tests/fixtures/presentations/single-page.html"),
  "utf-8",
);

const participants = (page: Page) =>
  page.getByRole("list", { name: "Participants" }).getByRole("listitem");

test("a host deletes a presentation from the profile; cancel keeps it, the guest is told", async ({
  browser,
  keycloak,
}) => {
  const title = `Delete me ${Date.now()}`;
  // The host: a signed-in editor adds a deck, starts a session on it and joins first (FR-0).
  const host = await signedInContext(browser, keycloak, "editor2");
  const guestContext = await browser.newContext();
  try {
    const params = new URLSearchParams({ title, topic: "Deletion" });
    const added = await host.page.request.post(appUrl(`/api/present/presentations?${params}`), {
      data: DECK,
      headers: { "content-type": "text/html" },
    });
    expect(added.status()).toBe(201);
    const { id } = (await added.json()) as { id: string };
    const started = await host.page.request.post(appUrl("/api/present/sessions"), {
      data: { presentation_id: id },
    });
    expect(started.status()).toBe(201);
    const invite = ((await started.json()) as { invite_id: string }).invite_id;
    await host.page.goto(appUrl(`/present/s/${invite}`));
    await expect(participants(host.page).filter({ hasText: "(you)" })).toContainText("(host)");

    // The profile in a second tab, so the host stays connected to the session.
    const profile = await host.context.newPage();
    await profile.goto(appUrl("/profile?from=%2F"));
    const hide = profile.getByRole("button", { name: `Hide ${title}`, exact: true });
    const del = profile.getByRole("button", { name: `Delete ${title}`, exact: true });
    const dialog = profile.getByRole("dialog", { name: `Delete ${title}?` });

    await test.step("AC-4: keyboard only, Escape cancels and focus returns to Delete", async () => {
      await hide.focus();
      await profile.keyboard.press("Tab");
      await expect(del).toBeFocused();
      await profile.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("deletes the session for everyone");
      await expect(dialog).toContainText("can't be undone");
      await profile.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(del).toBeFocused();
      await expect(del).toBeVisible();
    });

    // AC-4: the invite link still works: a guest opens it and joins.
    const guest = await guestContext.newPage();
    await guest.goto(appUrl(`/present/s/${invite}`));
    await guest.getByLabel("Your name").fill("Grace");
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(participants(guest).filter({ hasText: "(you)" })).toContainText("Grace");

    await test.step("AC-6: the connected guest is told within 2 s", async () => {
      await del.click();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(guest.getByText("This session was deleted")).toBeVisible({ timeout: 2_000 });
      await expect(del).toHaveCount(0);
      await expect(profile.getByRole("status")).toHaveText(`Deleted ${title}`);
    });

    await test.step("AC-7: the invite link shows the deleted page with a way home", async () => {
      const again = await guestContext.newPage();
      await again.goto(appUrl(`/present/s/${invite}`));
      await expect(again.getByText("This session was deleted")).toBeVisible();
      await again.getByRole("link", { name: "Back to home" }).click();
      await expect(again).toHaveURL((url) => appPathname(url) === "/");
    });
  } finally {
    await guestContext.close();
    await host.context.close();
  }
});
