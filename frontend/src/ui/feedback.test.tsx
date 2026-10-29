import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner } from "./Banner";
import { EmptyState } from "./EmptyState";
import { Hud } from "./Hud";
import { InlineMessage } from "./InlineMessage";
import { TextField } from "./TextField";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InlineMessage", () => {
  // AC-4 (component part)
  it("is referenced by its control's aria-describedby", () => {
    render(
      <>
        <TextField label="Signature" value="def f(" onChange={() => {}} describedBy="save-error" />
        <InlineMessage id="save-error" tone="error">
          The signature could not be parsed.
        </InlineMessage>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Signature" });
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids).toContain("save-error");
    expect(document.getElementById("save-error")?.textContent).toMatch(/could not be parsed/);
    expect(screen.getByRole("textbox", { name: "Signature" })).toHaveProperty("value", "def f(");
  });

  it("announces errors as alerts and other messages politely", () => {
    render(
      <>
        <InlineMessage id="a" tone="error">
          bad
        </InlineMessage>
        <InlineMessage id="b" tone="info">
          note
        </InlineMessage>
      </>,
    );
    expect(screen.getByRole("alert").textContent).toMatch("bad");
    expect(screen.getByRole("status").textContent).toMatch("note");
  });
});

describe("Hud", () => {
  // FR-3
  it("shows a status that leaves focus alone and disappears after its timeout", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(
      <>
        <button type="button">Invite</button>
        <Hud message="Invite link copied" timeout={1500} onDone={onDone} />
      </>,
    );
    const invite = screen.getByRole("button", { name: "Invite" });
    invite.focus();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Invite link copied");
    expect(status.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(invite);

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.queryByRole("status")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(onDone).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(invite);
  });

  it("has nothing focusable in it", () => {
    render(<Hud message="Session reactivated" />);
    expect(
      screen.getByRole("status").querySelectorAll("button, a, input, [tabindex]"),
    ).toHaveLength(0);
  });
});

describe("Banner", () => {
  it("shows its message and actions", () => {
    render(
      <Banner tone="warning" actions={<button type="button">Reactivate</button>}>
        This session is stale.
      </Banner>,
    );
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch("This session is stale.");
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(banner.querySelector("svg")).not.toBeNull();
  });
});

describe("EmptyState", () => {
  it("shows an icon, a title, text and an action", () => {
    render(
      <EmptyState
        icon="exclamation"
        title="Page not found"
        action={<a href="/">Back to problems</a>}
      >
        There is nothing at this address.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByText("There is nothing at this address.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to problems" }).getAttribute("href")).toBe("/");
  });
});
