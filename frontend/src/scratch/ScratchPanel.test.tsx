import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
function setup(r: Run | null, stale = false) {
  const onRun = vi.fn();
  render(<ScratchPanel state={st(r)} stale={stale} onRun={onRun} />);
  return onRun;
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

  it("shows the last run's input and output", () => {
    setup(run());
    expect((screen.getByLabelText("Input") as HTMLTextAreaElement).value).toBe("3");
    expect(screen.getByTestId("scratch-output").textContent).toBe("9\n");
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

  it("FR-9 running run disables Run and names the starter", () => {
    setup(run({ status: "running", started_by: "A" }));
    expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("A");
  });

  it("calls onRun with the typed input", () => {
    const onRun = setup(null);
    fireEvent.change(screen.getByLabelText("Input"), { target: { value: "5\n6" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("5\n6");
  });

  it("FR-12 stale renders no Run control", () => {
    setup(run(), true);
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });

  it("NFR-4 shows markup and escapes literally", () => {
    setup(run({ output: [{ s: "out", t: "<b>x</b>\x1b[31m" }] }));
    const out = screen.getByTestId("scratch-output");
    expect(out.querySelector("b")).toBeNull();
    expect(out.textContent).toBe("<b>x</b>␛[31m");
  });
});
