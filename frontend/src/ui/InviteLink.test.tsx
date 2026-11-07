// Spec 015 task 37 (FR-12): the invite link with an always-visible copy button and a toast.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteLink } from "./InviteLink";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InviteLink", () => {
  it("shows the link and a Copy invite link button without any interaction", () => {
    render(<InviteLink link="http://x/games/chess/s/abc" />);
    expect((screen.getByLabelText("Invite link") as HTMLInputElement).value).toBe(
      "http://x/games/chess/s/abc",
    );
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("copies the link and confirms with a toast", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<InviteLink link="http://x/s/abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(writeText).toHaveBeenCalledWith("http://x/s/abc");
    expect((await screen.findByRole("status")).textContent).toContain("Invite link copied");
  });

  it("is a native button, so Enter and Space activate it", () => {
    render(<InviteLink link="http://x/s/abc" />);
    const btn = screen.getByRole("button", { name: "Copy invite link" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("falls back to showing the link when the clipboard is refused", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<InviteLink link="http://x/s/abc" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not copy");
  });
});
