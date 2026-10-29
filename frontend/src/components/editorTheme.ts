/**
 * The editor's look, written against theme tokens only (FR-7): switching appearance
 * swaps the CSS variables and needs no editor reconfiguration. Remote cursors keep
 * y-codemirror.next's own per-participant colours.
 */
import { HighlightStyle, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const themeSpec = {
  "&": {
    color: "var(--label)",
    backgroundColor: "var(--content-bg)",
    fontSize: "13px",
    height: "100%",
  },
  // Like any text field, the focused editor shows the focus ring (NFR-4, AC-21).
  "&.cm-focused": { outline: "3px solid var(--focus-ring)", outlineOffset: "-3px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--label)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--label)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection-bg)" },
  ".cm-activeLine": { backgroundColor: "var(--row-hover-bg)" },
  ".cm-gutters": {
    backgroundColor: "var(--content-bg)",
    color: "var(--label-tertiary)",
    borderRight: "1px solid var(--separator)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--row-hover-bg)",
    color: "var(--label-secondary)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--control-bg)",
    border: "1px solid var(--control-border)",
    color: "var(--label-secondary)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--selection-bg)",
    outline: "1px solid var(--accent)",
  },
  "&.cm-focused .cm-nonmatchingBracket": { color: "var(--status-error)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--status-warning-bg)",
    outline: "1px solid var(--status-warning)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection-bg)" },
  ".cm-selectionMatch": { backgroundColor: "var(--row-hover-bg)" },
  ".cm-panels": { backgroundColor: "var(--window-bg)", color: "var(--label)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--separator)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--separator)" },
  ".cm-textfield": {
    backgroundColor: "var(--control-bg)",
    border: "1px solid var(--control-border)",
    color: "var(--label)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--control-bg)",
    border: "1px solid var(--control-border)",
    color: "var(--label)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--content-bg)",
    border: "1px solid var(--separator)",
    color: "var(--label)",
    boxShadow: "var(--shadow-popover)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-label)",
  },
};

export const highlightSpecs: readonly TagStyle[] = [
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword, t.self],
    color: "var(--syntax-keyword)",
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syntax-number)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.definition(t.function(t.variableName)),
    ],
    color: "var(--syntax-function)",
  },
  { tag: [t.className, t.typeName, t.definition(t.className)], color: "var(--syntax-type)" },
  { tag: [t.variableName, t.propertyName, t.operator, t.punctuation], color: "var(--label)" },
  { tag: t.invalid, color: "var(--status-error)" },
];

export const editorTheme = [
  EditorView.theme(themeSpec),
  syntaxHighlighting(HighlightStyle.define(highlightSpecs)),
];
