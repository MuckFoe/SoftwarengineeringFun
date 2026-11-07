// Spec 011: pure state machine over the run.* session messages (plan.md Contracts).
export type Segment = { s: "out" | "err"; t: string };
export type RunStatus =
  | "running"
  | "finished"
  | "error"
  | "time_limit"
  | "output_limit"
  | "interrupted";
export type Run = {
  status: RunStatus;
  started_by: string;
  started_at: string;
  input: string;
  output: Segment[];
  seq: number;
  exit_code: number | null;
};
export type RunNotice = { reason: "in_progress"; by: string } | { reason: "stale" };
export type ScratchState = { run: Run | null; needsSnapshot: boolean; notice: RunNotice | null };
export type ScratchAction =
  | { type: "snapshot"; run: Run | null }
  | { type: "started"; run: Run }
  | { type: "output"; seq: number; s: "out" | "err"; t: string }
  | { type: "end"; status: RunStatus; exit_code: number | null }
  | ({ type: "refused" } & RunNotice);

export const initialScratchState: ScratchState = { run: null, needsSnapshot: false, notice: null };

const enc = new TextEncoder();
const dec = new TextDecoder();

function append(output: Segment[], s: "out" | "err", t: string): Segment[] {
  if (t === "") return output;
  const last = output[output.length - 1];
  if (last && last.s === s) return [...output.slice(0, -1), { s, t: last.t + t }];
  return [...output, { s, t }];
}

export function scratchReducer(state: ScratchState, action: ScratchAction): ScratchState {
  switch (action.type) {
    case "snapshot":
      return { run: action.run, needsSnapshot: false, notice: null };
    case "started":
      return { run: action.run, needsSnapshot: false, notice: null };
    case "output": {
      const run = state.run;
      if (!run) return state;
      if (action.seq > run.seq) return { ...state, needsSnapshot: true };
      const bytes = enc.encode(action.t);
      const skip = run.seq - action.seq;
      if (skip >= bytes.length) return state;
      const fresh = skip === 0 ? action.t : dec.decode(bytes.slice(skip));
      return {
        ...state,
        run: {
          ...run,
          output: append(run.output, action.s, fresh),
          seq: action.seq + bytes.length,
        },
      };
    }
    case "end":
      if (!state.run) return state;
      return {
        ...state,
        run: { ...state.run, status: action.status, exit_code: action.exit_code },
      };
    case "refused": {
      const notice: RunNotice =
        action.reason === "in_progress"
          ? { reason: "in_progress", by: action.by }
          : { reason: "stale" };
      return { ...state, notice };
    }
  }
}
