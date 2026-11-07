// Spec 016 task 19 (FR-14, FR-7): the invite link with an always-visible primary "Copy link" pill and a polite "Copied" status.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteLink } from "./InviteLink";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("InviteLink", () => {
  it("shows the link and a primary Copy link pill without any interaction", () => {
    render(<InviteLink link="http://x/games/chess/s/abc" />);
    expect((screen.getByLabelText("Invite link") as HTMLInputElement).value).toBe(
      "http://x/games/chess/s/abc",
    );
    const btn = screen.getByRole("button", { name: "Copy link" });
    expect(btn.textContent).toContain("Copy link");
    expect(btn.className).toMatch(/primary/);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("copies the link and confirms with a polite Copied status that clears after about 2 s", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.useFakeTimers();
    render(<InviteLink link="http://x/s/abc" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith("http://x/s/abc");
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Copied");
    expect(status.getAttribute("aria-live")).toBe("polite");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("falls back to execCommand on a hidden textarea when there is no clipboard API", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    render(<InviteLink link="http://x/s/abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Copied");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("is a native button, so Enter and Space activate it", () => {
    render(<InviteLink link="http://x/s/abc" />);
    const btn = screen.getByRole("button", { name: "Copy link" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("falls back to showing the link when the clipboard is refused", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<InviteLink link="http://x/s/abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not copy");
  });
});
