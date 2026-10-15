import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Me } from "../api/types";
import { RequireRole } from "./RequireRole";

function stubMe(me: Me) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(me), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderGuard(redirect: (url: string) => void) {
  return render(
    <MemoryRouter initialEntries={["/problems/new?from=list"]}>
      {/* biome-ignore lint/a11y/useValidAriaRole: `role` is RequireRole's prop, not an ARIA role */}
      <RequireRole role="editor" redirect={redirect}>
        <form aria-label="New problem" />
      </RequireRole>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("FR-1: a visitor who is not signed in is redirected to the login URL", async () => {
  const fetchMock = stubMe({ signed_in: false, roles: [] });
  const redirect = vi.fn();

  renderGuard(redirect);

  await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.anything());
  expect(redirect).toHaveBeenCalledWith(
    `/api/auth/login?next=${encodeURIComponent("/problems/new?from=list")}`,
  );
  expect(screen.queryByRole("form", { name: "New problem" })).toBeNull();
});

test("FR-2a: a signed-in user without the editor role sees the missing-role message, not the form", async () => {
  stubMe({ signed_in: true, name: "Viewer", roles: ["viewer"] });
  const redirect = vi.fn();

  renderGuard(redirect);

  expect(await screen.findByText(/you lack the editor role/i)).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New problem" })).toBeNull();
  expect(redirect).not.toHaveBeenCalled();
});

test("FR-2: a signed-in editor sees the guarded content", async () => {
  stubMe({ signed_in: true, name: "Editor", roles: ["editor"] });
  const redirect = vi.fn();

  renderGuard(redirect);

  expect(await screen.findByRole("form", { name: "New problem" })).toBeTruthy();
  expect(screen.queryByText(/you lack the editor role/i)).toBeNull();
  expect(redirect).not.toHaveBeenCalled();
});

test("nothing guarded is rendered while /api/me is loading", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const redirect = vi.fn();

  renderGuard(redirect);

  expect(screen.queryByRole("form", { name: "New problem" })).toBeNull();
  expect(redirect).not.toHaveBeenCalled();
});

test("a failed /api/me shows an error instead of the guarded content", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 500 })),
  );
  const redirect = vi.fn();

  renderGuard(redirect);

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New problem" })).toBeNull();
  expect(redirect).not.toHaveBeenCalled();
});
