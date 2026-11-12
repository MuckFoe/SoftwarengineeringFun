import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScratchPanel } from "./ScratchPanel";
import type { Run, RunStatus, ScratchState } from "./scratchReducer";

afterEach(cleanup);

function run(over: Partial<Run> = {}): Run {
  return {
    status: "finished",
    started_by: "A",
    started_at: "2026-01-01T00:00:00Z",
    input: "3",
    output: [{ s: "out", t: "9\n" }],
    seq: 2,
    exit_code: 0,
    ...over,
  };
}
const st = (r: Run | null): ScratchState => ({ run: r, needsSnapshot: false, notice: null });
function setup(r: Run | null) {
  render(<ScratchPanel state={st(r)} />);
}

describe("ScratchPanel", () => {
  it.each<[RunStatus, string]>([
    ["finished", "finished"],
    ["error", "error"],
    ["time_limit", "stopped: time limit"],
    ["output_limit", "stopped: output limit"],
    ["interrupted", "stopped: interrupted"],
    ["running", "running…"],
  ])("FR-4 status %s reads %s", (status, text) => {
    setup(run({ status }));
    expect(screen.getByRole("status").textContent).toContain(text);
    expect(screen.getByRole("status").textContent).toContain("started by A");
  });

  it("shows the last run's output and no input box, also for an old run that had input", () => {
    setup(run({ input: "3" }));
    expect(screen.getByTestId("scratch-output").textContent).toBe("9\n");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText("Input")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("before any run, says how to get output", () => {
    setup(null);
    expect(screen.getByText(/Run your code to see its output here/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an error names the exit code and shows the traceback", () => {
    setup(
      run({
        status: "error",
        exit_code: 1,
        output: [
          { s: "out", t: "hello\n" },
          { s: "err", t: "Traceback (most recent call last):\nValueError: bad\n" },
        ],
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("error (exit code 1)");
    expect(screen.getByTestId("scratch-output").textContent).toContain("hello");
    expect(screen.getByTestId("scratch-output").textContent).toContain("ValueError: bad");
  });

  it("FR-3 err segment is distinct, with a marker", () => {
    setup(
      run({
        output: [
          { s: "out", t: "hi" },
          { s: "err", t: "ValueError: bad" },
        ],
      }),
    );
    const err = screen.getByText("ValueError: bad");
    expect(err.className).toMatch(/err/);
    expect(err.getAttribute("data-stream")).toBe("err");
    expect(err.textContent).toContain("stderr");
    expect(screen.getByText("hi").getAttribute("data-stream")).toBe("out");
  });

  it("FR-9 a running run names the starter", () => {
    setup(run({ status: "running", started_by: "A" }));
    expect(screen.getByRole("status").textContent).toContain("A");
  });

  it("NFR-4 shows markup and escapes literally", () => {
    setup(run({ output: [{ s: "out", t: "<b>x</b>\x1b[31m" }] }));
    const out = screen.getByTestId("scratch-output");
    expect(out.querySelector("b")).toBeNull();
    expect(out.textContent).toBe("<b>x</b>␛[31m");
  });
});
