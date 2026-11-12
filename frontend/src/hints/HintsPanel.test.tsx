import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hint, HintPending } from "../api/types";
import { HintsPanel, type HintsPanelProps, oneLine } from "./HintsPanel";

function hint(number: number, extra: Partial<Hint> = {}): Hint {
  return {
    id: `h${number}`,
    problem_id: "p1",
    number,
    asked_by: "Ana",
    note: "stuck on empty input",
    body: `Think about case ${number}.`,
    created_at: "2026-11-12T10:00:00Z",
    ...extra,
  };
}

function pendingBy(by: string, warming = false): HintPending {
  return { problem_id: "p1", by, note: null, warming };
}

const BASE: HintsPanelProps = {
  hints: [],
  canAsk: true,
  pending: null,
  notice: null,
  onAsk: () => {},
};

function renderPanel(props: Partial<HintsPanelProps> = {}) {
  const all = { ...BASE, ...props };
  const view = render(<HintsPanel {...all} />);
  return {
    ...view,
    update: (next: Partial<HintsPanelProps>) => {
      Object.assign(all, next);
      view.rerender(<HintsPanel {...all} />);
      for (const sample of samplers) sample();
    },
  };
}

const hintButton = () => screen.queryByRole("button", { name: "Hint" });
const noteField = () => screen.getByRole("textbox", { name: "What are you stuck on? (optional)" });
const liveRegion = () => screen.getByRole("status");

/** Records every distinct text the live region takes after each update, to show each state is
 * announced once. */
const samplers: Array<() => void> = [];
function recordAnnouncements(): { list: string[]; stop(): void } {
  const list: string[] = [];
  let last = liveRegion().textContent ?? "";
  const sample = () => {
    const text = liveRegion().textContent ?? "";
    if (text !== last) {
      last = text;
      if (text) list.push(text);
    }
  };
  samplers.push(sample);
  return { list, stop: () => samplers.splice(samplers.indexOf(sample), 1) };
}

afterEach(cleanup);

