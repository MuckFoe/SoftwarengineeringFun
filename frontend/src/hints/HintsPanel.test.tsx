import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hint, HintPending, QuestionAwaiting } from "../api/types";
import { HintsPanel, type HintsPanelProps, oneLine, QUESTION_MAX } from "./HintsPanel";

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
  onQuestion: () => {},
  onReveal: () => {},
  onDecline: () => {},
  selfId: "me",
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
const questionButton = () => screen.queryByRole("button", { name: "Question" });
const questionField = () => screen.getByRole("textbox", { name: "Your question" });

function answer(number: number, extra: Partial<Hint> = {}): Hint {
  return hint(number, {
    id: `q${number}`,
    kind: "question",
    note: null,
    question: `What about case ${number}?`,
    body: `Case ${number} is special.`,
    reveals_solution: false,
    ...extra,
  });
}

function awaitingFrom(participantId: string): QuestionAwaiting {
  return { problem_id: "p1", participant_id: participantId, by: "Gil", question: "the code?" };
}
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

  it("notice in_progress says the model is already working on a request (AC-6)", () => {
    renderPanel({ notice: "in_progress" });
    expect(screen.getByText("The model is already working on a request")).toBeTruthy();
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

  it("Hint asks at once, with no text field (AC-17)", () => {
    const onAsk = vi.fn();
    renderPanel({ onAsk });
    fireEvent.click(hintButton() as HTMLElement);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("the question field: maxLength 500, Enter sends it trimmed (AC-18)", () => {
    const onQuestion = vi.fn();
    renderPanel({ onQuestion });
    expect(questionButton()?.className).toMatch(/secondary/);
    fireEvent.click(questionButton() as HTMLElement);
    const field = questionField() as HTMLInputElement;
    expect(field.maxLength).toBe(QUESTION_MAX);
    fireEvent.change(field, { target: { value: "  what does zip do?  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onQuestion).toHaveBeenCalledWith("what does zip do?");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("oneLine strips line breaks and cuts to 500 characters (AC-18)", () => {
    expect(oneLine("stuck on\nempty\r\ninput")).toBe("stuck on empty input");
    expect(oneLine("a".repeat(501))).toHaveLength(500);
    expect(oneLine("  \n ")).toBe("");
  });

  it("an empty question is not sent (AC-18)", () => {
    const onQuestion = vi.fn();
    renderPanel({ onQuestion });
    fireEvent.click(questionButton() as HTMLElement);
    const ask = screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    fireEvent.change(questionField(), { target: { value: "   " } });
    fireEvent.keyDown(questionField(), { key: "Enter" });
    expect(onQuestion).not.toHaveBeenCalled();
  });

  it("an answer shows 'Model answer', 'Question N', the asker and the question (AC-18)", () => {
    renderPanel({ hints: [hint(1), answer(1, { asked_by: "Gil" })] });
    const card = screen.getByRole("article", { name: "Question 1" });
    expect(within(card).getByText("Model answer")).toBeTruthy();
    expect(within(card).getByText(/Gil/)).toBeTruthy();
    expect(within(card).getByText("What about case 1?")).toBeTruthy();
    expect(within(card).getByText("Case 1 is special.")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Hint 1" })).toBeTruthy();
  });

  it("a revealing answer is marked and its fenced code is a block, as text (AC-19)", () => {
    const body = "Here it is:\n```python\ndef add(a, b):\n    return a + b\n```";
    const { container } = renderPanel({ hints: [answer(1, { body, reveals_solution: true })] });
    expect(screen.getByText(/reveals the solution/)).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "def add(a, b):\n    return a + b",
    );
  });

  it("a pending question shows what is asked (AC-18)", () => {
    renderPanel({
      pending: { ...pendingBy("Gil"), kind: "question", question: "what is zip?" },
    });
    expect(screen.getByText("Answering the question…")).toBeTruthy();
    expect(screen.getByText(/what is zip\?/)).toBeTruthy();
    expect((questionButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("the asker is asked to confirm a revealing answer and can decide (AC-19)", () => {
    const onReveal = vi.fn();
    const onDecline = vi.fn();
    renderPanel({ awaiting: awaitingFrom("me"), onReveal, onDecline });
    const box = screen.getByRole("region", { name: "Answer would reveal the solution" });
    expect(within(box).getByText(/basically the solution/)).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Show the answer" }));
    fireEvent.click(within(box).getByRole("button", { name: "Keep trying" }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("others only see who is deciding, with no choice (AC-19)", () => {
    renderPanel({ awaiting: awaitingFrom("someone-else") });
    expect(screen.queryByRole("button", { name: "Show the answer" })).toBeNull();
    expect(screen.getAllByText(/Gil is deciding/).length).toBeGreaterThan(0);
  });

  it("a body with markup renders as inert text (AC-15)", () => {
    const body = '<img src=x onerror="alert(1)"> try `if not a:`';
    const { container } = renderPanel({ hints: [hint(1, { body, note: "<b>hi</b>" })] });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("code")?.textContent).toBe("if not a:");
  });

  it("keyboard path: Hint focusable, Question focuses its field, Enter sends, Escape cancels and returns focus (AC-16)", () => {
    const onAsk = vi.fn();
    const onQuestion = vi.fn();
    renderPanel({ onAsk, onQuestion });
    const button = hintButton() as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.tabIndex).toBe(0);
    const ask = questionButton() as HTMLButtonElement;
    ask.focus();
    expect(document.activeElement).toBe(ask);
    fireEvent.click(ask); // Enter on a native button activates it
    expect(document.activeElement).toBe(questionField());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.keyDown(questionField(), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(questionButton());
    expect(onQuestion).not.toHaveBeenCalled();

    fireEvent.click(questionButton() as HTMLElement);
    fireEvent.change(questionField(), { target: { value: "loops" } });
    fireEvent.keyDown(questionField(), { key: "Enter" });
    expect(onQuestion).toHaveBeenCalledWith("loops");
    expect(onAsk).not.toHaveBeenCalled();
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
