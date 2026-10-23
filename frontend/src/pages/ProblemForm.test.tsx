import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProblemForm } from "./ProblemForm";

const ME_EDITOR = { signed_in: true, name: "editor1", roles: ["editor"] };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface StubOptions {
  getEdit?: unknown;
  postResponse?: Response;
  putResponse?: Response;
  deleteResponse?: Response;
}

function stubServer(options: StubOptions = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === "/api/me") return json(200, ME_EDITOR);
    if (method === "GET" && url.pathname.endsWith("/edit")) {
      return options.getEdit ? json(200, options.getEdit) : json(404, { error: "not_found" });
    }
    if (method === "POST" && url.pathname === "/api/problems") {
      return options.postResponse ?? json(201, { id: "new-id" });
    }
    if (method === "PUT") return options.putResponse ?? json(200, {});
    if (method === "DELETE") return options.deleteResponse ?? new Response(null, { status: 204 });
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={["/problems/new"]}>
      <Routes>
        <Route path="/" element={<p>problem list</p>} />
        <Route path="/problems/new" element={<ProblemForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEdit(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/problems/${id}/edit`]}>
      <Routes>
        <Route path="/" element={<p>problem list</p>} />
        <Route path="/problems/:id/edit" element={<ProblemForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProblemForm", () => {
  it("FR-4: submitting with zero tests shows a message naming the missing tests", async () => {
    stubServer({
      postResponse: json(422, { errors: [{ field: "tests", message: "Add at least one test" }] }),
    });
    renderCreate();
    await screen.findByLabelText("Title");

    fireEvent.click(screen.getByRole("button", { name: /remove test 1/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Sum two" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Signature"), {
      target: { value: "def add(a: int, b: int) -> int" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await screen.findByText("Add at least one test");
  });

  it("FR-4: a 422 with test_index 0 is shown on test row 1", async () => {
    stubServer({
      postResponse: json(422, {
        errors: [{ field: "tests", test_index: 0, message: "Test 1: wrong number of arguments" }],
      }),
    });
    renderCreate();
    await screen.findByLabelText("Title");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Sum two" } });
    fireEvent.change(screen.getByLabelText("Signature"), {
      target: { value: "def add(a: int, b: int) -> int" },
    });
    fireEvent.change(screen.getByLabelText("Test 1 args"), { target: { value: "[2]" } });
    fireEvent.change(screen.getByLabelText("Test 1 expected"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await screen.findByText("Test 1: wrong number of arguments");
  });

  it("FR-7: edit mode shows the existing tests", async () => {
    stubServer({
      getEdit: {
        id: "p1",
        title: "Sum two",
        description: "add a and b",
        signature: "def add(a: int, b: int) -> int",
        tests: [
          { args: [2, 3], expected: 5 },
          { args: [0, 0], expected: 0 },
        ],
      },
    });
    renderEdit("p1");

    await waitFor(() =>
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Sum two"),
    );
    expect((screen.getByLabelText("Test 1 args") as HTMLInputElement).value).toBe("[2,3]");
    expect((screen.getByLabelText("Test 1 expected") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Test 2 args") as HTMLInputElement).value).toBe("[0,0]");
    expect((screen.getByLabelText("Test 2 expected") as HTMLInputElement).value).toBe("0");
  });

  it("FR-8: delete calls DELETE and navigates to the list", async () => {
    const fetchFn = stubServer({
      getEdit: {
        id: "p1",
        title: "Sum two",
        description: "d",
        signature: "def add(a: int, b: int) -> int",
        tests: [{ args: [2, 3], expected: 5 }],
      },
    });
    renderEdit("p1");
    await waitFor(() =>
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Sum two"),
    );

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await screen.findByText("problem list");
    const del = fetchFn.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(del && String(del[0])).toBe("/api/problems/p1");
  });
});
