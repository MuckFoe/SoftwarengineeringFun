import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../api/types";
import { ChatPane } from "./ChatPane";

const at = (time: string) => `2026-10-25T${time}:00Z`;

const MESSAGES: ChatMessage[] = [
  { id: 1, sender_name: "Ana", text: "one", sent_at: at("10:00") },
  { id: 2, sender_name: "Ana", text: "two", sent_at: at("10:03") },
  { id: 3, sender_name: "Ben", text: "three", sent_at: at("10:04") },
  // More than 5 minutes after Ben's last: a new header.
  { id: 4, sender_name: "Ben", text: "four", sent_at: at("10:10") },
  { id: 5, sender_name: "Ana", text: "five", sent_at: at("10:11") },
];

function renderPane(props: Partial<Parameters<typeof ChatPane>[0]> = {}) {
  const send = vi.fn(async () => "ok" as const);
  render(<ChatPane messages={MESSAGES} readOnly={false} send={send} {...props} />);
  return { send };
}

const input = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

afterEach(cleanup);

describe("ChatPane (spec 003 FR-15)", () => {
  it("consecutive messages from one sender within 5 minutes share a header", () => {
    renderPane();
    const groups = within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(groups.map((g) => within(g).getByRole("heading").textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Ben"),
      expect.stringContaining("Ben"),
      expect.stringContaining("Ana"),
    ]);
    expect(within(groups[0] as HTMLElement).getByText("one")).toBeTruthy();
    expect(within(groups[0] as HTMLElement).getByText("two")).toBeTruthy();
    expect(
      within(groups[0] as HTMLElement)
        .getByRole("heading")
        .querySelector("time")?.dateTime,
    ).toBe(at("10:00"));
  });

  it("shows the character count against the 2000 limit while typing", () => {
    renderPane();
    expect(screen.getByText("0/2000")).toBeTruthy();
    fireEvent.change(input(), { target: { value: "hello" } });
    expect(screen.getByText("5/2000")).toBeTruthy();
  });

  it("Return sends and clears the input; Shift+Return does not send", async () => {
    const { send } = renderPane();
    fireEvent.change(input(), { target: { value: "try a hashmap" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(send).toHaveBeenCalledWith("try a hashmap");
    await waitFor(() => expect(input().value).toBe(""));
  });

  it("a refused message states the limit and keeps the text", async () => {
    const send = vi.fn(async () => "chat_too_long" as const);
    renderPane({ send });
    const long = "a".repeat(2001);
    fireEvent.change(input(), { target: { value: long } });
    expect(screen.getByText("2001/2000")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/2000 characters/)).toBeTruthy();
    expect(input().value).toBe(long);
  });

  it("a send that fails to reach the session keeps the text", async () => {
    const send = vi.fn(async () => {
      throw new Error("disconnected");
    });
    renderPane({ send });
    fireEvent.change(input(), { target: { value: "hello" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(await screen.findByText(/couldn't be sent/i)).toBeTruthy();
    expect(input().value).toBe("hello");
  });

  it("read-only: history shown, the input disabled with its reason", () => {
    const { send } = renderPane({ readOnly: true });
    expect(screen.getByText("five")).toBeTruthy();
    expect(input().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    const reason = screen.getByText(/stale/i);
    expect((input().getAttribute("aria-describedby") ?? "").split(" ")).toContain(
      reason.closest("[id]")?.id,
    );
    expect(send).not.toHaveBeenCalled();
  });

  // Spec 002 FR15
  it("shows a message's markup as exactly the characters sent", () => {
    const text = "<script>alert(1)</script> **bold** <b>x</b>";
    renderPane({ messages: [{ id: 1, sender_name: "Ana", text, sent_at: at("10:00") }] });
    const list = screen.getByRole("list", { name: "Messages" });
    const body = within(list).getByText(text);
    expect(body.textContent).toBe(text);
    expect(list.querySelector("script, b, strong")).toBeNull();
  });

  // Spec 002 FR19
  it("an admin has Remove on each message, naming its sender and time, and it removes that message", async () => {
    const remove = vi.fn(async () => undefined);
    renderPane({ canRemove: true, remove });
    const buttons = screen.getAllByRole("button", { name: /^Remove message from/ });
    expect(buttons).toHaveLength(MESSAGES.length);

    const time = new Date(at("10:04")).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    fireEvent.click(screen.getByRole("button", { name: `Remove message from Ben at ${time}` }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(3));
  });

  it("a removal that fails says so", async () => {
    const remove = vi.fn(async () => {
      throw new Error("forbidden");
    });
    renderPane({ canRemove: true, remove });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Remove message from/ })[0] as HTMLElement,
    );
    expect(await screen.findByText(/couldn't be removed/i)).toBeTruthy();
  });

  it("without the admin role there is no Remove", () => {
    renderPane({ canRemove: false });
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});
