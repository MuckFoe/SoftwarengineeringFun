import { describe, expect, it } from "vitest";
import { initialLearnState, type LearnState, learnReducer } from "./learnState";
import type { Attempt, LearningRecord, StepView } from "./learnTypes";

function step(position: number, passed = false): StepView {
  return {
    position,
    title: `Step ${position}`,
    kind: "quiz",
    body_html: `<p>${position}</p>`,
    check: { type: "text" },
    has_hint: true,
    hint_html: null,
    show_answer_available: false,
    answer: passed ? { type: "text", accept: ["yes"] } : null,
    attempts: [],
    passed: passed ? { by: "Ada", at: "2026-10-29T10:00:00Z", after_reveal: false } : null,
  };
}

function record(current: number, total = 6): LearningRecord {
  return {
    lesson: {
      key: "docker-basics",
      title: "Docker basics",
      topic: "docker",
      steps: Array.from({ length: total }, (_, i) => ({
        position: i,
        title: `Step ${i}`,
        kind: "quiz" as const,
      })),
    },
    current_step: current,
    completed: false,
    stale: false,
    steps: [...Array.from({ length: current }, (_, i) => step(i, true)), step(current)],
    summary: null,
  };
}

const PEOPLE = [
  { id: "p1", name: "Ada" },
  { id: "p2", name: "Linus" },
];

function joined(current = 3): LearnState {
  return learnReducer(initialLearnState, {
    type: "welcome",
    you: { participant_id: "p1" },
    record: record(current),
    chat: [],
  });
}

const wrong: Attempt = {
  id: 7,
  by: "Linus",
  kind: "text",
  submitted: "no",
  correct: false,
  output: null,
  at: "2026-10-29T10:05:00Z",
};

const stepOf = (s: LearnState, position: number) => s.steps.find((x) => x.position === position);

describe("learnReducer", () => {
  // AC-9 (FR-9)
  it("welcome restores current step, passed steps and participants", () => {
    let s = joined(3);
    s = learnReducer(s, { type: "presence", participants: PEOPLE });
    expect(s.current).toBe(3);
    expect(s.passed).toEqual([0, 1, 2]);
    expect(s.viewing).toBe(3);
    expect(s.you).toBe("p1");
    expect(s.lesson?.title).toBe("Docker basics");
    expect(s.participants).toEqual(PEOPLE);
    expect(s.completed).toBe(false);
  });

  // AC-10 (FR-10, FR-11)
  it("step_passed moves current, and viewing follows when it was on the current step", () => {
    const s = learnReducer(joined(3), {
      type: "step_passed",
      step: 3,
      passed: { by: "Linus", at: "2026-10-29T10:06:00Z", after_reveal: false },
      answer: { type: "text", accept: ["yes"] },
      next: step(4),
    });
    expect(s.current).toBe(4);
    expect(s.viewing).toBe(4);
    expect(s.passed).toEqual([0, 1, 2, 3]);
    expect(stepOf(s, 3)?.passed?.by).toBe("Linus");
    expect(stepOf(s, 3)?.answer).toEqual({ type: "text", accept: ["yes"] });
    expect(stepOf(s, 4)?.passed).toBeNull();
  });

  it("step_passed leaves viewing alone for someone looking back", () => {
    let s = learnReducer(joined(3), { type: "view_step", position: 1 });
    s = learnReducer(s, {
      type: "step_passed",
      step: 3,
      passed: { by: "Linus", at: "2026-10-29T10:06:00Z", after_reveal: false },
      answer: null,
      next: step(4),
    });
    expect(s.current).toBe(4);
    expect(s.viewing).toBe(1);
  });

  it("attempt is appended to its step's history", () => {
    const s = learnReducer(joined(3), {
      type: "attempt",
      step: 3,
      attempt: wrong,
      show_answer_available: false,
    });
    expect(stepOf(s, 3)?.attempts).toEqual([wrong]);
  });

  it("hint_revealed stores the hint on its step", () => {
    const s = learnReducer(joined(3), { type: "hint_revealed", step: 3, hint_html: "<p>h</p>" });
    expect(stepOf(s, 3)?.hint_html).toBe("<p>h</p>");
  });

  // AC-13a (FR-14a)
  it("show answer becomes available after an attempt, and revealing it keeps the step current", () => {
    let s = learnReducer(joined(3), {
      type: "attempt",
      step: 3,
      attempt: wrong,
      show_answer_available: true,
    });
    expect(stepOf(s, 3)?.show_answer_available).toBe(true);
    s = learnReducer(s, {
      type: "answer_revealed",
      step: 3,
      answer: { type: "text", accept: ["yes"] },
    });
    expect(stepOf(s, 3)?.answer).toEqual({ type: "text", accept: ["yes"] });
    expect(stepOf(s, 3)?.show_answer_available).toBe(false);
    expect(s.current).toBe(3);
    expect(stepOf(s, 3)?.passed).toBeNull();
  });

  // AC-14 (FR-15)
  it("view_step to a passed step does not change current", () => {
    const s = learnReducer(joined(3), { type: "view_step", position: 0 });
    expect(s.viewing).toBe(0);
    expect(s.current).toBe(3);
  });

  it("view_step ignores steps not reached yet", () => {
    const s = learnReducer(joined(3), { type: "view_step", position: 5 });
    expect(s.viewing).toBe(3);
  });

  // AC-23 (FR-24)
  it("completed stores the summary and marks the session completed", () => {
    const summary = {
      steps: [{ position: 0, title: "Step 0", attempts: 2, passed_by: "Ada", after_reveal: false }],
    };
    const s = learnReducer(joined(3), { type: "completed", summary });
    expect(s.completed).toBe(true);
    expect(s.summary).toEqual(summary);
  });

  it("error keeps the code and changes nothing else", () => {
    const before = joined(3);
    const s = learnReducer(before, { type: "error", code: "not_current_step" });
    expect(s.error).toBe("not_current_step");
    expect({ ...s, error: null }).toEqual(before);
  });

  it("does not mutate the previous state", () => {
    const before = joined(3);
    const snapshot = structuredClone(before);
    learnReducer(before, { type: "attempt", step: 3, attempt: wrong, show_answer_available: true });
    expect(before).toEqual(snapshot);
  });
});
