import { acceptCompletion } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { getIndentUnit } from "@codemirror/language";
import { EditorSelection, type Extension, Prec } from "@codemirror/state";
import { type Command, keymap } from "@codemirror/view";

/** Tab with no selection: insert one indent unit at every cursor. With a selection: indentMore. */
export const insertIndentAtCursor: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
  const unit = " ".repeat(getIndentUnit(state));
  view.dispatch(
    state.changeByRange((range) => ({
      changes: { from: range.from, insert: unit },
      range: EditorSelection.cursor(range.from + unit.length),
    })),
    { userEvent: "input.indent", scrollIntoView: true },
  );
  return true;
};

/** Prec.high keymap: Tab → acceptCompletion, then insertIndentAtCursor; Shift+Tab → indentLess. */
export const editorTabKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Tab", run: acceptCompletion },
    { key: "Tab", run: insertIndentAtCursor, shift: indentLess },
  ]),
);
