import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attempt } from "./learnTypes";
import { Terminal } from "./Terminal";

afterEach(cleanup);

const PROMPT = "learner@box:~$";

function attempt(id: number, by: string, command: string, output: string): Attempt {
  return {
    id,
    by,
    kind: "command",
    submitted: command,
    correct: false,
    output,
    at: "2026-10-29T10:00:00Z",
  };
}

function input(): HTMLInputElement {
  return screen.getByRole("textbox", { name: PROMPT }) as HTMLInputElement;
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

function key(k: string) {
  fireEvent.keyDown(input(), { key: k });
}

describe("Terminal (AC-17)", () => {
  it("does not submit while typing; Enter submits once and clears", () => {
    const onSubmit = vi.fn();
    render(<Terminal prompt={PROMPT} history={[]} onSubmit={onSubmit} />);
    type("docker ps");
    key("a");
    expect(onSubmit).not.toHaveBeenCalled();
    key("Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("docker ps");
    expect(input().value).toBe("");
  });

  it("does not submit an empty line", () => {
    const onSubmit = vi.fn();
    render(<Terminal prompt={PROMPT} history={[]} onSubmit={onSubmit} />);
    type("   ");
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows each history entry with name, command and output", () => {
    render(
      <Terminal
        prompt={PROMPT}
        history={[
          attempt(1, "Ada", "docker ps", "CONTAINER ID   IMAGE"),
          attempt(2, "Linus", "docker images", "REPOSITORY   TAG"),
        ]}
        onSubmit={() => {}}
      />,
    );
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    const entries = log.querySelectorAll("pre");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.textContent).toContain("Ada $ docker ps");
    expect(entries[0]?.textContent).toContain("CONTAINER ID   IMAGE");
    expect(entries[1]?.textContent).toContain("Linus $ docker images");
    expect(entries[1]?.textContent).toContain("REPOSITORY   TAG");
  });
});

describe("Terminal keyboard (AC-27)", () => {
  it("puts the history before the input in tab order", () => {
    render(<Terminal prompt={PROMPT} history={[]} onSubmit={() => {}} />);
    const log = screen.getByRole("log");
    expect(log.tabIndex).toBe(0);
    const focusables = Array.from(
      document.body.querySelectorAll<HTMLElement>("input, [tabindex]"),
    ).filter((el) => el.tabIndex >= 0);
    expect(focusables).toEqual([log, input()]);
  });

  it("recalls own previous commands with ArrowUp and ArrowDown", () => {
    render(<Terminal prompt={PROMPT} history={[]} onSubmit={() => {}} />);
    type("first");
    key("Enter");
    type("second");
    key("Enter");
    type("draft");
    key("ArrowUp");
    expect(input().value).toBe("second");
    key("ArrowUp");
    expect(input().value).toBe("first");
    key("ArrowUp");
    expect(input().value).toBe("first");
    key("ArrowDown");
    expect(input().value).toBe("second");
    key("ArrowDown");
    expect(input().value).toBe("draft");
  });

  it("does not recall other participants' commands", () => {
    render(
      <Terminal
        prompt={PROMPT}
        history={[attempt(1, "Linus", "rm -rf", "")]}
        onSubmit={() => {}}
      />,
    );
    key("ArrowUp");
    expect(input().value).toBe("");
  });

  it("disables the input when disabled", () => {
    const onSubmit = vi.fn();
    render(<Terminal prompt={PROMPT} history={[]} onSubmit={onSubmit} disabled />);
    expect(input().disabled).toBe(true);
    type("ls");
    key("Enter");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Terminal security (AC-28)", () => {
  it("renders markup in commands and output as literal text", () => {
    render(
      <Terminal
        prompt={PROMPT}
        history={[attempt(1, "<b>Eve</b>", "<b>hi</b>", "<b>out</b>")]}
        onSubmit={() => {}}
      />,
    );
    const log = screen.getByRole("log");
    expect(log.querySelector("b")).toBeNull();
    expect(log.textContent).toContain("<b>Eve</b> $ <b>hi</b>");
    expect(log.textContent).toContain("<b>out</b>");
  });
});
