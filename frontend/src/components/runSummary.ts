import type { RunResult } from "../api/types";

/** The figures of one finished run (spec 016 FR-17). A missing figure is undefined or null. */
export interface RunSummary {
  durationMs?: number | null;
  memoryKb?: number | null;
  examplesPassed?: number | null;
  examplesTotal?: number | null;
}

const has = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function formatMemory(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

/** Labelled figures to show; a missing figure is omitted, never shown as zero. A 0 passed is kept. */
export function formatRunSummary(r: RunSummary): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (has(r.durationMs)) out.push({ label: "Time", value: formatTime(r.durationMs) });
  if (has(r.memoryKb)) out.push({ label: "Memory", value: formatMemory(r.memoryKb) });
  if (has(r.examplesPassed) && has(r.examplesTotal))
    out.push({ label: "Examples", value: `${r.examplesPassed}/${r.examplesTotal}` });
  return out;
}

/** Map the API's snake_case run fields, dropping the ones that are absent. */
export function toRunSummary(run: RunResult): RunSummary {
  const s: RunSummary = {};
  if (has(run.duration_ms)) s.durationMs = run.duration_ms;
  if (has(run.memory_kb)) s.memoryKb = run.memory_kb;
  if (has(run.examples_passed)) s.examplesPassed = run.examples_passed;
  if (has(run.examples_total)) s.examplesTotal = run.examples_total;
  return s;
}
