import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveBadge } from "./LiveBadge";
import css from "./LiveBadge.module.css?raw";

afterEach(cleanup);

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector is `selector`, optionally inside the reduced-motion block. */
function rule(selector: string, reduced = false): string {
  const marker = "@media (prefers-reduced-motion: reduce)";
  const at = stripped.indexOf(marker);
  const scope = reduced
    ? stripped.slice(stripped.indexOf("{", at) + 1)
    : at < 0
      ? stripped
      : stripped.slice(0, at);
  if (reduced && at < 0) throw new Error("no reduced-motion block");
  for (const chunk of scope.split("}")) {
    const [sel = "", body] = chunk.split("{");
    if (body !== undefined && sel.split(",").some((x) => x.trim().endsWith(selector))) return body;
  }
  throw new Error(`no rule for ${selector}`);
}

describe("LiveBadge", () => {
  it("shows the visible text Live and a dot (FR-5)", () => {
    const { container } = render(<LiveBadge />);
    expect(screen.getByText("Live")).toBeTruthy();
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });

  it("the dot has one pulse animation based on --motion-sweep (FR-5)", () => {
    const body = rule(".dot");
    expect(body).toMatch(/animation:[^;]*pulse/);
    expect(body).not.toMatch(/animation:\s*none/);
    expect(body).toMatch(/--motion-sweep/);
    expect(stripped.match(/@keyframes/g)).toHaveLength(1);
  });

  it("no pulse under reduced motion, text remains (FR-3)", () => {
    expect(rule(".dot", true)).toMatch(/animation:\s*none/);
    render(<LiveBadge />);
    expect(screen.getByText("Live")).toBeTruthy();
  });
});
