import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../api/types";
import { PresenceList } from "./PresenceList";
import { RunPanel } from "./RunPanel";

function runResult(overrides: Partial<RunResult>): RunResult {
  return { run_id: "r1", problem_id: "p1", accepted: false, results: [], ...overrides };
}

afterEach(cleanup);

describe("RunPanel", () => {
  function renderPanel(overrides: Partial<Parameters<typeof RunPanel>[0]> = {}) {
    const onRun = vi.fn();
    render(
      <RunPanel
        running={false}
        deleted={false}
        progress={{ accepted: false }}
        notice={null}
        onRun={onRun}
        {...overrides}
      />,
    );
    return onRun;
  }

  function runButton() {
    return screen.getByRole("button", { name: /run/i }) as HTMLButtonElement;
  }

  it("FR-22: two wrong_answer results render with no values", () => {
    renderPanel({
      progress: {
        accepted: false,
        last_run: runResult({
          results: [
            { position: 1, outcome: "wrong_answer" },
            { position: 2, outcome: "wrong_answer" },
          ],
        }),
      },
    });

    expect(screen.getByText("Test 1: wrong answer")).toBeTruthy();
    expect(screen.getByText("Test 2: wrong answer")).toBeTruthy();
  });

  it("FR-22: an error shows its message and traceback", () => {
    renderPanel({
      progress: {
        accepted: false,
        last_run: runResult({
          results: [{ position: 1, outcome: "error", error_message: "bad", traceback: "Trace" }],
        }),
      },
    });

    expect(screen.getByText("— bad")).toBeTruthy();
    expect(screen.getByText("Trace")).toBeTruthy();
  });

  it("FR-23: an accepted problem shows the accepted badge", () => {
    renderPanel({ progress: { accepted: true } });

    expect(screen.getByText("Accepted")).toBeTruthy();
  });

  it("FR-26: while running, the button is disabled and the indicator is shown", () => {
    renderPanel({ running: true });

    expect(runButton().disabled).toBe(true);
    expect(screen.getByText("Running…")).toBeTruthy();
  });

  it("FR-10: a deleted problem disables run and shows a notice", () => {
    renderPanel({ deleted: true });

    expect(runButton().disabled).toBe(true);
    expect(screen.getByText(/deleted/i)).toBeTruthy();
  });

  it("calls onRun when the run button is clicked", () => {
    const onRun = renderPanel();

    fireEvent.click(runButton());

    expect(onRun).toHaveBeenCalledOnce();
  });
});

describe("RunPanel feedback (spec 003)", () => {
  // AC-3: a progress indicator appears inline at once, no dialog, the result replaces it.
  it("shows a spinner as soon as a run starts and replaces it with the result", () => {
    const props = { deleted: false, notice: null, onRun: () => {} };
    const { rerender } = render(
      <RunPanel {...props} running={false} progress={{ accepted: false }} />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(<RunPanel {...props} running progress={{ accepted: false }} />);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Test 1:/)).toBeNull();

    rerender(
      <RunPanel
        {...props}
        running={false}
        progress={{
          accepted: true,
          last_run: runResult({ accepted: true, results: [{ position: 1, outcome: "passed" }] }),
        }}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Test 1: passed")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides the previous result while a new run is in progress", () => {
    render(
      <RunPanel
        deleted={false}
        notice={null}
        onRun={() => {}}
        running
        progress={{
          accepted: false,
          last_run: runResult({ results: [{ position: 1, outcome: "wrong_answer" }] }),
        }}
      />,
    );
    expect(screen.queryByText("Test 1: wrong answer")).toBeNull();
  });

  it("shows a failed run as an inline alert", () => {
    renderNotice("The runner is unavailable.");
    expect(screen.getByRole("alert").textContent).toContain("The runner is unavailable.");
  });

  function renderNotice(notice: string) {
    render(
      <RunPanel
        deleted={false}
        notice={notice}
        onRun={() => {}}
        running={false}
        progress={{ accepted: false }}
      />,
    );
  }
});

describe("PresenceList (spec 003)", () => {
  it("shows each participant as a row with a colour dot that fades in", () => {
    render(
      <PresenceList
        participants={[
          { id: "a", name: "Ada" },
          { id: "l", name: "Linus" },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Ada", "Linus"]);
    for (const row of rows) {
      expect(row.className).toMatch(/anim-row-in/);
      const dot = row.querySelector("[data-dot]") as HTMLElement | null;
      expect(dot?.style.background).toMatch(/^var\(--presence-[1-6]\)$/);
    }
  });

  it("gives a participant the same colour on every render", () => {
    const { rerender } = render(<PresenceList participants={[{ id: "a", name: "Ada" }]} />);
    const colour = () => (document.querySelector("[data-dot]") as HTMLElement).style.background;
    const first = colour();
    rerender(
      <PresenceList
        participants={[
          { id: "z", name: "Zed" },
          { id: "a", name: "Ada" },
        ]}
      />,
    );
    const ada = screen.getByText("Ada").closest("li")?.querySelector("[data-dot]") as HTMLElement;
    expect(ada.style.background).toBe(first);
  });

  it("fades a leaving participant out without keeping their name in the list", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <PresenceList
          participants={[
            { id: "a", name: "Ada" },
            { id: "l", name: "Linus" },
          ]}
        />,
      );
      rerender(<PresenceList participants={[{ id: "a", name: "Ada" }]} />);
      expect(screen.queryByText("Linus")).toBeNull();
      const ghost = document.querySelector("[data-leaving]");
      expect(ghost?.className).toMatch(/anim-row-out/);
      expect(ghost?.getAttribute("aria-hidden")).toBe("true");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(document.querySelector("[data-leaving]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
