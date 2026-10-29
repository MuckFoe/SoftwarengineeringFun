import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { Forbidden } from "./Forbidden";
import { NotFound } from "./NotFound";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubSignedOut() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ signed_in: false, roles: [] }), { status: 200 }),
    ),
  );
}

it("NotFound is a window with appearance and account in its toolbar and a link home", async () => {
  stubSignedOut();
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
  const toolbar = screen.getByRole("toolbar");
  expect(toolbar.querySelector("[aria-label='Appearance']")).not.toBeNull();
  expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
  expect(screen.getByRole("main").querySelector("h1")?.textContent).toBe("Page not found");
  expect(screen.getByRole("link", { name: "Back to problems" }).getAttribute("href")).toBe("/");
});

it("NotFound takes a message, such as for an unknown session", () => {
  stubSignedOut();
  render(
    <MemoryRouter>
      <NotFound message="Session not found" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Session not found" })).toBeTruthy();
});

it("Forbidden names the missing role and links home", () => {
  stubSignedOut();
  render(
    <MemoryRouter>
      <Forbidden missingRole="editor" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "You can't do this" })).toBeTruthy();
  expect(screen.getByText(/you lack the editor role/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to problems" }).getAttribute("href")).toBe("/");
});
