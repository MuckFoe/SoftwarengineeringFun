# 010 — Tab inserts at the cursor in the code editor: tasks

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1 | The keymap module is the thing everything else uses or tests. |
| 2 | 2, 3 — all `[P]` | 2 only adds unit tests to `editorTab.test.ts`; 3 only edits `CodeEditor.tsx`. Disjoint files, both need only task 1. |
| 3 | 4 | E2E needs the keymap wired into the real editor (3). |
| 4 | 5 | Same e2e file as 4, so it cannot share a wave with it. |

## Checklist

- [x] **1** — `editorTab.ts`: Tab at the cursor inserts 4 spaces, with keymap
- [x] **2** — `[P]` Unit tests: selection indent, Shift+Tab, single-line selection, undo
- [x] **3** — `[P]` Use `editorTabKeymap` in `CodeEditor.tsx`
- [x] **4** — E2E: Tab at end of line, Tab accepts a suggestion
- [x] **5** — E2E: Esc then Tab leaves the editor, Tab shows to the other participant

## Tasks

### 1. `editorTab.ts`: Tab at the cursor inserts 4 spaces, with keymap

- **Plan:** `editorTab.ts` (new), `editorTab.test.ts` (new); Key handling, in order. **Spec:** FR-1, NFR-2.
- **Files:** `frontend/src/components/editorTab.ts`, `frontend/src/components/editorTab.test.ts`
- **Depends on:** nothing
- **Do:** Write the FR-1 / NFR-2 unit tests first (real `EditorView` with `indentUnit.of("    ")`, `history()` and `editorTabKeymap`; key fired with `runScopeHandlers`), see them fail. Then add `insertIndentAtCursor` (empty ranges: insert the `indentUnit` at each cursor, cursor after it, one dispatch with `userEvent: "input.indent"`; any non-empty range: `indentMore`) and `editorTabKeymap` (`Prec.high` keymap: Tab → `acceptCompletion`, then `insertIndentAtCursor`; Shift+Tab → `indentLess`), exported as in the plan's contract.
- **Acceptance:**
  - *FR-1 — Given the line `x = 1` with the cursor at its end, when Tab is pressed, then the line is `x = 1` followed by 4 spaces and the cursor is after them.* Unit test asserts `state.doc` and the cursor position.
  - *FR-1 — Given the cursor between `x` and ` = 1`, when Tab is pressed, then 4 spaces are inserted there and the start of the line is unchanged.* Unit test: result is `x···· = 1`.
  - *NFR-2 — Tab never inserts a tab character.* Every case in this task also asserts the doc contains no `\t`.

### 2. `[P]` Unit tests: selection indent, Shift+Tab, single-line selection, undo

- **Plan:** `editorTab.test.ts`; `insertIndentAtCursor` (selection branch), `indentLess`, collaboration and undo. **Spec:** FR-3, FR-4, FR-6, NFR-1, NFR-2.
- **Files:** `frontend/src/components/editorTab.test.ts`
- **Depends on:** 1
- **Do:** Add tests for the selection cases from the acceptance criteria. They should pass against task 1's module; if one fails, fix `editorTab.ts` (a plan bug to report, not silently absorb). Each case asserts no `\t`.
- **Acceptance:**
  - *FR-3 — Given lines 2–4 are selected, when Tab is pressed, then each of lines 2, 3 and 4 starts with 4 more spaces, and lines 1 and 5 are unchanged.*
  - *FR-4 — Given a line indented by 8 spaces, when Shift+Tab is pressed, then it is indented by 4.* Also: a 2-space line goes to no indent; lines 2–3 selected, each indented by 4, both go to no indent.
  - *FR-6 — Given `= 1` is selected in the line `x = 1`, when Tab is pressed, then the line is `    x = 1` and `= 1` is still selected.* Assert the selection range covers exactly `= 1`.
  - *NFR-1 — Given Tab pressed with lines 2–4 selected, when undo once, then lines 2–4 have their previous indentation.* Also: Tab at a cursor, one undo → original text.

### 3. `[P]` Use `editorTabKeymap` in `CodeEditor.tsx`

- **Plan:** `CodeEditor.tsx` edit. **Spec:** FR-1, FR-2, FR-5.
- **Files:** `frontend/src/components/CodeEditor.tsx`
- **Depends on:** 1
- **Do:** Replace `keymap.of([indentWithTab])` with `editorTabKeymap`; remove the unused `indentWithTab` import; update the doc comment to describe the new Tab behaviour. Nothing else changes (props, rendered output).
- **Acceptance:**
  - *FR-5 — Given focus is in the editor, when Esc then Tab, then focus is on the next control after the editor.* The existing `e2e/keyboard.spec.ts` Esc-then-Tab test passes unchanged.
  - *FR-1, FR-2 — the editor uses the new keymap.* `tsc --noEmit` and `biome ci` pass on the changed files; no reference to `indentWithTab` remains in `CodeEditor.tsx`; the existing `CodeEditor` unit tests still pass.

### 4. E2E: Tab at end of line, Tab accepts a suggestion

- **Plan:** `e2e/editor-tab.spec.ts` (new). **Spec:** FR-1, FR-2.
- **Files:** `e2e/editor-tab.spec.ts`
- **Depends on:** 3
- **Do:** Create the spec file using the existing fixtures: open a session, type into the real editor, press real keys. Write the two tests; they are expected to pass once 3 has landed. Run only this file while iterating.
- **Acceptance:**
  - *FR-1 — Given the line `x = 1` with the cursor at its end, when the participant presses Tab, then the line is `x = 1` followed by 4 spaces and the cursor is after them.* Real keypress in the browser.
  - *FR-2 — Given an autocomplete suggestion `print` is open after typing `pri`, when the participant presses Tab, then the line reads `print` with no extra spaces and its indentation is unchanged.* Wait for the suggestion popup, press Tab, assert the line text.

### 5. E2E: Esc then Tab leaves the editor, Tab shows to the other participant

- **Plan:** `e2e/editor-tab.spec.ts`; Esc then Tab, Collaboration and undo. **Spec:** FR-5, FR-7.
- **Files:** `e2e/editor-tab.spec.ts`
- **Depends on:** 4
- **Do:** Add the two tests to the file from task 4. FR-7 uses two browser contexts in one session.
- **Acceptance:**
  - *FR-5 — Given focus is in the editor, when the participant presses Esc then Tab, then focus is on the next control after the editor, and the solution text is unchanged.* Assert `document.activeElement` is outside the editor and the text equals what it was.
  - *FR-7 — Given two participants in one session, when one presses Tab at the end of line 1, then the other sees the 4 spaces on line 1.* Assert on the second participant's editor content.
