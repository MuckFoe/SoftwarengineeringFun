import { describe, expect, it } from "vitest";
import {
  initialSketchState,
  type SketchEvent,
  type SketchState,
  sketchReducer,
  undoTarget,
  visible,
} from "./sketchState";
import type { PendingAction, SketchAction } from "./sketchTypes";

// Spec 022 task 6 (FR-10, FR-12–FR-15): the pure board reducer.

const pen = (seq: number, client_id = `c${seq}`): SketchAction => ({
  seq,
  client_id,
  kind: "pen",
  color: "ink",
  points: [seq, seq],
});
const erase = (seq: number, client_id = `c${seq}`): SketchAction => ({
  seq,
  client_id,
  kind: "erase",
  points: [seq, seq],
});
const clear = (seq: number, client_id = `c${seq}`): SketchAction => ({
  seq,
  client_id,
  kind: "clear",
});

const added = (action: SketchAction): SketchEvent => ({ type: "added", action });
const removed = (seq: number): SketchEvent => ({ type: "removed", seq });
const snapshot = (actions: SketchAction[], full = false): SketchEvent => ({
  type: "snapshot",
  snapshot: { actions, full },
});
const local = (action: PendingAction): SketchEvent => ({ type: "local", action });

const run = (events: SketchEvent[], from: SketchState = initialSketchState()) =>
  events.reduce(sketchReducer, from);
const seqs = (s: SketchState) => visible(s).map((a) => ("seq" in a ? a.seq : a.client_id));

