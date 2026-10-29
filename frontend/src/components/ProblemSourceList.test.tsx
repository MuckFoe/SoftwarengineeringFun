import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ProblemSummary } from "../api/types";
import { ProblemSourceList } from "./ProblemSourceList";

const problems: ProblemSummary[] = [
  { id: "p-sum", title: "Sum two numbers", is_starter: true },
  { id: "p-rev", title: "Reverse list", is_starter: true },
  { id: "p-fizz", title: "FizzBuzz", is_starter: false },
];

// The backend is not part of this unit; only the HTTP boundary is stubbed.
function stubSearch() {
  const fn = vi.fn(async () => new Response(JSON.stringify(problems), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function fakeProvider() {
  const sent: ClientMessage[] = [];
  return { provider: { send: (m: ClientMessage) => sent.push(m) }, sent };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderList(currentProblemId = "p-sum") {
  const fetchMock = stubSearch();
  const { provider, sent } = fakeProvider();
  render(<ProblemSourceList provider={provider} currentProblemId={currentProblemId} />);
  await waitFor(() => expect(screen.getByRole("option", { name: "Reverse list" })).toBeTruthy());
  return { sent, fetchMock };
}

describe("ProblemSourceList", () => {
  it("lists every problem in a Problems listbox with the current one selected", async () => {
    const { fetchMock } = await renderList("p-rev");
    expect(screen.getByRole("listbox", { name: "Problems" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Sum two numbers",
      "Reverse list",
      "FizzBuzz",
    ]);
    expect(screen.getByRole("option", { name: "Reverse list" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/problems?q=", expect.anything());
  });

  // AC-10 (component part)
  it("switches the session on click, with the same message ProblemSwitcher sent", async () => {
    const { sent } = await renderList();
    fireEvent.click(screen.getByRole("option", { name: "Reverse list" }));
    expect(sent).toEqual([{ type: "switch_problem", problem_id: "p-rev" }]);
    expect(screen.getByRole("option", { name: "Reverse list" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      screen.getByRole("option", { name: "Sum two numbers" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("switches on Return", async () => {
    const { sent } = await renderList();
    const fizz = screen.getByRole("option", { name: "FizzBuzz" });
    fizz.focus();
    fireEvent.keyDown(fizz, { key: "Enter" });
    expect(sent).toEqual([{ type: "switch_problem", problem_id: "p-fizz" }]);
    expect(fizz.getAttribute("aria-selected")).toBe("true");
  });

  it("does not resend the current problem", async () => {
    const { sent } = await renderList("p-sum");
    fireEvent.click(screen.getByRole("option", { name: "Sum two numbers" }));
    expect(sent).toEqual([]);
  });

  it("follows the session when another participant switches", async () => {
    stubSearch();
    const { provider } = fakeProvider();
    const { rerender } = render(<ProblemSourceList provider={provider} currentProblemId="p-sum" />);
    await waitFor(() => expect(screen.getByRole("option", { name: "FizzBuzz" })).toBeTruthy());
    rerender(<ProblemSourceList provider={provider} currentProblemId="p-fizz" />);
    expect(screen.getByRole("option", { name: "FizzBuzz" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});
