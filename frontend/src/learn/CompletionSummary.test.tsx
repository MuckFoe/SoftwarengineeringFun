import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompletionSummary } from "./CompletionSummary";
import type { Summary } from "./learnTypes";

const summary: Summary = {
  steps: [
    {
      position: 1,
      title: "Images and containers",
      attempts: 0,
      passed_by: "Ada",
      after_reveal: false,
    },
    { position: 2, title: "Which runs?", attempts: 4, passed_by: "Linus", after_reveal: true },
    { position: 3, title: "Run it", attempts: 1, passed_by: "Grace", after_reveal: false },
  ],
};

afterEach(cleanup);

function rows(): HTMLElement[] {
  const table = screen.getByRole("table", { name: "Completion summary" });
  // First row is the header.
  return within(table).getAllByRole("row").slice(1);
}

/** Each body row as its cells' text. */
function cellTexts(): string[][] {
  return rows().map((r) =>
    within(r)
      .getAllByRole("cell")
      .map((c) => c.textContent ?? ""),
  );
}

describe("CompletionSummary (FR-24)", () => {
  // AC-23: each step, its attempt count and who passed it.
  it("lists every step with its title, attempt count and who passed it", () => {
    render(<CompletionSummary summary={summary} />);
    expect(cellTexts()).toEqual(
      summary.steps.map((step) => [
        expect.stringContaining(step.title),
        String(step.attempts),
        expect.stringContaining(step.passed_by),
      ]),
    );
  });

  it("lists steps in position order", () => {
    const shuffled: Summary = { steps: [...summary.steps].reverse() };
    render(<CompletionSummary summary={shuffled} />);
    expect(cellTexts().map(([title]) => title)).toEqual(
      summary.steps.map((s) => expect.stringContaining(s.title)),
    );
  });

  // AC-23: the revealed marker when after_reveal.
  it("marks steps passed after the answer was revealed, and only those", () => {
    render(<CompletionSummary summary={summary} />);
    const marked = rows().map((r) => within(r).queryByText("after answer shown") !== null);
    expect(marked).toEqual([false, true, false]);
  });

  it("renders participant names and titles as text, not HTML (NFR-4)", () => {
    const hostile: Summary = {
      steps: [
        {
          position: 1,
          title: "<b>t</b>",
          attempts: 1,
          passed_by: "<img src=x>",
          after_reveal: false,
        },
      ],
    };
    const { container } = render(<CompletionSummary summary={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<img src=x>")).toBeTruthy();
  });
});