/** Every ordering in which the snapshot lands anywhere inside the in-order broadcast stream. */
function snapshotPositions(snap: SketchEvent, broadcasts: SketchEvent[]): SketchEvent[][] {
  return Array.from({ length: broadcasts.length + 1 }, (_, i) => [
    ...broadcasts.slice(0, i),
    snap,
    ...broadcasts.slice(i),
  ]);
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

describe("AC-10 — the same events in any order give the same board", () => {
  it("merges added events by seq, whatever order they arrive in", () => {
    const events = [added(pen(1)), added(pen(2)), added(erase(3)), added(pen(4))];
    for (const order of permutations(events)) {
      expect(seqs(run(order))).toEqual([1, 2, 3, 4]);
    }
  });

  it("is idempotent: a repeated added or removed changes nothing", () => {
    const once = run([added(pen(1)), added(pen(2)), removed(1)]);
    const twice = run([added(pen(1)), added(pen(2)), added(pen(2)), removed(1), removed(1)]);
    expect(seqs(twice)).toEqual(seqs(once));
    expect(seqs(twice)).toEqual([2]);
  });

  it("remembers removed seqs, so an add arriving after its removal stays gone", () => {
    expect(seqs(run([removed(2), added(pen(1)), added(pen(2))]))).toEqual([1]);
  });

  it("gives the same board wherever the welcome snapshot lands among the broadcasts", () => {
    // Snapshot taken after seq 3; broadcasts 2..7 may reach the socket before or after it.
    const snap = snapshot([pen(1), pen(2), pen(3)]);
    const broadcasts = [
      added(pen(4)),
      removed(2),
      added(clear(5)),
      added(pen(6)),
      removed(5),
      added(erase(7)),
    ];
    const expected = seqs(run([snap, ...broadcasts]));
    expect(expected).toEqual([1, 3, 4, 6, 7]);
    for (const order of snapshotPositions(snap, broadcasts)) {
      expect(seqs(run(order))).toEqual(expected);
    }
  });

  it("gives the same board when a broadcast clear prunes before or after the snapshot", () => {
    // Snapshot holds clear 3 and what it hid; clear 6 then prunes seq ≤ 3, then 6 is undone.
    const snap = snapshot([pen(1), pen(2), clear(3), pen(4), pen(5)]);
    const broadcasts = [added(clear(6)), added(pen(7)), removed(6)];
    for (const order of snapshotPositions(snap, broadcasts)) {
      expect(seqs(run(order))).toEqual([4, 5, 7]);
    }
  });
});

describe("AC-12 — after a clear the board is empty", () => {
  it("hides everything earlier than the latest clear", () => {
    const s = run([added(pen(1)), added(erase(2)), added(clear(3))]);
    expect(visible(s)).toEqual([]);
    expect(seqs(run([added(pen(4))], s))).toEqual([4]);
  });

  it("prunes what a previous clear hid, as the server does", () => {
    const s = run([added(pen(1)), added(clear(2)), added(pen(3)), added(clear(4))]);
    expect(s.confirmed.map((a) => a.seq)).toEqual([3, 4]);
    // Undoing the latest clear brings back only what is still on record.
    expect(seqs(run([removed(4)], s))).toEqual([3]);
  });

  it("ignores a late action at or below the pruned point", () => {
    const s = run([added(clear(2)), added(clear(4)), added(pen(1)), added(clear(2))]);
    expect(s.confirmed.map((a) => a.seq)).toEqual([4]);
  });

  it("does not prune by a clear that was undone before the next one", () => {
    const s = run([
      added(clear(1)),
      added(pen(2)),
      added(clear(3)),
      removed(3),
      added(pen(4)),
      added(clear(5)),
      removed(5),
    ]);
    expect(seqs(s)).toEqual([2, 4]);
  });
});

describe("AC-13 — own-undo stack", () => {
  const mine = (client_id: string): PendingAction => ({
    client_id,
    kind: "pen",
    color: "red",
    points: [1, 1],
  });

  it("holds only own echoes, newest last, and another's added does not touch it", () => {
    const s = run([
      local(mine("a1")),
      local(mine("a2")),
      added(pen(10, "a1")),
      added(pen(11, "b1")),
      added(pen(12, "a2")),
      added(pen(13, "b2")),
    ]);
    expect(s.ownSeqs).toEqual([10, 12]);
    expect(undoTarget(s)).toBe(12);
  });

  it("drops an entry when it is removed, and when it is pruned", () => {
    const s = run([
      local(mine("a1")),
      local(mine("a2")),
      added(pen(10, "a1")),
      added(pen(12, "a2")),
      removed(12),
    ]);
    expect(s.ownSeqs).toEqual([10]);
    expect(undoTarget(s)).toBe(10);
    const pruned = run([added(clear(13, "b")), added(clear(14, "b"))], s);
    expect(pruned.ownSeqs).toEqual([]);
    expect(undoTarget(pruned)).toBeUndefined();
  });

  it("pushes an own clear's seq so it can be undone", () => {
    const s = run([local({ client_id: "a1", kind: "clear" }), added(clear(5, "a1"))]);
    expect(s.ownSeqs).toEqual([5]);
  });
});

describe("AC-14 — undo an erased line, an erase, a clear", () => {
  it("removing a line drops what is left of it, even after a later erase", () => {
    const s = run([added(pen(1)), added(erase(2)), removed(1)]);
    expect(seqs(s)).toEqual([2]);
  });

  it("removing an erase brings back what it rubbed out", () => {
    const s = run([added(pen(1)), added(erase(2)), removed(2)]);
    expect(seqs(s)).toEqual([1]);
  });

  it("removing a clear brings earlier actions back", () => {
    const s = run([added(pen(1)), added(pen(2)), added(clear(3)), removed(3)]);
    expect(seqs(s)).toEqual([1, 2]);
  });
});

describe("AC-15 — undo starts empty each visit", () => {
  it("a fresh state has nothing to undo", () => {
    const s = initialSketchState();
    expect(s.ownSeqs).toEqual([]);
    expect(undoTarget(s)).toBeUndefined();
  });

  it("a snapshot holding own earlier actions leaves the stack empty", () => {
    const s = run([snapshot([pen(1, "earlier-visit"), pen(2, "earlier-visit")])]);
    expect(s.ownSeqs).toEqual([]);
    expect(seqs(s)).toEqual([1, 2]);
  });
});

describe("pending own actions", () => {
  const p: PendingAction = { client_id: "a1", kind: "pen", color: "blue", points: [5, 5] };

  it("draws a pending action on top of the confirmed board", () => {
    const s = run([added(pen(1)), local(p), added(pen(2))]);
    expect(seqs(s)).toEqual([1, 2, "a1"]);
  });

  it("replaces the pending action by its echo", () => {
    const s = run([local(p), added({ ...p, seq: 3 })]);
    expect(s.pending).toEqual([]);
    expect(seqs(s)).toEqual([3]);
  });

  it("a pending clear hides the board beneath it at once", () => {
    const s = run([added(pen(1)), local({ client_id: "a2", kind: "clear" }), local(p)]);
    expect(seqs(s)).toEqual(["a1"]);
  });

  it("refused drops the matching pending action", () => {
    for (const reason of ["invalid", "stale", "full"] as const) {
      const s = run([local(p), { type: "refused", client_id: "a1", reason }]);
      expect(s.pending).toEqual([]);
      expect(s.full).toBe(reason === "full");
    }
  });

  it("a refused undo leaves pending actions alone", () => {
    const s = run([local(p), { type: "refused", seq: 9, reason: "not_yours" }]);
    expect(s.pending).toEqual([p]);
    expect(s.full).toBe(false);
  });
});

describe("full", () => {
  it("comes from the snapshot", () => {
    expect(run([snapshot([], true)]).full).toBe(true);
    expect(run([snapshot([], false)]).full).toBe(false);
  });

  it("clears once room is made by an undo or a clear", () => {
    const full = run([added(pen(1)), { type: "refused", client_id: "x", reason: "full" }]);
    expect(full.full).toBe(true);
    expect(run([removed(1)], full).full).toBe(false);
    expect(run([added(clear(2))], full).full).toBe(false);
  });
});
