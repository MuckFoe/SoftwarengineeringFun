import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ProblemSummary, RunResult } from "../api/types";
import type { ProviderEvents } from "../collab/provider";
import { ProblemSwitcher } from "./ProblemSwitcher";
import { RunPanel } from "./RunPanel";

function fakeProvider() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const sent: ClientMessage[] = [];
  const provider = {
    send(message: ClientMessage) {
      sent.push(message);
    },
    on<K extends keyof ProviderEvents>(type: K, handler: (payload: ProviderEvents[K]) => void) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      const h = handler as (payload: unknown) => void;
      set.add(h);
      return () => set?.delete(h);
    },
  };
  function emit<K extends keyof ProviderEvents>(type: K, payload: ProviderEvents[K]) {
    for (const h of handlers.get(type) ?? []) h(payload);
  }
  return { provider, sent, emit };
}

function runResult(overrides: Partial<RunResult>): RunResult {
  return { run_id: "r1", problem_id: "p1", accepted: false, results: [], ...overrides };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("ProblemSwitcher", () => {
  const reverseList: ProblemSummary = { id: "p-rev", title: "Reverse list", is_starter: true };

  function stubSearch() {
    const fn = vi.fn(async () => new Response(JSON.stringify([reverseList]), { status: 200 }));
    vi.stubGlobal("fetch", fn);
  }

  it("FR-17: choosing a problem sends switch_problem", async () => {
    stubSearch();
    const { provider, sent } = fakeProvider();
    render(<ProblemSwitcher provider={provider} />);
    await waitFor(() => expect(screen.getByText("Reverse list")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Reverse list" }));

    expect(sent).toEqual([{ type: "switch_problem", problem_id: "p-rev" }]);
  });

  it("FR-10: the switcher stays usable while the current problem is deleted", async () => {
    stubSearch();
    const { provider } = fakeProvider();
    render(<ProblemSwitcher provider={provider} />);
    await waitFor(() => expect(screen.getByText("Reverse list")).toBeTruthy());

    expect(
      (screen.getByRole("button", { name: "Reverse list" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
