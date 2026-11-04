import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../api/types";
import { SessionInspector, type SessionInspectorProps } from "./SessionInspector";

const MESSAGES: ChatMessage[] = [
  {
    id: 1,
    sender_name: "Ana",
    participant_id: "p",
    signed_in: false,
    text: "hello",
    sent_at: "2026-10-25T10:00:00Z",
  },
];

function renderInspector(props: Partial<SessionInspectorProps> = {}, readOnly = false) {
  const chat = { messages: MESSAGES, readOnly, send: vi.fn(async () => "ok" as const) };
  return render(
    <SessionInspector descriptionHtml="<p>Two sum</p>" chatVisible={true} chat={chat} {...props} />,
  );
}

const region = (name: string) => screen.getByRole("region", { name, hidden: true });

afterEach(cleanup);

describe("SessionInspector (spec 008)", () => {
  it("shows the description above the chat, as separate regions, with no tabs (FR-1, NFR-2)", () => {
    renderInspector();
    const description = screen.getByRole("region", { name: "Description" });
    const chat = screen.getByRole("region", { name: "Chat" });
    expect(within(description).getByText("Two sum")).toBeTruthy();
    expect(within(chat).getByText("hello")).toBeTruthy();
    // Description precedes Chat in DOM order.
    expect(
      description.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector('[role="tablist"], [role="tab"], [role="tabpanel"]')).toBeNull();
    expect(screen.getByRole("separator", { name: "Resize description and chat" })).toBeTruthy();
  });

  it("keeps a hidden chat mounted but aria-hidden and inert, the description not (FR-2)", () => {
    renderInspector({ chatVisible: false });
    const chat = region("Chat");
    expect(within(chat).getByText("hello")).toBeTruthy();
    expect(chat.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(chat.closest("[inert]")).not.toBeNull();

    const description = screen.getByRole("region", { name: "Description" });
    expect(description.closest('[aria-hidden="true"]')).toBeNull();
    expect(description.closest("[inert]")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("disables the message input in a read-only (stale) chat (FR-9)", () => {
    renderInspector({}, true);
    const input = within(screen.getByRole("region", { name: "Chat" })).getByLabelText(
      "Message",
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });

  it("renders only the Chat region while the description is unknown (FR-9)", () => {
    renderInspector({ descriptionHtml: undefined });
    expect(screen.getByRole("region", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Description", hidden: true })).toBeNull();
    expect(screen.queryByRole("separator", { hidden: true })).toBeNull();
  });
});
