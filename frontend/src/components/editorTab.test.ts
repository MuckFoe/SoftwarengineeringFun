// Spec 010: Tab inserts at the cursor; Shift+Tab dedents. Real CodeMirror, real keymap.
import { history, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { editorTabKeymap } from "./editorTab";

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
});

function make(doc: string, anchor: number, head = anchor): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [indentUnit.of("    "), history(), editorTabKeymap],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function press(view: EditorView, shiftKey = false): boolean {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab", shiftKey }), "editor");
}

const text = (v: EditorView) => v.state.doc.toString();
const sel = (v: EditorView) => v.state.selection.main;

describe("Tab with a cursor (FR-1, NFR-2)", () => {
  it("inserts 4 spaces at the end of the line, cursor after them", () => {
    const v = make("x = 1", 5);
    expect(press(v)).toBe(true);
    expect(text(v)).toBe("x = 1    ");
    expect(sel(v).from).toBe(9);
    expect(sel(v).empty).toBe(true);
    expect(text(v)).not.toContain("\t");
  });

  it("inserts mid-line and leaves the start of the line unchanged", () => {
    const v = make("x = 1", 1);
    press(v);
    expect(text(v)).toBe("x     = 1");
    expect(sel(v).from).toBe(5);
    expect(text(v)).not.toContain("\t");
  });
});

describe("Tab with a selection (FR-3, FR-6, NFR-2)", () => {
  it("indents every selected line and no others", () => {
    const v = make("a\nb\nc\nd\ne", 2, 7); // lines 2-4
    press(v);
    expect(text(v)).toBe("a\n    b\n    c\n    d\ne");
    expect(text(v)).not.toContain("\t");
  });

  it("indents the line for a selection inside one line, keeping the text selected", () => {
    const v = make("x = 1", 2, 5);
    press(v);
    expect(text(v)).toBe("    x = 1");
    expect(v.state.sliceDoc(sel(v).from, sel(v).to)).toBe("= 1");
    expect(text(v)).not.toContain("\t");
  });
});

describe("Shift+Tab (FR-4)", () => {
  it("removes 4 of 8 leading spaces", () => {
    const v = make("        x", 9);
    press(v, true);
    expect(text(v)).toBe("    x");
  });

  it("removes a 2-space indent entirely", () => {
    const v = make("  x", 3);
    press(v, true);
    expect(text(v)).toBe("x");
  });

  it("dedents every selected line", () => {
    const v = make("a\n    b\n    c\nd", 6, 12);
    press(v, true);
    expect(text(v)).toBe("a\nb\nc\nd");
  });
});

describe("undo (NFR-1)", () => {
  it("one undo reverts a multi-line indent", () => {
    const v = make("a\nb\nc\nd\ne", 2, 7);
    press(v);
    undo(v);
    expect(text(v)).toBe("a\nb\nc\nd\ne");
  });

  it("one undo reverts Tab at a cursor", () => {
    const v = make("x = 1", 5);
    press(v);
    undo(v);
    expect(text(v)).toBe("x = 1");
  });
});
