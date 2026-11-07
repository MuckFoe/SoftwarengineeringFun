import { describe, expect, it } from "vitest";
import { initialScratchState, type Run, type ScratchState, scratchReducer } from "./scratchReducer";

const run = (over: Partial<Run> = {}): Run => ({
  status: "running",
  started_by: "A",
  started_at: "2026-01-01T00:00:00Z",
  input: "",
  output: [],
  seq: 0,
  exit_code: null,
  ...over,
});
const text = (s: ScratchState) => (s.run?.output ?? []).map((x) => x.t).join("");

describe("scratchReducer", () => {
  it("FR-8: started replaces a finished run's output", () => {
    let s = scratchReducer(initialScratchState, {
      type: "snapshot",
      run: run({ status: "finished", output: [{ s: "out", t: "old" }], seq: 3, exit_code: 0 }),
    });
    s = scratchReducer(s, { type: "started", run: run() });
    s = scratchReducer(s, { type: "output", seq: 0, s: "out", t: "new" });
    expect(text(s)).toBe("new");
  });

  it("FR-10: overlapping, exact and repeated output messages", () => {
    const snap = scratchReducer(initialScratchState, {
      type: "snapshot",
      run: run({ output: [{ s: "out", t: "ab" }], seq: 2 }),
    });
    const a = scratchReducer(snap, { type: "output", seq: 1, s: "out", t: "bc" });
    expect(text(a)).toBe("abc");
    const b = scratchReducer(snap, { type: "output", seq: 2, s: "out", t: "c" });
    expect(text(b)).toBe("abc");
    expect(text(scratchReducer(b, { type: "output", seq: 2, s: "out", t: "c" }))).toBe("abc");
    expect(b.run?.seq).toBe(3);
  });

  it("FR-10: a gap sets needsSnapshot and leaves output unchanged", () => {
    const snap = scratchReducer(initialScratchState, {
      type: "snapshot",
      run: run({ output: [{ s: "out", t: "ab" }], seq: 2 }),
    });
    const s = scratchReducer(snap, { type: "output", seq: 5, s: "out", t: "x" });
    expect(s.needsSnapshot).toBe(true);
    expect(text(s)).toBe("ab");
    expect(scratchReducer(s, { type: "snapshot", run: snap.run }).needsSnapshot).toBe(false);
  });

  it("counts seq in UTF-8 bytes and merges same-stream segments", () => {
    let s = scratchReducer(initialScratchState, { type: "started", run: run() });
    s = scratchReducer(s, { type: "output", seq: 0, s: "out", t: "é" });
    s = scratchReducer(s, { type: "output", seq: 2, s: "out", t: "x" });
    s = scratchReducer(s, { type: "output", seq: 3, s: "err", t: "E" });
    expect(s.run?.seq).toBe(4);
    expect(s.run?.output).toEqual([
      { s: "out", t: "éx" },
      { s: "err", t: "E" },
    ]);
  });

  it("FR-9: refused in_progress leaves the run and names the starter", () => {
    const started = scratchReducer(initialScratchState, { type: "started", run: run() });
    const s = scratchReducer(started, { type: "refused", reason: "in_progress", by: "A" });
    expect(s.run).toEqual(started.run);
    expect(s.notice).toEqual({ reason: "in_progress", by: "A" });
    expect(scratchReducer(s, { type: "refused", reason: "stale" }).notice).toEqual({
      reason: "stale",
    });
  });

  it("FR-5: end sets status and exit code; started_by kept", () => {
    let s = scratchReducer(initialScratchState, {
      type: "started",
      run: run({ started_by: "Bo" }),
    });
    s = scratchReducer(s, { type: "end", status: "error", exit_code: 1 });
    expect(s.run).toMatchObject({ status: "error", exit_code: 1, started_by: "Bo" });
  });

  it("ignores output and end with no run", () => {
    expect(
      scratchReducer(initialScratchState, { type: "output", seq: 0, s: "out", t: "x" }),
    ).toEqual(initialScratchState);
    expect(
      scratchReducer(initialScratchState, { type: "end", status: "finished", exit_code: 0 }),
    ).toEqual(initialScratchState);
  });
});
