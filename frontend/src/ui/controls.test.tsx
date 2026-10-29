import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import buttonCss from "./Button.module.css?raw";
import { Spinner } from "./Spinner";

afterEach(cleanup);

describe("Button", () => {
  it("renders its label and calls onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Run</Button>);
    expect(screen.getByRole("button")).toHaveProperty("type", "button");
  });

  // AC-3 (component part)
  it("shows an inline spinner while busy and stays focusable", () => {
    render(
      <Button variant="primary" busy>
        Run
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Run/ });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    const spinner = screen.getByRole("progressbar");
    expect(button.contains(spinner)).toBe(true);
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("has no spinner when not busy", () => {
    render(<Button>Run</Button>);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button").hasAttribute("aria-busy")).toBe(false);
  });

  it("sets disabled", () => {
    render(<Button disabled>Run</Button>);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });

  it("renders an icon next to the label", () => {
    render(<Button icon="play">Run</Button>);
    expect(screen.getByRole("button", { name: "Run" }).querySelector("svg")).not.toBeNull();
  });

  it("names an icon-only button by its label", () => {
    render(<Button icon="sidebar" label="Show sidebar" />);
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
  });

  it("has primary, bordered, plain and destructive variants", () => {
    for (const variant of ["primary", "bordered", "plain", "destructive"] as const) {
      render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button", { name: variant }).className).toMatch(variant);
      expect(buttonCss).toMatch(new RegExp(`\\.${variant}\\b`));
    }
  });

  // NFR-4 (static part; rendered check in task 38)
  it("draws a :focus-visible ring from --focus-ring", () => {
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(buttonCss.replace(/\/\*[\s\S]*?\*\//g, ""));
    expect(rule?.[1]).toMatch(/var\(--focus-ring\)/);
  });
});

describe("Spinner", () => {
  it("is a labelled progressbar", () => {
    render(<Spinner label="Running tests" />);
    expect(screen.getByRole("progressbar", { name: "Running tests" })).toBeTruthy();
  });
});
