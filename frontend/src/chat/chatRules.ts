// Chat message rules (spec 002 plan, Chat — Validation), mirroring backend chat/rules.py.
// A character is a Unicode code point, as Python's len() counts it. Only the emptiness
// check uses the trimmed text; the length is measured on the text as typed.

export const MAX_CHAT_CHARS = 2000;

export function charCount(text: string): number {
  return [...text].length;
}

export function chatError(text: string): "chat_empty" | "chat_too_long" | null {
  if (text.trim() === "") return "chat_empty";
  if (charCount(text) > MAX_CHAT_CHARS) return "chat_too_long";
  return null;
}
