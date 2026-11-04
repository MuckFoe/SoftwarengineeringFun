import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api/types";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { PresentationEditorSheet } from "./PresentationEditorSheet";
import { PresentWindow } from "./PresentWindow";
import type { PresentationSummary } from "./presentTypes";

const TCP: PresentationSummary = {
  id: "p1",
  title: "TCP handshakes",
  topic: "Networking",
  kind: "slides",
  slide_count: 4,
};
const EDITOR: Me = { signed_in: true, name: "Ed", roles: ["editor"], preferences: null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Answers {
  analyze?: () => Response;
  add?: () => Response;
  replace?: () => Response;
  remove?: () => Response;
}

// The backend is not part of this unit; only the HTTP boundary is stubbed (plan.md REST).
function stubServer(answers: Answers = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const path = url.pathname;
    if (path === "/api/me") return json(EDITOR);
    if (path === "/api/present/presentations" && method === "GET") return json([TCP]);
    if (path === "/api/present/analyze") {
      return answers.analyze?.() ?? json({ kind: "slides", slide_count: 4 });
    }
    if (path === "/api/present/presentations" && method === "POST") {
      return (
        answers.add?.() ??
        json(
          {
            id: "p9",
            title: url.searchParams.get("title"),
            topic: url.searchParams.get("topic"),
            kind: "slides",
            slide_count: 4,
          },
          201,
        )
      );
    }
    if (path === "/api/present/presentations/p1/html" && method === "PUT") {
      return answers.replace?.() ?? json({ ...TCP, slide_count: 6 });
    }
    if (path === "/api/present/presentations/p1" && method === "DELETE") {
      return answers.remove?.() ?? new Response(null, { status: 204 });
    }
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

type Request = Parameters<typeof PresentationEditorSheet>[0]["request"];

function renderSheet(request: Request, answers: Answers = {}) {
  const fetchMock = stubServer(answers);
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onRemoved: vi.fn() };
  render(
    <ShortcutsProvider>
      <PresentationEditorSheet
        request={request}
        presentation={request.mode === "add" ? undefined : TCP}
        {...handlers}
      />
    </ShortcutsProvider>,
  );
  return { fetchMock, ...handlers };
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText("HTML file"), { target: { files: [file] } });
}

function paste(markup: string) {
  fireEvent.click(screen.getByRole("radio", { name: "Paste" }));
  fill("HTML", markup);
}

const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
const check = () => fireEvent.click(screen.getByRole("button", { name: "Check" }));

const calls = (fetchMock: ReturnType<typeof stubServer>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      new URL(String(url), "http://localhost").pathname === path &&
      (init?.method ?? "GET") === method,
  );

