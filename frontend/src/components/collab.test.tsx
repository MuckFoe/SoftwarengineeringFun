import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { Participant } from "../api/types";
import { CodeEditor } from "./CodeEditor";
import { PresenceList } from "./PresenceList";

afterEach(cleanup);

describe("PresenceList", () => {
  it("FR-15: a presence update without Linus removes him from the list", () => {
    const withLinus: Participant[] = [
      { id: "a", name: "Ada" },
      { id: "l", name: "Linus" },
    ];
    const { rerender } = render(<PresenceList participants={withLinus} />);
    expect(screen.getByText("Linus")).toBeTruthy();

    rerender(<PresenceList participants={[{ id: "a", name: "Ada" }]} />);

    expect(screen.queryByText("Linus")).toBeNull();
    expect(screen.getByText("Ada")).toBeTruthy();
  });
});

describe("CodeEditor", () => {
  it("FR-16: shows the Y.Text content", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    doc.getText("code:p1").insert(0, "def add(a, b):\n    return a + b\n");

    const { container } = render(<CodeEditor doc={doc} awareness={awareness} problemId="p1" />);

    expect(container.textContent).toContain("return a + b");
  });

  it("FR-20: a peer's awareness cursor on line 3 renders a labelled remote cursor", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const ytext = doc.getText("code:p1");
    ytext.insert(0, "line1\nline2\nline3\n");

    const { container } = render(<CodeEditor doc={doc} awareness={awareness} problemId="p1" />);

    const line3Index = ytext.toString().indexOf("line3");
    const position = Y.createRelativePositionFromTypeIndex(ytext, line3Index);
    awareness.states.set(9999, {
      user: { name: "Linus" },
      cursor: { anchor: position, head: position },
    });
    awareness.emit("change", [{ added: [9999], updated: [], removed: [] }, "test"]);

    expect(container.textContent).toContain("Linus");
    expect(container.querySelector(".cm-ySelectionCaret")).toBeTruthy();
  });

  it("F5: Tab indents the line by 4 spaces, Shift+Tab takes them away again", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const ytext = doc.getText("code:p1");
    ytext.insert(0, "return 1\n");

    const { container } = render(<CodeEditor doc={doc} awareness={awareness} problemId="p1" />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    expect(fireEvent.keyDown(content, { key: "Tab", keyCode: 9 })).toBe(false);
    expect(ytext.toString()).toBe("    return 1\n");

    fireEvent.keyDown(content, { key: "Tab", keyCode: 9, shiftKey: true });
    expect(ytext.toString()).toBe("return 1\n");
  });

  it("F5: Esc then Tab leaves the editor alone, so focus can move on (WCAG 2.1.2)", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const ytext = doc.getText("code:p1");
    ytext.insert(0, "return 1\n");

    const { container } = render(<CodeEditor doc={doc} awareness={awareness} problemId="p1" />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "Escape", keyCode: 27 });
    // Not prevented: the browser's own Tab handling moves focus.
    expect(fireEvent.keyDown(content, { key: "Tab", keyCode: 9 })).toBe(true);
    expect(ytext.toString()).toBe("return 1\n");
  });
});
