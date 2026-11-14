/**
 * The editor's look, written against theme tokens only (FR-1, FR-10): switching appearance
 * swaps the CSS variables and needs no editor reconfiguration. Remote cursors keep
 * y-codemirror.next's own per-participant colours.
 */
import { HighlightStyle, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const themeSpec = {
  "&": {
    color: "var(--text)",
    backgroundColor: "var(--surface-1)",
    // The user's text scale applies to code too (tokens.css --text-scale).
    fontSize: "calc(13px * var(--text-scale))",
    height: "100%",
  },
  // Like any text field, the focused editor shows the focus ring (NFR-4, AC-21).
  "&.cm-focused": { outline: "3px solid var(--focus)", outlineOffset: "-3px" },
  ".cm-scroller": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--focus)" },
  // 2 px, so the caret stays visible beside a highlighted bracket.
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--focus)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in srgb, var(--focus) 30%, transparent)" },
  // No current-line band: it ran to the editor's edge, behind the panels' rounded bars. The
  // current line's number still stands out in the gutter.
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-1)",
    color: "var(--form-caption)",
    borderRight: "1px solid var(--divider)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--text)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--canvas)",
    border: "1px solid var(--ui-stroke)",
    color: "var(--text)",
  },
  // Neutral, no outline. A blue box drawn in the caret's colour hid the blinking caret,
  // which sits right on the edge between auto-closed brackets ("(|)").
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--neutral-700)",
    textDecoration: "underline",
    textDecorationColor: "var(--form-caption)",
  },
  "&.cm-focused .cm-nonmatchingBracket": { color: "var(--negative)" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--notice) 30%, transparent)",
    outline: "1px solid var(--notice)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--focus) 30%, transparent)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--neutral-700)" },
  ".cm-panels": { backgroundColor: "var(--canvas)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--divider)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--divider)" },
  ".cm-textfield": {
    backgroundColor: "var(--canvas)",
    border: "1px solid var(--ui-stroke)",
    color: "var(--text)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--canvas)",
    border: "1px solid var(--ui-stroke)",
    color: "var(--text)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface-1)",
    border: "1px solid var(--divider)",
    color: "var(--text)",
    boxShadow: "var(--elev-3)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--action-primary-fill)",
    color: "var(--action-primary-text)",
  },
};

export const highlightSpecs: readonly TagStyle[] = [
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword, t.self],
    color: "var(--text-interactive)",
    fontWeight: "bold",
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--intelligent)" },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: "color-mix(in srgb, var(--neon-blue) 80%, var(--text-interactive))",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--form-caption)",
    fontStyle: "italic",
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.definition(t.function(t.variableName)),
    ],
    color: "var(--text)",
  },
  { tag: [t.className, t.typeName, t.definition(t.className)], color: "var(--text)" },
  { tag: [t.variableName, t.propertyName, t.operator, t.punctuation], color: "var(--text)" },
  { tag: t.invalid, color: "var(--negative)" },
];

export const editorTheme = [
  EditorView.theme(themeSpec),
  syntaxHighlighting(HighlightStyle.define(highlightSpecs)),
];