describe("HintsPanel (spec 020)", () => {
  it("canAsk false: no Hint button, earlier hints still listed (AC-1, AC-2)", () => {
    renderPanel({ canAsk: false, hints: [hint(1), hint(2)] });
    expect(hintButton()).toBeNull();
    expect(screen.getByRole("heading", { name: "Hint 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Hint 2" })).toBeTruthy();
  });

  it("canAsk false and no hints renders nothing (AC-2)", () => {
    const { container } = renderPanel({ canAsk: false, hints: [] });
    expect(container.innerHTML).toBe("");
  });

  it("canAsk true shows a secondary Hint button (AC-1)", () => {
    renderPanel();
    const button = hintButton();
    expect(button).toBeTruthy();
    expect(button?.className).toMatch(/secondary/);
  });

  it("each hint shows 'Model hint', 'Hint N', the asker and the note (AC-3)", () => {
    renderPanel({ hints: [hint(1, { asked_by: "Guest Gil" })] });
    const card = screen.getByRole("article", { name: "Hint 1" });
    expect(within(card).getByText("Model hint")).toBeTruthy();
    expect(within(card).getByText(/Guest Gil/)).toBeTruthy();
    expect(within(card).getByText(/stuck on empty input/)).toBeTruthy();
    expect(within(card).getByText("Think about case 1.")).toBeTruthy();
  });

  it("a hint with no note shows no note (AC-4)", () => {
    renderPanel({ hints: [hint(1, { note: null })] });
    const card = screen.getByRole("article", { name: "Hint 1" });
    expect(card.querySelector("[data-hint-note]")).toBeNull();
  });

  it("pending shows the preparing line with who asked (AC-3)", () => {
    renderPanel({ pending: pendingBy("Guest Gil") });
    expect(screen.getByText("Preparing hint…")).toBeTruthy();
    expect(screen.getByText(/Asked by Guest Gil/)).toBeTruthy();
  });

  it("the Hint button is disabled while pending (AC-6)", () => {
    renderPanel({ pending: pendingBy("Bo") });
    expect((hintButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("notice in_progress says a hint is already being prepared (AC-6)", () => {
    renderPanel({ notice: "in_progress" });
    expect(screen.getByText("A hint is already being prepared")).toBeTruthy();
  });

  it("notice unavailable and withheld (AC-12, AC-8)", () => {
    const { update } = renderPanel({ notice: "unavailable" });
    expect(screen.getAllByText("Hints are unavailable right now").length).toBeGreaterThan(0);
    update({ notice: "withheld" });
    expect(screen.getAllByText("No hint could be given this time").length).toBeGreaterThan(0);
  });

  it("pending.warming shows the warming-up line, announced once (AC-12a)", () => {
    const { update } = renderPanel({ pending: pendingBy("Bo") });
    const rec = recordAnnouncements();
    update({ pending: pendingBy("Bo", true) });
    update({ pending: pendingBy("Bo", true) });
    const warming = "Model is warming up. This hint takes longer.";
    expect(screen.getAllByText(warming).length).toBeGreaterThan(0);
    expect(screen.queryByText("Preparing hint…")).toBeNull();
    expect(rec.list.filter((t) => t === warming)).toHaveLength(1);
    rec.stop();
  });

  it("the note field: maxLength 200, Enter sends, line breaks stripped (AC-4)", () => {
    const onAsk = vi.fn();
    renderPanel({ onAsk });
    fireEvent.click(hintButton() as HTMLElement);
    const field = noteField() as HTMLInputElement;
    expect(field.maxLength).toBe(200);
    fireEvent.change(field, { target: { value: `stuck on\nempty input${"x".repeat(250)}` } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledTimes(1);
    const sent = String(onAsk.mock.calls[0]?.[0]);
    expect(sent).not.toMatch(/[\r\n]/);
    expect(sent.length).toBeLessThanOrEqual(200);
    expect(sent.startsWith("stuck on")).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("oneLine strips line breaks and cuts to 200 characters (AC-4)", () => {
    expect(oneLine("stuck on\nempty\r\ninput")).toBe("stuck on empty input");
    expect(oneLine("a".repeat(201))).toHaveLength(200);
    expect(oneLine("  \n ")).toBe("");
  });

  it("an empty note sends an empty string via Ask", () => {
    const onAsk = vi.fn();
    renderPanel({ onAsk });
    fireEvent.click(hintButton() as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).toHaveBeenCalledWith("");
  });

  it("a body with markup renders as inert text (AC-15)", () => {
    const body = '<img src=x onerror="alert(1)"> try `if not a:`';
    const { container } = renderPanel({ hints: [hint(1, { body, note: "<b>hi</b>" })] });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("code")?.textContent).toBe("if not a:");
  });

  it("keyboard path: Hint focusable, reveal focuses the note, Enter sends, Escape cancels and returns focus (AC-16)", () => {
    const onAsk = vi.fn();
    renderPanel({ onAsk });
    const button = hintButton() as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button); // Enter on a native button activates it
    expect(document.activeElement).toBe(noteField());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.keyDown(noteField(), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(hintButton());
    expect(onAsk).not.toHaveBeenCalled();

    fireEvent.click(hintButton() as HTMLElement);
    fireEvent.change(noteField(), { target: { value: "loops" } });
    fireEvent.keyDown(noteField(), { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("loops");
  });

  it("the live region announces each state change exactly once (AC-16)", () => {
    const { update } = renderPanel({ hints: [hint(1)] });
    expect(liveRegion().getAttribute("aria-live")).toBe("polite");
    const rec = recordAnnouncements();
    update({ pending: pendingBy("Gil") });
    update({ pending: pendingBy("Gil") });
    update({ pending: null, hints: [hint(1), hint(2)] });
    update({ hints: [hint(1), hint(2)] });
    update({ pending: pendingBy("Ana") });
    update({ pending: null, notice: "unavailable" });
    update({ notice: "unavailable" });
    update({ notice: null, pending: pendingBy("Ana") });
    update({ pending: null, notice: "withheld" });
    expect(rec.list).toEqual([
      "Preparing a hint for Gil",
      "Hint 2 ready",
      "Preparing a hint for Ana",
      "Hints are unavailable right now",
      "Preparing a hint for Ana",
      "No hint could be given this time",
    ]);
    rec.stop();
  });

  it("switching problems (new hints without a pending request) announces nothing", () => {
    const { update } = renderPanel({ hints: [hint(1)] });
    const rec = recordAnnouncements();
    update({ hints: [hint(1, { id: "other", problem_id: "p2" })] });
    expect(rec.list).toEqual([]);
    rec.stop();
  });
});
