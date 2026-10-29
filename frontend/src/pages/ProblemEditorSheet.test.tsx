import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { ProblemEditorSheet } from "./ProblemEditorSheet";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EXISTING = {
  id: "abc",
  title: "Existing problem",
  description: "Add them",
  signature: "def add(a: int, b: int) -> int",
  tests: [{ args: [1, 2], expected: 3 }],
};

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(responses: { post?: Response; put?: Response; del?: Response } = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === "/api/problems/abc/edit") return json(200, EXISTING);
    if (method === "POST" && url.pathname === "/api/problems") {
      return responses.post ?? json(201, { id: "new-id" });
    }
    if (method === "POST" && url.pathname === "/api/images") {
      return json(201, { id: "img-1", url: "/api/images/img-1" });
    }
    if (method === "PUT") return responses.put ?? json(200, {});
    if (method === "DELETE") return responses.del ?? new Response(null, { status: 204 });
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderSheet(problemId?: string) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn() };
  render(
    <ShortcutsProvider>
      <ProblemEditorSheet open problemId={problemId} {...handlers} />
    </ShortcutsProvider>,
  );
  return handlers;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValid() {
  fill("Title", "Sum two");
  fill("Description", "Add a and b");
  fill("Signature", "def add(a: int, b: int) -> int");
  fill("Test 1 args", "[2, 3]");
  fill("Test 1 expected", "5");
}

const fieldValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProblemEditorSheet", () => {
  // AC-2 (component part)
  it("creates inside a dialog and saves with the save shortcut", async () => {
    const fetchMock = stubServer();
    const { onSaved } = renderSheet();
    const dialog = screen.getByRole("dialog", { name: "New problem" });
    expect(within(dialog).getByLabelText("Title")).toBeTruthy();
    fillValid();

    fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true });

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      title: "Sum two",
      description: "Add a and b",
      signature: "def add(a: int, b: int) -> int",
      tests: [{ args: [2, 3], expected: 5 }],
    });
  });

  // AC-17 (component part)
  it("formats the description and adds an image inside the sheet, and saves them", async () => {
    const fetchMock = stubServer();
    const { onSaved } = renderSheet();
    const dialog = screen.getByRole("dialog", { name: "New problem" });
    fillValid();
    const source = within(dialog).getByLabelText("Description") as HTMLTextAreaElement;
    source.setSelectionRange(0, 3);

    fireEvent.click(
      within(within(dialog).getByRole("toolbar", { name: "Formatting" })).getByRole("button", {
        name: "Bold",
      }),
    );
    expect(fieldValue("Description")).toBe("**Add** a and b");

    source.setSelectionRange(source.value.length, source.value.length);
    const png = new File(["\x89PNG"], "diagram.png", { type: "image/png" });
    fireEvent.change(within(dialog).getByLabelText("Image file"), { target: { files: [png] } });
    await waitFor(() =>
      expect(fieldValue("Description")).toBe("**Add** a and b![diagram](/api/images/img-1)"),
    );
    expect(screen.getByRole("dialog", { name: "New problem" })).toBe(dialog);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const post = fetchMock.mock.calls.find(
      ([url, init]) => init?.method === "POST" && String(url) === "/api/problems",
    );
    expect(JSON.parse(String(post?.[1]?.body)).description).toBe(
      "**Add** a and b![diagram](/api/images/img-1)",
    );
  });

  it("shows a rejected description's message beside the Description field", async () => {
    stubServer({
      post: json(422, {
        errors: [{ field: "description", message: "A description is required" }],
      }),
    });
    renderSheet();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const message = await screen.findByText("A description is required");
    const source = screen.getByLabelText("Description");
    expect((source.getAttribute("aria-describedby") ?? "").split(" ")).toContain(
      message.closest("[id]")?.id,
    );
    expect(source.getAttribute("aria-invalid")).toBe("true");
  });

  it("saves with the Save button (the sheet's default action)", async () => {
    stubServer();
    const { onSaved } = renderSheet();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("edits inside a dialog, loaded from the server", async () => {
    const fetchMock = stubServer();
    const { onSaved } = renderSheet("abc");
    expect(screen.getByRole("dialog", { name: "Edit problem" })).toBeTruthy();
    await waitFor(() => expect(fieldValue("Title")).toBe("Existing problem"));
    expect(fieldValue("Test 1 args")).toBe("[1,2]");
    fill("Title", "Renamed");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(String(put?.[0])).toBe("/api/problems/abc");
  });

  // AC-4
  it("explains a rejected save beside the field and keeps every input", async () => {
    stubServer({
      post: json(422, {
        errors: [
          { field: "signature", message: "The signature could not be parsed" },
          { field: "tests", test_index: 0, message: "Expected must be an int" },
        ],
      }),
    });
    const { onSaved } = renderSheet();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const message = await screen.findByText("The signature could not be parsed");
    const signature = screen.getByLabelText("Signature");
    const describedBy = (signature.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toContain(message.closest("[id]")?.id);
    expect(signature.getAttribute("aria-invalid")).toBe("true");

    const rowMessage = screen.getByText("Expected must be an int");
    expect(
      (screen.getByLabelText("Test 1 expected").getAttribute("aria-describedby") ?? "").split(" "),
    ).toContain(rowMessage.closest("[id]")?.id);

    expect(fieldValue("Title")).toBe("Sum two");
    expect(fieldValue("Description")).toBe("Add a and b");
    expect(fieldValue("Signature")).toBe("def add(a: int, b: int) -> int");
    expect(fieldValue("Test 1 args")).toBe("[2, 3]");
    expect(fieldValue("Test 1 expected")).toBe("5");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rejects test rows that aren't JSON before sending, with the message beside the row", async () => {
    const fetchMock = stubServer();
    renderSheet();
    fillValid();
    fill("Test 1 args", "[2, 3");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const message = await screen.findByText(/args and expected must be valid JSON/);
    expect(screen.getByLabelText("Test 1 args").getAttribute("aria-describedby") ?? "").toContain(
      message.closest("[id]")?.id ?? "missing",
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("adds and removes test rows", () => {
    stubServer();
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Add test" }));
    expect(screen.getByLabelText("Test 2 args")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove test 2" }));
    expect(screen.queryByLabelText("Test 2 args")).toBeNull();
  });

  it("deletes only after the alert is confirmed", async () => {
    const fetchMock = stubServer();
    const { onDeleted } = renderSheet("abc");
    await waitFor(() => expect(fieldValue("Title")).toBe("Existing problem"));

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    const alert = screen.getByRole("alertdialog", { name: /Delete “Existing problem”\?/ });
    fireEvent.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it("has no delete when creating", () => {
    stubServer();
    renderSheet();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
  });

  it("Cancel closes without saving", () => {
    stubServer();
    const { onClose, onSaved } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
