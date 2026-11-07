import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APPEARANCES, evaluatePair, PAIRS, THRESHOLD } from "../styles/contrast";
import { ChatBubble } from "./ChatBubble";
import raw from "./chat.css?raw";
import { ListItem } from "./ListItem";

// Spec 015 task 21: Audi chat bubble and list row (plan 1.7).
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
function rule(selector: string): string {
  const esc = selector.replace(/[.[\]="()-]/g, "\\$&");
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1]!;
}

describe("ChatBubble", () => {
  it("renders author, time and unchanged children", () => {
    render(
      <ChatBubble author="Ada" time="10:42" own={false}>
        <a href="https://x.test">link</a>
      </ChatBubble>,
    );
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("10:42")).toBeTruthy();
    expect(screen.getByRole("link", { name: "link" }).getAttribute("href")).toBe("https://x.test");
  });

  it("marks own vs other", () => {
    const { container, rerender } = render(<ChatBubble author="A" time="1" own={false} />);
    expect(container.firstElementChild?.getAttribute("data-own")).toBe("false");
    rerender(<ChatBubble author="A" time="1" own />);
    expect(container.firstElementChild?.getAttribute("data-own")).toBe("true");
  });

  it("other: neutral-700 fill, text colour, radius 0", () => {
    const r = rule(".chat-bubble");
    expect(r).toMatch(/background:\s*var\(--neutral-700\)/);
    expect(r).toMatch(/color:\s*var\(--text\)/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-0\)|border-radius:\s*0\b/);
  });

  it("own: primary fill and text", () => {
    const r = rule('.chat-bubble[data-own="true"]');
    expect(r).toMatch(/background:\s*var\(--action-primary-fill\)/);
    expect(r).toMatch(/color:\s*var\(--action-primary-text\)/);
  });

  it("has no tail and time uses form caption", () => {
    expect(css).not.toMatch(/::before|::after|clip-path/);
    expect(rule(".chat-bubble__time")).toMatch(/var\(--form-caption\)/);
  });

  it("both bubble pairs are in the contrast list and pass", () => {
    for (const name of ["chat bubble other", "chat bubble own"]) {
      const p = PAIRS.find((x) => x.name === name);
      expect(p, name).toBeTruthy();
      for (const a of APPEARANCES) {
        expect(evaluatePair(p!, a).ratio).toBeGreaterThanOrEqual(THRESHOLD[p!.kind]);
      }
    }
  });
});

describe("ListItem", () => {
  it("renders children as a list item", () => {
    render(
      <ul>
        <ListItem>Row</ListItem>
      </ul>,
    );
    expect(screen.getByRole("listitem").textContent).toBe("Row");
  });

  it("rows have 1px divider, hover neutral-700, no radius", () => {
    const r = rule(".list-item");
    expect(r).toMatch(/border-bottom:\s*1px solid var\(--divider\)/);
    expect(r).not.toMatch(/border-radius:\s*[1-9]/);
    expect(rule(".list-item:hover")).toMatch(/background:\s*var\(--neutral-700\)/);
  });
});
