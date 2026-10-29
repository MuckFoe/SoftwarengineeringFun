import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../api/types";
import { charCount, chatError, MAX_CHAT_CHARS } from "./chatRules";
import { addMessage, type ChatState, removeMessage, replaceHistory } from "./chatState";

function msg(id: number, text = `m${id}`): ChatMessage {
  return { id, sender_name: "Ana", text, sent_at: "2026-10-25T09:00:00Z" };
}

const ids = (s: ChatState) => s.messages.map((m) => m.id);
const empty: ChatState = { messages: [] };

describe("chatState", () => {
  it("FR18: a reconnect's history overlapping the current list gives each id once, in order", () => {
    // Ana saw 1 and 2, then dropped; Ben sent 3 and 4; welcome.chat carries 1..4.
    const before = addMessage(addMessage(empty, msg(1)), msg(2));
    const after = replaceHistory(before, [msg(1), msg(2), msg(3), msg(4)]);
    expect(ids(after)).toEqual([1, 2, 3, 4]);
  });

  it("replaceHistory sorts and dedupes what it is given", () => {
    const s = replaceHistory(empty, [msg(3), msg(1), msg(3), msg(2)]);
    expect(ids(s)).toEqual([1, 2, 3]);
  });

  it("replaceHistory drops messages that are no longer in the history", () => {
    const s = replaceHistory(replaceHistory(empty, [msg(1), msg(2), msg(3)]), [msg(1), msg(3)]);
    expect(ids(s)).toEqual([1, 3]);
  });

  it("addMessage of an id already present is a no-op", () => {
    const s = addMessage(empty, msg(1, "one"));
    const again = addMessage(s, msg(1, "one"));
    expect(again).toBe(s);
    expect(ids(again)).toEqual([1]);
  });

  it("messages added out of id order end up sorted", () => {
    // Two concurrent sends can be broadcast in the opposite order to their ids.
    const s = [5, 2, 4, 1, 3].reduce((acc, id) => addMessage(acc, msg(id)), empty);
    expect(ids(s)).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not mutate the state it is given", () => {
    const s = replaceHistory(empty, [msg(1), msg(3)]);
    addMessage(s, msg(2));
    removeMessage(s, 1);
    expect(ids(s)).toEqual([1, 3]);
  });

  it('FR19: removing "two" leaves "one" and "three"', () => {
    const s = replaceHistory(empty, [msg(1, "one"), msg(2, "two"), msg(3, "three")]);
    expect(removeMessage(s, 2).messages.map((m) => m.text)).toEqual(["one", "three"]);
  });

  it("removing an unknown id is a no-op", () => {
    const s = replaceHistory(empty, [msg(1), msg(2)]);
    expect(removeMessage(s, 9)).toBe(s);
  });
});

describe("chatRules", () => {
  it("FR13: whitespace-only or empty text is chat_empty", () => {
    expect(chatError("  \n")).toBe("chat_empty");
    expect(chatError("")).toBe("chat_empty");
    expect(chatError("\t \n \n")).toBe("chat_empty");
  });

  it("FR14: charCount counts code points, so an emoji is 1", () => {
    expect(charCount("😀")).toBe(1);
    expect("😀".length).toBe(2);
    expect(charCount("a😀b")).toBe(3);
  });

  it("FR14: 2000 characters are allowed, 2001 are chat_too_long", () => {
    expect(MAX_CHAT_CHARS).toBe(2000);
    expect(chatError("x".repeat(2000))).toBeNull();
    expect(chatError("x".repeat(2001))).toBe("chat_too_long");
  });

  it("FR14: 2000 astral characters (4000 UTF-16 units) are allowed", () => {
    expect(chatError("😀".repeat(2000))).toBeNull();
    expect(chatError("😀".repeat(2001))).toBe("chat_too_long");
  });

  it("FR14: the length is measured on the text as typed, whitespace included", () => {
    expect(chatError(` ${"x".repeat(2000)}`)).toBe("chat_too_long");
    expect(chatError("  hi  ")).toBeNull();
  });
});
