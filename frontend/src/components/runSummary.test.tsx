import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunResult } from "../api/types";
import { RunSummaryStrip } from "./RunSummaryStrip";
import { formatRunSummary, toRunSummary } from "./runSummary";

afterEach(cleanup);

describe("formatRunSummary (FR-17)", () => {
  it("omits undefined and null figures, never zero", () => {
    expect(formatRunSummary({})).toEqual([]);
    expect(
      formatRunSummary({
        durationMs: undefined,
        memoryKb: null,
        examplesPassed: null,
        examplesTotal: null,
      }),
    ).toEqual([]);
  });

  it("keeps a legitimate 0 passed as 0/4", () => {
    expect(formatRunSummary({ examplesPassed: 0, examplesTotal: 4 })).toEqual([
      { label: "Examples", value: "0/4" },
    ]);
  });

  it("omits examples when only one half is known", () => {
    expect(formatRunSummary({ examplesPassed: 2 })).toEqual([]);
  });

  it("formats time, memory and examples", () => {
    expect(
      formatRunSummary({ durationMs: 42, memoryKb: 2048, examplesPassed: 3, examplesTotal: 4 }),
    ).toEqual([
      { label: "Time", value: "42 ms" },
      { label: "Memory", value: "2.0 MB" },
      { label: "Examples", value: "3/4" },
    ]);
  });

  it("maps a RunResult's snake_case fields", () => {
    const run: RunResult = {
      run_id: "r",
      problem_id: "p",
      accepted: false,
      results: [],
      examples_passed: 1,
      examples_total: 2,
    };
    expect(toRunSummary(run)).toEqual({ examplesPassed: 1, examplesTotal: 2 });
  });
});

describe("RunSummaryStrip (FR-17)", () => {
  it("shows three labelled figures when all are set", () => {
    render(
      <RunSummaryStrip
        summary={{ durationMs: 1500, memoryKb: 512, examplesPassed: 2, examplesTotal: 2 }}
      />,
    );
    expect(screen.getByText("Time")).toBeTruthy();
    expect(screen.getByText("1.5 s")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("512 KB")).toBeTruthy();
    expect(screen.getByText("Examples")).toBeTruthy();
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("renders nothing when no figure is present", () => {
    const { container } = render(<RunSummaryStrip summary={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("after a reload shows only examples", () => {
    render(<RunSummaryStrip summary={{ examplesPassed: 0, examplesTotal: 3 }} />);
    expect(screen.getByText("0/3")).toBeTruthy();
    expect(screen.queryByText("Time")).toBeNull();
    expect(screen.queryByText("Memory")).toBeNull();
  });
});
