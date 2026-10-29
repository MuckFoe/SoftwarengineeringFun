// jsdom has neither HTMLDialogElement.showModal() nor the popover API. They aren't stubbed
// (constitution rule 4): modality, the focus trap, Esc and light dismiss are asserted in
// E2E (task 34). Here: structure, naming, and the events the components handle.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover";
import { Sheet } from "./Sheet";

afterEach(cleanup);

describe("Sheet", () => {
  // AC-2 (component part)
  it("renders an open dialog named by its title without changing location", () => {
    const before = window.location.href;
    render(
      <Sheet open onClose={() => {}} title="New problem">
        <p>body</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "New problem" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByText("body")).toBeTruthy();
    expect(window.location.href).toBe(before);
  });

  it("renders nothing visible while closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} title="New problem">
        <p>body</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("body")).toBeNull();
  });

  it("closes when it is reopened as closed", () => {
    const { rerender } = render(
      <Sheet open onClose={() => {}} title="T">
        x
      </Sheet>,
    );
    rerender(
      <Sheet open={false} onClose={() => {}} title="T">
        x
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // AC-18: Esc raises `cancel` on a modal dialog; the sheet hands it to onClose.
  it("calls onClose on cancel and keeps itself open until the parent closes it", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="T">
        x
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(onClose).toHaveBeenCalledOnce();
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("runs defaultAction when its form is submitted (Return)", () => {
    const defaultAction = vi.fn();
    render(
      <Sheet open onClose={() => {}} title="T" defaultAction={defaultAction}>
        <input aria-label="Title" />
        <button type="submit">Save</button>
      </Sheet>,
    );
    fireEvent.submit(screen.getByRole("textbox", { name: "Title" }));
    expect(defaultAction).toHaveBeenCalledOnce();
  });

  it("uses the sheet animation", () => {
    render(
      <Sheet open onClose={() => {}} title="T">
        x
      </Sheet>,
    );
    expect(screen.getByRole("dialog").className).toMatch(/anim-sheet-in/);
  });
});

describe("Popover", () => {
  it("is a trigger button that targets a popover element holding the content", () => {
    render(
      <Popover label="Appearance" icon="sun">
        <p>choices</p>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Appearance" });
    const targetId = trigger.getAttribute("popovertarget") ?? "";
    const panel = document.getElementById(targetId);
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("popover")).toBe("auto");
    expect(panel?.textContent).toBe("choices");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("labels the panel after the trigger", () => {
    render(
      <Popover label="Account">
        <p>menu</p>
      </Popover>,
    );
    const panel = screen.getByText("menu").closest("[popover]");
    expect(panel?.getAttribute("aria-label")).toBe("Account");
  });
});

describe("Sheet re-rendering", () => {
  it("opens once however often the parent re-renders, and cancel reaches the latest onClose", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(
      <Sheet open onClose={() => first()} title="T">
        x
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    rerender(
      <Sheet open onClose={() => latest()} title="T">
        x
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });
});
