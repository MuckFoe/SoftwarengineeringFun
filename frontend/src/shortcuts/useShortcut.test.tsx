import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { label } from "./keys";
import { SHORTCUTS, type ShortcutId } from "./registry";
import { ShortcutList } from "./ShortcutList";
import { ShortcutScope, ShortcutsProvider, useShortcut } from "./useShortcut";

afterEach(cleanup);

// jsdom reports no platform, so the Windows/Linux combos apply (mod = Ctrl).
const ctrlEnter = { key: "Enter", code: "Enter", ctrlKey: true };

function Uses({ id, handler, enabled }: { id: ShortcutId; handler(): void; enabled?: boolean }) {
  useShortcut(id, handler, { enabled });
  return null;
}

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

const inScope = (scope: "session" | "problems" | "sheet" | null, children: ReactNode) => (
  <ShortcutsProvider>
    {scope ? <ShortcutScope scope={scope}>{children}</ShortcutScope> : children}
  </ShortcutsProvider>
);

describe("useShortcut", () => {
  // AC-18a
  it("runs the handler on its combo and prevents the browser default", () => {
    const run = vi.fn();
    render(inScope("session", <Uses id="run" handler={run} />));
    const e = press(ctrlEnter);
    expect(run).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("does nothing when the shortcut's scope is not active", () => {
    const run = vi.fn();
    render(inScope("problems", <Uses id="run" handler={run} />));
    const e = press(ctrlEnter);
    expect(run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("does nothing when disabled", () => {
    const run = vi.fn();
    render(inScope("session", <Uses id="run" handler={run} enabled={false} />));
    expect(press(ctrlEnter).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("always has the global scope", () => {
    const toggle = vi.fn();
    render(inScope(null, <Uses id="toggleSidebar" handler={toggle} />));
    press({ key: "s", code: "KeyS", ctrlKey: true, altKey: true });
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("only allows sheet and global shortcuts while a sheet is open", () => {
    const run = vi.fn();
    const save = vi.fn();
    render(
      <ShortcutsProvider>
        <ShortcutScope scope="session">
          <Uses id="run" handler={run} />
          <ShortcutScope scope="sheet">
            <Uses id="saveProblem" handler={save} />
          </ShortcutScope>
        </ShortcutScope>
      </ShortcutsProvider>,
    );
    press(ctrlEnter);
    press({ key: "s", code: "KeyS", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  });

  it("stops when the component unmounts", () => {
    const run = vi.fn();
    const { rerender } = render(inScope("session", <Uses id="run" handler={run} />));
    rerender(inScope("session", null));
    press(ctrlEnter);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs before the focused element sees the key, so the editor can't take ⌘↩", () => {
    const run = vi.fn();
    const editorKeydown = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(
      inScope(
        "session",
        <>
          <Uses id="run" handler={run} />
          <textarea data-testid="editor" aria-label="Code" onKeyDown={editorKeydown} />
        </>,
      ),
    );
    const editor = screen.getByTestId("editor");
    press(ctrlEnter, editor);
    expect(run).toHaveBeenCalledOnce();
    expect(editorKeydown).not.toHaveBeenCalled();
  });

  it("leaves a plain Return in a text area or on a button alone", () => {
    const action = vi.fn();
    render(
      inScope(
        "sheet",
        <>
          <Uses id="defaultButton" handler={action} />
          <textarea aria-label="Description" />
          <button type="button">Cancel</button>
        </>,
      ),
    );
    expect(press({ key: "Enter" }, screen.getByRole("textbox")).defaultPrevented).toBe(false);
    expect(press({ key: "Enter" }, screen.getByRole("button")).defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
    press({ key: "Enter" });
    expect(action).toHaveBeenCalledOnce();
  });
});

describe("ShortcutList", () => {
  // AC-18a: the list names every action
  it("shows one row per shortcut with this platform's label", () => {
    render(
      <ShortcutsProvider>
        <ShortcutList open onClose={() => {}} />
      </ShortcutsProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(SHORTCUTS.length);
    SHORTCUTS.forEach((s, i) => {
      expect(rows[i]?.textContent).toContain(s.label);
      expect(rows[i]?.textContent).toContain(label(s.other, false));
    });
  });

  it("opens in the sheet scope", () => {
    const run = vi.fn();
    render(
      <ShortcutsProvider>
        <ShortcutScope scope="session">
          <Uses id="run" handler={run} />
          <ShortcutList open onClose={() => {}} />
        </ShortcutScope>
      </ShortcutsProvider>,
    );
    press(ctrlEnter);
    expect(run).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(
      <ShortcutsProvider>
        <ShortcutList open={false} onClose={() => {}} />
      </ShortcutsProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("fires on the window even without focus inside the app", () => {
  const toggle = vi.fn();
  render(inScope(null, <Uses id="toggleSidebar" handler={toggle} />));
  fireEvent.keyDown(document.body, { key: "s", code: "KeyS", ctrlKey: true, altKey: true });
  expect(toggle).toHaveBeenCalledOnce();
});

it("is inactive, not an error, without a provider", () => {
  const run = vi.fn();
  render(
    <ShortcutScope scope="session">
      <Uses id="run" handler={run} />
    </ShortcutScope>,
  );
  expect(press(ctrlEnter).defaultPrevented).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
