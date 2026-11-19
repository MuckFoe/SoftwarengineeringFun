// Pure sketch board reducer (spec 022 plan, Frontend and Contracts). Idempotent and
// order-tolerant: actions merge by seq, removed seqs are remembered, so broadcasts that
// reach the socket before the welcome snapshot give the same board. Pruning follows the
// server: a clear drops every action at or below the previous (still present) clear.

import type { PendingAction, SketchAction, SketchRefusal, SketchSnapshot } from "./sketchTypes";

export interface SketchState {
  /** Confirmed actions still on record, in seq order. */
  confirmed: SketchAction[];
  /** Seqs the server removed (undone); an add arriving later for one stays gone. */
  removed: Set<number>;
  /** Own actions drawn locally, awaiting their echo. */
  pending: PendingAction[];
  /** Seqs of own confirmed actions this visit, newest last: the undo stack (FR-13, FR-15). */
  ownSeqs: number[];
  /** The board is at its size limit (FR-18). */
  full: boolean;
  /** client_ids this client sent this visit; an action carrying one is ours. */
  ownClientIds: Set<string>;
  /** Seqs of every clear seen added, including ones later removed. */
  clearSeqs: Set<number>;
  /** Everything at or below this seq has been pruned. */
  floor: number;
}

export type SketchEvent =
  | { type: "snapshot"; snapshot: SketchSnapshot }
  | { type: "added"; action: SketchAction }
  | { type: "removed"; seq: number }
  | { type: "refused"; client_id?: string; seq?: number; reason: SketchRefusal }
  | { type: "local"; action: PendingAction };

export function initialSketchState(): SketchState {
  return {
    confirmed: [],
    removed: new Set(),
    pending: [],
    ownSeqs: [],
    full: false,
    ownClientIds: new Set(),
    clearSeqs: new Set(),
    floor: 0,
  };
}

/** Merges confirmed actions into the state, then re-applies pruning and the own stack. */
function merge(s: SketchState, incoming: SketchAction[]): SketchState {
  const bySeq = new Map(s.confirmed.map((a) => [a.seq, a]));
  const clearSeqs = new Set(s.clearSeqs);
  const ownSeqs = [...s.ownSeqs];
  const echoed = new Set<string>();
  for (const a of incoming) {
    if (a.seq <= s.floor || s.removed.has(a.seq) || bySeq.has(a.seq)) continue;
    bySeq.set(a.seq, a);
    if (a.kind === "clear") clearSeqs.add(a.seq);
    if (s.ownClientIds.has(a.client_id)) {
      ownSeqs.push(a.seq);
      echoed.add(a.client_id);
    }
  }
  // A clear prunes up to the latest clear before it that was still present when it arrived.
  // A clear undone before a later one was never its "previous"; one undone after was
  // already pruned by it, so excluding removed clears matches the server.
  const present = [...clearSeqs].filter((c) => !s.removed.has(c)).sort((a, b) => a - b);
  let floor = s.floor;
  for (const c of clearSeqs) {
    const prev = present.filter((p) => p < c).pop();
    if (prev !== undefined && prev > floor) floor = prev;
  }
  const confirmed = [...bySeq.values()].filter((a) => a.seq > floor).sort((a, b) => a.seq - b.seq);
  return {
    ...s,
    confirmed,
    clearSeqs,
    floor,
    pending: echoed.size ? s.pending.filter((p) => !echoed.has(p.client_id)) : s.pending,
    ownSeqs: ownSeqs.filter((q) => q > floor).sort((a, b) => a - b),
  };
}

export function sketchReducer(s: SketchState, e: SketchEvent): SketchState {
  switch (e.type) {
    case "snapshot":
      return { ...merge(s, e.snapshot.actions), full: e.snapshot.full };
    case "added": {
      const next = merge(s, [e.action]);
      const madeRoom = e.action.kind === "clear" && !s.clearSeqs.has(e.action.seq);
      return madeRoom ? { ...next, full: false } : next;
    }
    case "removed": {
      if (s.removed.has(e.seq)) return s;
      const removed = new Set(s.removed).add(e.seq);
      return {
        ...s,
        removed,
        confirmed: s.confirmed.filter((a) => a.seq !== e.seq),
        ownSeqs: s.ownSeqs.filter((q) => q !== e.seq),
        full: false,
      };
    }
    case "refused": {
      const pending =
        e.client_id === undefined
          ? s.pending
          : s.pending.filter((p) => p.client_id !== e.client_id);
      return { ...s, pending, full: s.full || e.reason === "full" };
    }
    case "local": {
      if (s.ownClientIds.has(e.action.client_id)) return s;
      return {
        ...s,
        pending: [...s.pending, e.action],
        ownClientIds: new Set(s.ownClientIds).add(e.action.client_id),
      };
    }
  }
}

/** What the board shows: confirmed actions after the last clear in seq order, pending on top. */
export function visible(s: SketchState): Array<SketchAction | PendingAction> {
  const all: Array<SketchAction | PendingAction> = [...s.confirmed, ...s.pending];
  let start = 0;
  all.forEach((a, i) => {
    if (a.kind === "clear") start = i + 1;
  });
  return all.slice(start);
}

/** The seq Undo would remove: the newest own action still on record, if any. */
export function undoTarget(s: SketchState): number | undefined {
  return s.ownSeqs.at(-1);
}
