# 010 — Plan: Tab inserts at the cursor in the code editor

Spec: [spec.md](spec.md). Frontend only; no backend, database or deployment change.

## Architecture

The session's code editor is CodeMirror 6 (`basicSetup`, `python()`, `indentUnit` of 4 spaces), bound to the shared `Y.Text` through `yCollab`. Today its Tab binding is CodeMirror's `indentWithTab`, whose Tab runs `indentMore`: it indents every line touched by the selection, including an empty one. That is the cause of both F10 symptoms: Tab with a cursor indents the whole line (breaks FR-1), and Tab with a suggestion open falls through to `indentMore` because no Tab binding accepts completions (breaks FR-2).

The fix replaces that one binding with a small Tab keymap of our own.

### Module layout

| Module | Change | Responsibility |
|---|---|---|
| `frontend/src/components/editorTab.ts` | **new** | `insertIndentAtCursor` command and the `editorTabKeymap` extension. Pure CodeMirror, no React. |
| `frontend/src/components/editorTab.test.ts` | **new** | Unit tests of the keymap on a real `EditorView` (jsdom). |
| `frontend/src/components/CodeEditor.tsx` | edit | Swap `keymap.of([indentWithTab])` for `editorTabKeymap`; update the doc comment. |
| `e2e/editor-tab.spec.ts` | **new** | Browser tests for real keypresses, autocomplete, focus and two participants. |

Dependency direction: `CodeEditor.tsx → editorTab.ts → @codemirror/{commands,autocomplete,state,view}`. `editorTab.ts` imports nothing from the app.

### Key handling, in order

`editorTabKeymap` is `Prec.high(keymap.of([...]))`, so it runs before `basicSetup`'s keymaps. CodeMirror tries same-key bindings in order until one returns `true`:

1. **Tab → `acceptCompletion`** (`@codemirror/autocomplete`). Returns `true` only when a suggestion is open; it accepts it and the key is consumed, so nothing else runs (FR-2).
2. **Tab → `insertIndentAtCursor`**, **Shift+Tab → `indentLess`** (`@codemirror/commands`).

`insertIndentAtCursor(view)`:

- If every selection range is empty: replace each cursor with the indent unit (`"    "`, read from `indentUnit`, so it never inserts `\t` — NFR-2), cursor after it (FR-1). One `view.dispatch`, `userEvent: "input.indent"`.
- Otherwise (any range non-empty): delegate to `indentMore`. It adds one indent unit to the start of every line touched by a selection and maps the selection through the change, so a multi-line selection indents each line (FR-3) and a selection inside one line indents that line while still covering the same text (FR-6).

`indentLess` removes up to one indent unit of leading whitespace from the cursor's line or every selected line; a 2-space line goes to 0 (FR-4). Shift+Tab never inserts anything.

### Esc then Tab (FR-5)

Unchanged mechanism: CodeMirror's own tab-focus mode. Esc puts the view into temporary tab-focus mode, in which the view lets the next Tab move focus instead of running Tab keymaps. Our keymap must not bypass that; the e2e test pins it.

### Collaboration and undo (FR-7, NFR-1)

Each Tab/Shift+Tab is one transaction from one `dispatch`. `yCollab` turns it into one Yjs update, which reaches the other participants like any other edit (FR-7). Undo is `basicSetup`'s `history()` (`yCollab` runs with `undoManager: false`), which records one transaction as one undo step (NFR-1). No change to the sync path.

## Data model

None. The solution text is still the session's shared `Y.Text`; only which characters a keypress puts into it changes.

## Contracts

```ts
// frontend/src/components/editorTab.ts
import type { Command } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** Tab with no selection: insert one indent unit at every cursor. With a selection: indentMore. */
export const insertIndentAtCursor: Command;

/** Prec.high keymap: Tab → acceptCompletion, then insertIndentAtCursor; Shift+Tab → indentLess. */
export const editorTabKeymap: Extension;
```

`CodeEditor`'s props and rendered output are unchanged.

## Test strategy

**Unit (Vitest, jsdom)** — `editorTab.test.ts` builds a real `EditorView` with `indentUnit.of("    ")`, `history()` and `editorTabKeymap`, sets doc and selection, then fires the key through the real keymap with `runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab", shiftKey }), "editor")`, and asserts `state.doc` and `state.selection`. Real CodeMirror throughout; nothing mocked (constitution 4).

**E2E (Playwright, existing fixtures)** — `editor-tab.spec.ts` opens a session and types into the real editor. Used where jsdom can't stand in: autocomplete popups (layout and async completion sources), focus movement, and two browsers sharing a session. The existing keyboard-order test in `e2e/keyboard.spec.ts` (Esc then Tab leaves the editor) must keep passing unchanged.

| Criterion | Level | Test |
|---|---|---|
| FR-1 (cursor at end; cursor mid-line) | unit + e2e | `x = 1` with cursor at end → `x = 1····`, cursor at end; cursor after `x` → `x···· = 1`, start of line unchanged. E2E repeats the end-of-line case with a real keypress. |
| FR-2 | e2e | Type `pri`, wait for the `print` suggestion, press Tab → line is `print`, no added spaces, indentation unchanged. |
| FR-3 | unit | Lines 2–4 selected → each gains 4 leading spaces; lines 1 and 5 unchanged. |
| FR-4 | unit | 8→4 spaces; 2→0 spaces; lines 2–3 at 4 selected → both 0. |
| FR-5 | e2e | Focus in editor, Esc, Tab → focus on the next control after the editor; solution text unchanged. |
| FR-6 | unit | `= 1` selected in `x = 1` → line `    x = 1`, selection still exactly `= 1`. |
| FR-7 | e2e | Two participants in one session; one presses Tab at end of line 1; the other's editor shows the 4 spaces on line 1. |
| NFR-1 | unit | Lines 2–4 selected, Tab, one `undo` → lines 2–4 back to previous indentation (also: Tab at cursor, one undo → original text). |
| NFR-2 | unit | Asserted in every FR-1/3/6 case: the doc contains no `\t`. |

## Constitution compliance

1. **Test-first** — every criterion above has a test written from its Given/When/Then before `editorTab.ts` exists; the unit tests fail against today's `indentWithTab` (FR-1, FR-6 differ) or fail to import.
2. **Green before done** — targeted runs while iterating (`vitest run editorTab`, the one e2e file); full suite on a fresh stack once per task.
3. **Traceable tests** — the table maps every spec criterion to a test; tasks will name them.
4. **Real dependencies** — real CodeMirror, real Yjs sync and real browsers; no mocks.
5. **Fixed stack** — React + TypeScript strict, Vite. No departure.
6. **Dependency justification** — no new third-party dependency. `@codemirror/commands` and `@codemirror/autocomplete` are already declared. `@codemirror/state` (for `Prec`, `Extension`) is already imported by `CodeEditor.tsx` but reached only transitively through `codemirror`; leaving that as is, since it is not new to this feature. Flag for the human if it should be declared explicitly.
7. **No secrets** — none involved.
8. **Lint and format** — `biome ci` and `tsc --noEmit` on the changed files.
9. **Architecture** — module layout and dependency direction stated above.

No conflicts.
