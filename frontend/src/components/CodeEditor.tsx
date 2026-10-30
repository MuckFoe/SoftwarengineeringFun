import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { editorTheme } from "./editorTheme";

interface Props {
  doc: Y.Doc;
  awareness: Awareness;
  problemId: string;
}

/**
 * Binds CodeMirror (Python) to the session's shared `Y.Text` for this problem, with
 * remote cursors labelled by awareness `name` (FR-16, FR-18, FR-20).
 *
 * Tab indents by 4 spaces and Shift+Tab dedents, as Python expects. So keyboard users
 * aren't trapped (spec 003 FR-21, WCAG 2.1.2), Esc then Tab moves focus out instead; that
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
        keymap.of([indentWithTab]),
        editorTheme,
        yCollab(ytext, awareness, { undoManager: false }),
      ],
    });
    const view = new EditorView({ state, parent });
    return () => view.destroy();
  }, [doc, awareness, problemId]);

  return <div ref={containerRef} />;
}
