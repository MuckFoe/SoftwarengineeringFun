import { python } from "@codemirror/lang-python";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { editorTabKeymap } from "./editorTab";
import { editorTheme } from "./editorTheme";

interface Props {
  doc: Y.Doc;
  awareness: Awareness;
  problemId: string;
}

/**
 * The editor's name and tab stop (spec 008 NFR-2). The tab stop is on the content, inside the
 * scroll area, so the scroll area (`.cm-scroller`) holds a focusable element and long lines
 * can be scrolled by keyboard (axe scrollable-region-focusable). An editable content is in the
 * tab order already, so this adds no stop; a read-only one becomes reachable.
 */
export const editorAccess = EditorView.contentAttributes.of({
  "aria-label": "Code",
  tabindex: "0",
});

/**
 * Binds CodeMirror (Python) to the session's shared `Y.Text` for this problem, with
 * remote cursors labelled by awareness `name` (FR-16, FR-18, FR-20).
 *
 * Tab inserts 4 spaces at the cursor, accepts an open suggestion, or indents the selected
 * lines; Shift+Tab dedents (spec 010). So keyboard users aren't trapped (spec 003 FR-21, WCAG 2.1.2), Esc then Tab moves focus out instead; that
 * escape is CodeMirror's own tab-focus mode.
 */
export function CodeEditor({ doc, awareness, problemId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const ytext = doc.getText(`code:${problemId}`);
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        python(),
        indentUnit.of("    "),
        editorTabKeymap,
        editorTheme,
        editorAccess,
        yCollab(ytext, awareness, { undoManager: false }),
      ],
    });
    const view = new EditorView({ state, parent });
    return () => view.destroy();
  }, [doc, awareness, problemId]);

  return <div ref={containerRef} />;
}
