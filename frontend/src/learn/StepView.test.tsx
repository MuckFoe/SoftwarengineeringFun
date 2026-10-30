import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attempt, StepView as StepViewData } from "./learnTypes";
import { StepView } from "./StepView";

afterEach(cleanup);

function step(over: Partial<StepViewData> = {}): StepViewData {
  return {
    position: 2,
    title: "Images",
    kind: "quiz",
    body_html: "<p>Which commands <em>list</em> images?</p>",
    check: {
      type: "choice",
      options: ["docker ps", "docker images", "docker image ls"],
      multiple: true,
    },
    has_hint: false,
    hint_html: null,
    show_answer_available: false,
    answer: null,
    attempts: [],
    passed: null,
    ...over,
  };
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    id: 1,
    by: "Alice",
    kind: "text",
    submitted: "containers",
    correct: false,
    output: null,
    at: "2026-10-29T10:00:00Z",
    ...over,
  };
}

function attemptsList() {
  return screen.getByRole("list", { name: "Attempts" });
}

describe("StepView content and checks", () => {
  it("renders the step's server HTML and title", () => {
    render(<StepView step={step()} onSend={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Images" })).toBeTruthy();
    expect(screen.getByText("list").tagName).toBe("EM");
  });

  it("explanation without a check offers Continue", () => {
    const onSend = vi.fn();
    render(<StepView step={step({ kind: "explanation", check: null })} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSend).toHaveBeenCalledWith({ type: "continue", step: 2 });
  });

  it("explanation with a check shows the check and no Continue", () => {
    render(
      <StepView step={step({ kind: "explanation", check: { type: "text" } })} onSend={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Answer" })).toBeTruthy();
  });

  it("single-choice quiz is a radio group and submits the selected index", () => {
    const onSend = vi.fn();
    render(
      <StepView
        step={step({ check: { type: "choice", options: ["a", "b", "c"], multiple: false } })}
        onSend={onSend}
      />,
    );
    const group = screen.getByRole("group", { name: "Choose one" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "b" }));
    fireEvent.click(screen.getByRole("radio", { name: "c" }));
    fireEvent.click(submit);
    expect(onSend).toHaveBeenCalledWith({ type: "submit_choice", step: 2, selected: [2] });
  });

  it("multiple-choice quiz uses checkboxes and submits every selected index in order", () => {
    const onSend = vi.fn();
    render(<StepView step={step()} onSend={onSend} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: "docker image ls" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "docker images" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSend).toHaveBeenCalledWith({ type: "submit_choice", step: 2, selected: [1, 2] });
  });

  it("text quiz submits the typed text", () => {
    const onSend = vi.fn();
    render(<StepView step={step({ check: { type: "text" } })} onSend={onSend} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), {
      target: { value: "  Container " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSend).toHaveBeenCalledWith({ type: "submit_text", step: 2, text: "  Container " });
  });

  it("terminal step renders the Terminal and submits commands", () => {
    const onSend = vi.fn();
    render(
      <StepView
        step={step({
          kind: "terminal",
          check: { type: "terminal", prompt: "learner@box:~$" },
          attempts: [attempt({ kind: "command", submitted: "docker ps", output: "CONTAINER ID" })],
        })}
        onSend={onSend}
      />,
    );
    const input = screen.getByRole("textbox", { name: "learner@box:~$" });
    fireEvent.change(input, { target: { value: "docker images" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({
      type: "submit_command",
      step: 2,
      command: "docker images",
    });
    expect(within(screen.getByRole("log")).getByText(/Alice \$ docker ps/)).toBeTruthy();
  });
});

describe("StepView attempts (AC-11, FR-12)", () => {
  it("shows each attempt's author, submission and result", () => {
    render(
      <StepView
        step={step({
          check: { type: "text" },
          attempts: [
            attempt({ id: 1, by: "Alice", submitted: "containers", correct: false }),
            attempt({ id: 2, by: "Bob", submitted: "container", correct: true }),
          ],
        })}
        onSend={vi.fn()}
      />,
    );
    const items = within(attemptsList()).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [first, second] = items as [HTMLElement, HTMLElement];
    expect(first.textContent).toContain("Alice");
    expect(first.textContent).toContain("containers");
    expect(first.textContent).toContain("not correct");
    expect(second.textContent).toContain("Bob");
    expect(second.textContent).toContain("correct");
    expect(second.textContent).not.toContain("not correct");
  });

  it("shows a choice attempt as the chosen options' text", () => {
    render(
      <StepView
        step={step({ attempts: [attempt({ kind: "choice", submitted: [0, 2] })] })}
        onSend={vi.fn()}
      />,
    );
    const item = within(attemptsList()).getByRole("listitem");
    expect(item.textContent).toContain("docker ps, docker image ls");
  });

  it("marks terminal attempts correct or not correct too", () => {
    render(
      <StepView
        step={step({
          kind: "terminal",
          check: { type: "terminal", prompt: "$" },
          attempts: [attempt({ kind: "command", submitted: "ls", output: "" })],
        })}
        onSend={vi.fn()}
      />,
    );
    const item = within(attemptsList()).getByRole("listitem");
    expect(item.textContent).toContain("Alice");
    expect(item.textContent).toContain("ls");
    expect(item.textContent).toContain("not correct");
  });

  it("renders submitted markup as literal text (AC-28)", () => {
    const { container } = render(
      <StepView
        step={step({ check: { type: "text" }, attempts: [attempt({ submitted: "<b>hi</b>" })] })}
        onSend={vi.fn()}
      />,
    );
    expect(within(attemptsList()).getByText(/<b>hi<\/b>/)).toBeTruthy();
    expect(attemptsList().querySelector("b")).toBeNull();
    expect(container.innerHTML).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("renders a submitted command's markup as literal text (AC-28)", () => {
    render(
      <StepView
        step={step({
          kind: "terminal",
          check: { type: "terminal", prompt: "$" },
          attempts: [attempt({ kind: "command", submitted: "<b>hi</b>", output: "<i>x</i>" })],
        })}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByRole("log").querySelector("b, i")).toBeNull();
    expect(attemptsList().querySelector("b")).toBeNull();
  });
});

describe("StepView hint (AC-12, FR-13)", () => {
  it("shows no hint control when the step has no hint", () => {
    render(<StepView step={step({ has_hint: false })} onSend={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /hint/i })).toBeNull();
  });

  it("offers Hint when the step has an unrevealed hint", () => {
    const onSend = vi.fn();
    render(<StepView step={step({ has_hint: true })} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(onSend).toHaveBeenCalledWith({ type: "reveal_hint", step: 2 });
  });

  it("shows a revealed hint and no Hint button", () => {
    render(
      <StepView
        step={step({ has_hint: true, hint_html: "<p>Think <strong>images</strong></p>" })}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
    expect(screen.getByText("images", { selector: "strong" })).toBeTruthy();
  });
});

describe("StepView Show answer (AC-13a, FR-14a)", () => {
  it("has no Show answer when it is not available", () => {
    render(<StepView step={step({ show_answer_available: false })} onSend={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Show answer" })).toBeNull();
  });

  it("offers Show answer when it is available", () => {
    const onSend = vi.fn();
    render(<StepView step={step({ show_answer_available: true })} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(onSend).toHaveBeenCalledWith({ type: "show_answer", step: 2 });
  });

  it("displays a revealed choice answer as the correct options", () => {
    render(
      <StepView step={step({ answer: { type: "choice", correct: [1, 2] } })} onSend={vi.fn()} />,
    );
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(answer.textContent).toContain("docker images");
    expect(answer.textContent).toContain("docker image ls");
    expect(answer.textContent).not.toContain("docker ps");
  });

  it("displays a revealed text answer", () => {
    render(
      <StepView
        step={step({
          check: { type: "text" },
          answer: { type: "text", accept: ["container", "ctr"] },
        })}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("container");
  });

  it("displays a revealed terminal command and its output", () => {
    render(
      <StepView
        step={step({
          kind: "terminal",
          check: { type: "terminal", prompt: "$" },
          answer: { type: "terminal", command: "docker images", output: "REPOSITORY TAG" },
        })}
        onSend={vi.fn()}
      />,
    );
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(answer.textContent).toContain("docker images");
    expect(answer.textContent).toContain("REPOSITORY TAG");
  });
});

describe("StepView read-only (AC-14, FR-15)", () => {
  it("shows content, answer and attempts with every control disabled", () => {
    const onSend = vi.fn();
    render(
      <StepView
        readOnly
        step={step({
          has_hint: true,
          show_answer_available: true,
          answer: { type: "choice", correct: [1, 2] },
          attempts: [attempt({ kind: "choice", submitted: [0] })],
          passed: { by: "Bob", at: "2026-10-29T10:05:00Z", after_reveal: false },
        })}
        onSend={onSend}
      />,
    );
    expect(screen.getByText("list").tagName).toBe("EM");
    expect(screen.getByRole("region", { name: "Answer" }).textContent).toContain("docker images");
    expect(within(attemptsList()).getAllByRole("listitem")).toHaveLength(1);
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("checkbox")];
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls)
      expect((c as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  });

  it("disables the text field, the terminal input and Continue", () => {
    const { rerender } = render(
      <StepView readOnly step={step({ check: { type: "text" } })} onSend={vi.fn()} />,
    );
    expect((screen.getByRole("textbox", { name: "Answer" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    rerender(
      <StepView
        readOnly
        step={step({ kind: "terminal", check: { type: "terminal", prompt: "$" } })}
        onSend={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox", { name: "$" }) as HTMLInputElement).disabled).toBe(true);
    rerender(
      <StepView readOnly step={step({ kind: "explanation", check: null })} onSend={vi.fn()} />,
    );
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("states who passed the step and whether after the answer was shown", () => {
    render(
      <StepView
        readOnly
        step={step({ passed: { by: "Bob", at: "2026-10-29T10:05:00Z", after_reveal: true } })}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText(/Passed by Bob/).textContent).toContain("after answer shown");
  });
});
