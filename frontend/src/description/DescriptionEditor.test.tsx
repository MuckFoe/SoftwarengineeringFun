import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionEditor } from "./DescriptionEditor";
import { DescriptionView } from "./DescriptionView";

const IMAGE_ID = "0b8e6f4a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubServer(responses: { upload?: Response; preview?: Response } = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (init?.method === "POST" && path === "/api/images") {
      return responses.upload ?? json(201, { id: IMAGE_ID, url: `/api/images/${IMAGE_ID}` });
    }
    if (init?.method === "POST" && path === "/api/problems/preview") {
      return responses.preview ?? json(200, { html: "<h2>Task</h2>\n<p>Add them.</p>\n" });
    }
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calls = (fetchMock: ReturnType<typeof stubServer>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === path);

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <DescriptionEditor value={value} onChange={setValue} />;
}

function renderEditor(initial = "") {
  render(<Harness initial={initial} />);
  return screen.getByLabelText("Description") as HTMLTextAreaElement;
}

function pickFile(file: File) {
  fireEvent.click(screen.getByRole("button", { name: "Image" }));
  fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [file] } });
}

function fileOf(size: number, type: string, name = "picture.png") {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const tenImages = Array.from(
  { length: 10 },
  (_, i) => `![i${i}](/api/images/00000000-0000-4000-8000-${String(i).padStart(12, "0")})`,
).join("\n\n");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DescriptionEditor toolbar (FR2)", () => {
  it.each([
    ["Heading", "Task", 0, 0, "## Task"],
    ["Bold", "a b c", 2, 3, "a **b** c"],
    ["Italic", "a b c", 2, 3, "a *b* c"],
    ["Bulleted list", "one\ntwo", 0, 7, "- one\n- two"],
    ["Numbered list", "one\ntwo", 0, 7, "1. one\n2. two"],
    ["Inline code", "call f now", 5, 6, "call `f` now"],
    ["Code block", "x = 1", 0, 5, "```\nx = 1\n```"],
    ["Link", "docs", 0, 4, "[docs](https://)"],
  ])("%s applies its command to the selection", (name, initial, start, end, expected) => {
    stubServer();
    const textarea = renderEditor(initial);
    textarea.setSelectionRange(start, end);

    fireEvent.click(screen.getByRole("button", { name }));

    expect(textarea.value).toBe(expected);
  });

  it("every button is in one keyboard toolbar: one tab stop, arrows reach each", () => {
    stubServer();
    renderEditor();
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Heading",
      "Bold",
      "Italic",
      "Bulleted list",
      "Numbered list",
      "Inline code",
      "Code block",
      "Link",
      "Image",
    ]);
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);

    buttons[0]?.focus();
    for (const next of buttons.slice(1)) {
      fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
      expect(document.activeElement).toBe(next);
    }
  });
});

describe("DescriptionEditor images", () => {
  it("FR4: a 3 MB image is refused naming 2 MB; nothing is uploaded or changed", () => {
    const fetchMock = stubServer();
    const textarea = renderEditor("Existing text.");

    pickFile(fileOf(3 * 1024 * 1024, "image/png"));

    expect(screen.getByRole("alert").textContent).toContain("2 MB");
    expect(calls(fetchMock, "/api/images")).toHaveLength(0);
    expect(textarea.value).toBe("Existing text.");
  });

  it("FR4: a PDF is refused listing the accepted formats", () => {
    const fetchMock = stubServer();
    const textarea = renderEditor("Existing text.");

    pickFile(fileOf(1000, "application/pdf", "doc.pdf"));

    const message = screen.getByRole("alert").textContent ?? "";
    for (const name of ["PNG", "JPEG", "GIF", "WebP"]) expect(message).toContain(name);
    expect(calls(fetchMock, "/api/images")).toHaveLength(0);
    expect(textarea.value).toBe("Existing text.");
  });

  it("FR4: an 11th image is refused stating the limit of 10", () => {
    const fetchMock = stubServer();
    const textarea = renderEditor(tenImages);

    pickFile(fileOf(1000, "image/png"));

    expect(screen.getByRole("alert").textContent).toContain("10");
    expect(calls(fetchMock, "/api/images")).toHaveLength(0);
    expect(textarea.value).toBe(tenImages);
  });

  it("FR3: a successful upload inserts the reference at the cursor", async () => {
    const fetchMock = stubServer();
    const textarea = renderEditor("Para one.\n\nPara two.");
    const cursor = "Para one.\n\n".length;
    textarea.setSelectionRange(cursor, cursor);

    pickFile(fileOf(1000, "image/png", "diagram.png"));

    await waitFor(() =>
      expect(textarea.value).toBe(`Para one.\n\n![diagram](/api/images/${IMAGE_ID})Para two.`),
    );
    expect(calls(fetchMock, "/api/images")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refusal from the server is shown and the text is unchanged", async () => {
    stubServer({ upload: json(413, { error: "image_too_large", limit_bytes: 2097152 }) });
    const textarea = renderEditor("Existing text.");

    pickFile(fileOf(1000, "image/png"));

    expect((await screen.findByRole("alert")).textContent).toContain("2 MB");
    expect(textarea.value).toBe("Existing text.");
  });
});

describe("DescriptionEditor preview (FR5)", () => {
  it("shows the server's html, saves nothing, and switching back keeps the source", async () => {
    const fetchMock = stubServer();
    renderEditor("## Task\n\nAdd them.");

    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    expect(await screen.findByRole("heading", { name: "Task" })).toBeTruthy();
    expect(screen.getByText("Add them.")).toBeTruthy();
    const preview = calls(fetchMock, "/api/problems/preview");
    expect(preview).toHaveLength(1);
    expect(JSON.parse(String(preview[0]?.[1]?.body))).toEqual({
      description: "## Task\n\nAdd them.",
    });
    expect(fetchMock.mock.calls.every(([url]) => String(url) !== "/api/problems")).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Write" }));

    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "## Task\n\nAdd them.",
    );
  });
});

describe("DescriptionView", () => {
  it("renders the server html into its container", () => {
    const { container } = render(
      <DescriptionView
        html={`<h2>Task</h2>\n<p><img src="/api/images/${IMAGE_ID}" alt="a" /></p>`}
      />,
    );
    expect(screen.getByRole("heading", { name: "Task" })).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/api/images/${IMAGE_ID}`);
  });
});
