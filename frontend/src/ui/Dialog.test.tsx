// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import css from "./dialog.css?raw";
import { Sheet } from "./Sheet";

afterEach(cleanup);

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (s: string) => s.replace(/\s+/g, " ");
function rule(selector: string): string {
  const re = new RegExp(
    `(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  return norm(re.exec(strip(css))?.[2] ?? "");
}

describe("Dialog (spec 015 task 19)", () => {
  it("FR-4: tile has radius 0, elevation 4, padding 16, token colours", () => {
    const body = rule(".ui-dialog");
    expect(body).toContain("border-radius: 0");
    expect(body).toContain("box-shadow: var(--elev-4)");
    expect(body).toContain("padding: var(--space-16)");
    expect(body).toContain("background: var(--canvas)");
  });

  it("FR-4: scrim uses --scrim", () => {
    expect(rule(".ui-dialog::backdrop")).toContain("background: var(--scrim)");
  });

  it("FR-4: close button is 48 px, top right", () => {
    const body = rule(".ui-dialog .ui-dialog__close");
    expect(body).toContain("position: absolute");
    expect(body).toContain("top:");
    expect(body).toContain("right:");
    expect(body).toContain("width: var(--space-48)");
    expect(body).toContain("height: var(--space-48)");
  });

  it("FR-7: fills the viewport below 768 px", () => {
    const m = /@media \(max-width: 767px\)\s*\{([\s\S]*)\}/.exec(strip(css));
    expect(m).not.toBeNull();
    const inner = norm(m![1] ?? "");
    expect(inner).toContain("width: 100%");
    expect(inner).toContain("height: 100%");
    expect(inner).toContain("max-width: none");
  });

  it("renders a named modal dialog with a close button and footer", () => {
    render(
      <Dialog open onClose={() => {}} title="Hello" footer={<span>foot</span>}>
        <p>body</p>
      </Dialog>,
    );
    const d = screen.getByRole("dialog", { name: "Hello" });
    expect(d.tagName).toBe("DIALOG");
    expect(screen.getByText("foot")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.querySelector('.icon[data-icon="xmark"]')).not.toBeNull();
    expect(close.textContent).toBe("");
  });

  it("renders nothing while closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hello">
        x
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("FR-9: Esc (cancel) and the close button call onClose", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        x
      </Dialog>,
    );
    const ev = new Event("cancel", { cancelable: true });
    screen.getByRole("dialog").dispatchEvent(ev);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("FR-9: Tab cycles inside the dialog", () => {
    render(
      <Dialog open onClose={() => {}} title="T">
        <input aria-label="a" />
        <input aria-label="b" />
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const b = screen.getByLabelText("b");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(b);
  });

  it("FR-9: focus returns to the opener on close", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="T">
            x
          </Dialog>
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Decision 2: Sheet export remains and keeps anim-sheet-in", () => {
    render(
      <Sheet open onClose={() => {}} title="T">
        x
      </Sheet>,
    );
    expect(screen.getByRole("dialog").className).toMatch(/anim-sheet-in/);
  });
});
