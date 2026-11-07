import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import tokensCss from "../styles/tokens.css?raw";
import { Button } from "./Button";
import buttonCss from "./Button.module.css?raw";
import { Spinner } from "./Spinner";
import spinnerCss from "./Spinner.module.css?raw";

// Spec 015 task 13 (FR-4, FR-9): Audi button, states and sizes.
afterEach(cleanup);

const css = buttonCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector list contains `selector` exactly. */
function rule(selector: string): string {
  const esc = selector.replace(/[.:()[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[},])\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "m");
  const m = re.exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return (m[1] ?? "").replace(/\s+/g, " ").trim();
}

const STATES = (v: string) => [
  rule(`.${v}`),
  rule(`.${v}:hover:not(:disabled)`),
  rule(`.${v}:focus-visible`),
  rule(`.${v}:active:not(:disabled)`),
  rule(`.${v}:disabled`),
  rule(`.${v}[data-error]`),
];

describe("Button v2 (spec 016 FR-7, FR-11)", () => {
  it("primary is a solid accent pill with a glow; secondary has neither", () => {
    const p = rule(".primary");
    expect(p).toMatch(/background:\s*var\(--accent\)/);
    expect(p).toMatch(/box-shadow:\s*var\(--glow\)/);
    expect(rule(".button")).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    const s = rule(".secondary");
    expect(s).not.toMatch(/background:\s*var\(--accent\)/);
    expect(s).not.toMatch(/box-shadow:\s*var\(--glow\)/);
    expect(s).toMatch(/background:\s*transparent/);
    expect(s).toMatch(/border-color:\s*var\(--accent\)/);
  });

  for (const v of ["primary", "secondary", "danger"]) {
    it(`${v}: rest, hover, focus, pressed, disabled and error are all distinct`, () => {
      const states = STATES(v);
      expect(new Set(states).size).toBe(states.length);
    });
  }

  it("danger uses the danger token", () => {
    expect(rule(".danger")).toMatch(/var\(--danger\)/);
  });

  it("transitions use --motion-fast (zero under reduced motion via the token)", () => {
    expect(rule(".button")).toMatch(/transition:[^;]*var\(--motion-fast\)/);
    expect(tokensCss).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*--motion-fast:\s*0s/);
  });

  it("variant danger and error prop set the class and data-error", () => {
    render(
      <Button variant="danger" error>
        Del
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Del" });
    expect(b.className).toMatch(/danger/);
    expect(b.hasAttribute("data-error")).toBe(true);
    expect(b.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps the old destructive name as a danger button", () => {
    render(<Button variant="destructive">Rm</Button>);
    expect(screen.getByRole("button", { name: "Rm" }).className).toMatch(/danger/);
  });
});

describe("Button states", () => {
  it("tertiary: rest, hover and disabled are distinct", () => {
    const states = [
      rule(".tertiary"),
      rule(".tertiary:hover:not(:disabled)"),
      rule(".tertiary:disabled"),
    ];
    expect(new Set(states).size).toBe(3);
  });

  it("disabled has no pointer events and keeps the double focus ring", () => {
    expect(rule(".button:disabled")).toMatch(/pointer-events:\s*none/);
    expect(rule(".button:focus-visible")).toMatch(/var\(--focus\)/);
  });

  it("has no raw colours", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("sizes xs 32, sm 48, md 56; min width 144 for primary and secondary", () => {
    expect(rule(".xs")).toMatch(/min-height:\s*32px/);
    expect(rule(".sm")).toMatch(/min-height:\s*48px/);
    expect(rule(".md")).toMatch(/min-height:\s*56px/);
    expect(rule(".labelled.primary")).toMatch(/min-width:\s*144px/);
    expect(rule(".labelled.secondary")).toMatch(/min-width:\s*144px/);
  });
});

describe("Button behaviour (FR-4, FR-9)", () => {
  it("disabled blocks onClick", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading renders a spinner in the icon slot and sets aria-busy", () => {
    render(
      <Button variant="primary" loading icon="play">
        Go
      </Button>,
    );
    const b = screen.getByRole("button", { name: /Go/ });
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(b.querySelector(".icon[data-icon]")).toBeNull();
  });

  it("accepts the new variants and maps the old names onto them", () => {
    for (const [variant, cls] of [
      ["secondary", "secondary"],
      ["tertiary", "tertiary"],
      ["bordered", "secondary"],
      ["plain", "tertiary"],
    ] as const) {
      render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button", { name: variant }).className).toMatch(cls);
    }
  });

  it("default size is sm; size prop picks the class", () => {
    render(<Button>a</Button>);
    expect(screen.getByRole("button", { name: "a" }).className).toMatch(/sm/);
    render(<Button size="xs">b</Button>);
    expect(screen.getByRole("button", { name: "b" }).className).toMatch(/xs/);
  });

  it("forwards ref, className and native attributes", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} className="x" data-testid="t" title="tip">
        Go
      </Button>,
    );
    const b = screen.getByTestId("t");
    expect(ref.current).toBe(b);
    expect(b.className).toMatch(/\bx\b/);
    expect(b.getAttribute("title")).toBe("tip");
    expect(createEvent.click(b)).toBeTruthy();
  });
});

describe("Spinner (Progress Indicator)", () => {
  it("keeps its labelled progressbar role", () => {
    render(<Spinner label="Busy" />);
    expect(screen.getByRole("progressbar", { name: "Busy" })).toBeTruthy();
  });
  it("stroke is 1, 2 or 3 px by size", () => {
    render(<Spinner label="s" size={16} />);
    expect(screen.getByRole("progressbar").style.borderWidth).toBe("1px");
    cleanup();
    render(<Spinner label="s" size={24} />);
    expect(screen.getByRole("progressbar").style.borderWidth).toBe("2px");
    cleanup();
    render(<Spinner label="s" size={48} />);
    expect(screen.getByRole("progressbar").style.borderWidth).toBe("3px");
  });
  it("uses no raw colours", () => {
    expect(spinnerCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