const html = (text = "<section data-slide>1</section>") =>
  new File([text], "deck.html", { type: "text/html" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PresentationEditorSheet", () => {
  it("AC-1: saving an uploaded file sends add with title, topic and the file", async () => {
    const { fetchMock, onSaved } = renderSheet({ mode: "add" });
    fill("Title", "Intro to DNS");
    fill("Topic", "Networking");
    const file = html();
    chooseFile(file);
    check();
    await screen.findByText(/Presentation of 4 slides/);
    fireEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [call] = calls(fetchMock, "POST", "/api/present/presentations");
    const url = new URL(String(call?.[0]), "http://localhost");
    expect(url.searchParams.get("title")).toBe("Intro to DNS");
    expect(url.searchParams.get("topic")).toBe("Networking");
    expect(call?.[1]?.body).toBe(file);
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ id: "p9", title: "Intro to DNS" });
  });

  it("AC-1: saving pasted markup sends add with the pasted text", async () => {
    const { fetchMock, onSaved } = renderSheet({ mode: "add" });
    fill("Title", "Intro to DNS");
    fill("Topic", "Networking");
    paste("<h1>Hello</h1>");
    check();
    await screen.findByText(/Presentation of 4 slides/);
    fireEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [analyzeCall] = calls(fetchMock, "POST", "/api/present/analyze");
    expect(analyzeCall?.[1]?.body).toBe("<h1>Hello</h1>");
    const [call] = calls(fetchMock, "POST", "/api/present/presentations");
    expect(call?.[1]?.body).toBe("<h1>Hello</h1>");
  });

  it.each([
    ["an empty title", "", "Networking", /enter a title/i],
    ["an empty topic", "Intro to DNS", "  ", /enter a topic/i],
    ["a 101-character title", "x".repeat(101), "Networking", /100 characters/],
    ["a 61-character topic", "Intro to DNS", "y".repeat(61), /60 characters/],
  ])("AC-1: %s blocks save with a message", async (_, title, topic, message) => {
    const { fetchMock, onSaved } = renderSheet({ mode: "add" });
    fill("Title", title);
    fill("Topic", topic);
    chooseFile(html());
    check();
    await screen.findByText(/Presentation of 4 slides/);
    fireEvent.click(save());

    expect(await screen.findByText(message)).toBeTruthy();
    expect(calls(fetchMock, "POST", "/api/present/presentations")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("AC-2: Save is enabled only after Check says how many slides", async () => {
    renderSheet({ mode: "add" });
    fill("Title", "Intro to DNS");
    fill("Topic", "Networking");
    chooseFile(html());
    expect(save().disabled).toBe(true);
    check();
    expect(await screen.findByText("Presentation of 4 slides")).toBeTruthy();
    expect(save().disabled).toBe(false);

    // Changing the HTML needs a new check.
    chooseFile(html("<p>other</p>"));
    expect(save().disabled).toBe(true);
    expect(screen.queryByText("Presentation of 4 slides")).toBeNull();
  });

  it("AC-2: HTML without slide marks is announced as a single page", async () => {
    renderSheet({ mode: "add" }, { analyze: () => json({ kind: "page", slide_count: 0 }) });
    chooseFile(html("<p>no slides</p>"));
    check();
    expect(await screen.findByText(/single page/i)).toBeTruthy();
    expect(save().disabled).toBe(false);
  });

  it("AC-3: a too_large answer names the 5 MB limit and nothing is saved", async () => {
    const { fetchMock, onSaved } = renderSheet(
      { mode: "add" },
      { analyze: () => json({ error: "too_large", limit_bytes: 5 * 1024 * 1024 }, 413) },
    );
    fill("Title", "Big");
    fill("Topic", "Networking");
    chooseFile(html());
    check();
    expect(await screen.findByText(/5 MB/)).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.click(save());
    expect(calls(fetchMock, "POST", "/api/present/presentations")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("AC-3: a not_html answer says it isn't HTML", async () => {
    renderSheet({ mode: "add" }, { analyze: () => json({ error: "not_html" }, 422) });
    chooseFile(new File(["\x89PNG"], "image.html", { type: "text/html" }));
    check();
    expect(await screen.findByText(/isn't HTML/)).toBeTruthy();
    expect(save().disabled).toBe(true);
  });

  it("AC-3: a refusal on save is shown and the sheet stays open", async () => {
    const { onSaved } = renderSheet(
      { mode: "add" },
      { add: () => json({ error: "too_large", limit_bytes: 5 * 1024 * 1024 }, 413) },
    );
    fill("Title", "Intro to DNS");
    fill("Topic", "Networking");
    chooseFile(html());
    check();
    await screen.findByText(/Presentation of 4 slides/);
    fireEvent.click(save());
    expect(await screen.findByText(/5 MB/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("AC-4: Replace checks and sends replaceHtml for that presentation", async () => {
    const { fetchMock, onSaved } = renderSheet(
      { mode: "replace", id: "p1" },
      { analyze: () => json({ kind: "slides", slide_count: 6 }) },
    );
    expect(screen.getByRole("dialog", { name: /TCP handshakes/ })).toBeTruthy();
    expect(screen.queryByLabelText("Title")).toBeNull();
    const file = html();
    chooseFile(file);
    check();
    await screen.findByText("Presentation of 6 slides");
    fireEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [call] = calls(fetchMock, "PUT", "/api/present/presentations/p1/html");
    expect(call?.[1]?.body).toBe(file);
    expect(calls(fetchMock, "POST", "/api/present/presentations")).toHaveLength(0);
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ id: "p1", slide_count: 6 });
  });

  it("AC-5: Remove asks to confirm, then calls remove", async () => {
    const { fetchMock, onRemoved, onClose } = renderSheet({ mode: "remove", id: "p1" });
    expect(screen.getByText(/Remove “TCP handshakes”\?/)).toBeTruthy();
    expect(calls(fetchMock, "DELETE", "/api/present/presentations/p1")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(calls(fetchMock, "DELETE", "/api/present/presentations/p1")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("p1"));
    expect(calls(fetchMock, "DELETE", "/api/present/presentations/p1")).toHaveLength(1);
  });

  it("a refused remove is shown and nothing is reported removed", async () => {
    const { onRemoved } = renderSheet(
      { mode: "remove", id: "p1" },
      { remove: () => json({ error: "missing_role", role: "editor" }, 403) },
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/editor/i)).toBeTruthy();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});

describe("PresentWindow with the editor sheet", () => {
  async function renderWindow(answers: Answers = {}) {
    const fetchMock = stubServer(answers);
    render(
      <ShortcutsProvider>
        <MemoryRouter initialEntries={["/present"]}>
          <PresentWindow />
        </MemoryRouter>
      </ShortcutsProvider>,
    );
    await screen.findByText("TCP handshakes");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    return fetchMock;
  }

  it("AC-1: Add presentation opens the sheet and the saved row appears", async () => {
    await renderWindow();
    fireEvent.click(await screen.findByRole("button", { name: "Add presentation" }));
    const sheet = screen.getByRole("dialog", { name: "Add presentation" });
    fireEvent.change(within(sheet).getByLabelText("Title"), { target: { value: "Intro to DNS" } });
    fireEvent.change(within(sheet).getByLabelText("Topic"), { target: { value: "Networking" } });
    chooseFile(html());
    check();
    await screen.findByText("Presentation of 4 slides");
    fireEvent.click(save());

    const row = await screen.findByRole("row", { name: /Intro to DNS/ });
    expect(within(row).getByText("Networking")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AC-4: Replace updates the row's slide count", async () => {
    await renderWindow({ analyze: () => json({ kind: "slides", slide_count: 6 }) });
    fireEvent.click(await screen.findByRole("button", { name: "Replace HTML: TCP handshakes" }));
    chooseFile(html());
    check();
    await screen.findByText("Presentation of 6 slides");
    fireEvent.click(save());
    const row = screen.getByRole("row", { name: /TCP handshakes/ });
    await waitFor(() => expect(within(row).getByText("6 slides")).toBeTruthy());
  });

  it("AC-5: Remove confirms, then the row disappears", async () => {
    const fetchMock = await renderWindow();
    fireEvent.click(await screen.findByRole("button", { name: "Remove: TCP handshakes" }));
    expect(calls(fetchMock, "DELETE", "/api/present/presentations/p1")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("TCP handshakes")).toBeNull());
    expect(calls(fetchMock, "DELETE", "/api/present/presentations/p1")).toHaveLength(1);
  });
});
