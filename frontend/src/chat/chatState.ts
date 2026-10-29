// Chat message list (spec 002 plan, Chat — Order). Pure.
// The order is the server's message id. Broadcasts can arrive out of id order and a
// reconnect replays history, so the list is kept sorted by id with each id once.

import type { ChatMessage } from "../api/types";

export type ChatState = { messages: ChatMessage[] };

function sortedUnique(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** A `welcome` or REST history: it replaces the list, so nothing is duplicated or missed. */
export function replaceHistory(_s: ChatState, messages: ChatMessage[]): ChatState {
  return { messages: sortedUnique(messages) };
}

export function addMessage(s: ChatState, m: ChatMessage): ChatState {
  if (s.messages.some((x) => x.id === m.id)) return s;
  return { messages: sortedUnique([...s.messages, m]) };
}

export function removeMessage(s: ChatState, id: number): ChatState {
  if (!s.messages.some((x) => x.id === id)) return s;
  return { messages: s.messages.filter((x) => x.id !== id) };
}
