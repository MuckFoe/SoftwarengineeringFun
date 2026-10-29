// The description editor's toolbar as pure text transforms (spec 002 plan, Frontend).
// Each takes the textarea's value and selection and returns the new value and selection;
// the result is plain CommonMark, which the server renders.

export type TextEdit = { value: string; selectionStart: number; selectionEnd: number };

export type MarkdownCommand =
  | "heading"
  | "bold"
  | "italic"
  | "bulletedList"
  | "numberedList"
  | "inlineCode"
  | "codeBlock"
  | "link";

const PLACEHOLDER: Record<"bold" | "italic" | "inlineCode" | "link" | "codeBlock", string> = {
  bold: "bold text",
  italic: "italic text",
  inlineCode: "code",
  link: "link text",
  codeBlock: "code",
};

/** Replace value[start, end) with before + inner + after, selecting the given part. */
function splice(
  value: string,
  start: number,
  end: number,
  parts: [before: string, selected: string, after: string],
): TextEdit {
  const [before, selected, after] = parts;
  const selectionStart = start + before.length;
  return {
    value: value.slice(0, start) + before + selected + after + value.slice(end),
    selectionStart,
    selectionEnd: selectionStart + selected.length,
  };
}

function wrap(value: string, start: number, end: number, marker: string, placeholder: string) {
  const text = value.slice(start, end) || placeholder;
  return splice(value, start, end, [marker, text, marker]);
}

function inlineCode(value: string, start: number, end: number): TextEdit {
  const text = value.slice(start, end) || PLACEHOLDER.inlineCode;
  // A backtick inside the code needs a longer fence, padded so it can't touch the content.
  if (text.includes("`")) return splice(value, start, end, ["`` ", text, " ``"]);
  return splice(value, start, end, ["`", text, "`"]);
}

function link(value: string, start: number, end: number): TextEdit {
  const text = value.slice(start, end) || PLACEHOLDER.link;
  const url = "https://";
  return splice(value, start, end, [`[${text}](`, url, ")"]);
}

/** Apply `prefix(i)` to every line the selection touches; select the resulting block. */
function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: (i: number) => string,
): TextEdit {
  // A selection that ends just after a line break doesn't take in the next line.
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const newline = value.indexOf("\n", last);
  const lineEnd = newline === -1 ? value.length : newline;
  const block = value
    .slice(lineStart, lineEnd)
    .split("\n")
    .map((line, i) => prefix(i) + line)
    .join("\n");
  return splice(value, lineStart, lineEnd, ["", block, ""]);
}

function codeBlock(value: string, start: number, end: number): TextEdit {
  const text = value.slice(start, end) || PLACEHOLDER.codeBlock;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const fence = "```";
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const trail = after === "" || after.startsWith("\n") ? "" : "\n";
  return splice(value, start, end, [`${lead}${fence}\n`, text, `\n${fence}${trail}`]);
}

export function applyCommand(
  command: MarkdownCommand,
  value: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const [s, e] = [selectionStart, selectionEnd];
  switch (command) {
    case "bold":
      return wrap(value, s, e, "**", PLACEHOLDER.bold);
    case "italic":
      return wrap(value, s, e, "*", PLACEHOLDER.italic);
    case "inlineCode":
      return inlineCode(value, s, e);
    case "link":
      return link(value, s, e);
    case "heading":
      return prefixLines(value, s, e, () => "## ");
    case "bulletedList":
      return prefixLines(value, s, e, () => "- ");
    case "numberedList":
      return prefixLines(value, s, e, (i) => `${i + 1}. `);
    case "codeBlock":
      return codeBlock(value, s, e);
  }
}

/** Insert `![alt](/api/images/<id>)` at the cursor, after any selection; nothing is removed. */
export function insertImage(
  value: string,
  _selectionStart: number,
  selectionEnd: number,
  id: string,
  alt: string,
): TextEdit {
  const escaped = alt.replace(/[\\[\]]/g, (c) => `\\${c}`);
  const reference = `![${escaped}](/api/images/${id})`;
  const at = selectionEnd + reference.length;
  return {
    value: value.slice(0, selectionEnd) + reference + value.slice(selectionEnd),
    selectionStart: at,
    selectionEnd: at,
  };
}
