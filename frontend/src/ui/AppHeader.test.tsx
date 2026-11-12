import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../shortcuts/useShortcut";
import { AppHeader } from "./AppHeader";
import css from "./appHeader.css?raw";

const live = vi.hoisted(() => ({ value: false }));
vi.mock("../pages/useAnyLive", () => ({ useAnyLive: () => live.value }));

afterEach(() => {
  cleanup();
  live.value = false;
});

const renderHeader = (path = "/learn/x") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ShortcutsProvider>
        <AppHeader appName="Collab" label="Header">
          <button type="button">Extra</button>
        </AppHeader>
      </ShortcutsProvider>
    </MemoryRouter>,
  );

describe("AppHeader (FR-6, FR-7, FR-11)", () => {
  it("is a banner-free toolbar holding the name, page controls, appearance and account (areas moved to the dock)", () => {
    renderHeader();
    expect(screen.getByRole("toolbar", { name: "Header" })).toBeTruthy();
    expect(screen.getByText("Collab").classList.contains("brand-name")).toBe(true);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: "Areas" })).toBeNull();
    expect(screen.getByRole("button", { name: "Extra" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /jump to anything/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /appearance/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /profile/i })).toBeTruthy();
  });

  it("with stackNarrow, is-stacked puts the screen's controls on a second row at narrow width", () => {
    const { container, unmount } = render(
      <MemoryRouter>
        <ShortcutsProvider>
          <AppHeader label="Header" stackNarrow>
            <button type="button">Extra</button>
          </AppHeader>
        </ShortcutsProvider>
      </MemoryRouter>,
    );
    expect(container.querySelector(".app-header")?.classList.contains("is-stacked")).toBe(true);
    unmount();
    const plain = renderHeader();
    expect(plain.container.querySelector(".app-header")?.classList.contains("is-stacked")).toBe(
      false,
    );
    const narrow = css.match(/@media \(max-width: 40rem\)\s*\{[^@]*\.app-header\.is-stacked[^@]*/g);
    const block = narrow?.join("\n") ?? "";
    expect(block).toMatch(/\.app-header\.is-stacked\s*\{[^}]*height:\s*auto/);
    expect(block).toMatch(/\.app-header\.is-stacked \.app-header-start\s*\{[^}]*flex:\s*1 1 100%/);
  });

  it("is 56 px tall with page-margin padding, and uses tokens only", () => {
    expect(css).toMatch(/height:\s*56px|height:\s*var\(--space-56\)/);
    expect(css).toMatch(/padding:[^;]*var\(--page-margin\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(css).not.toMatch(/--legacy-/);
  });
});

describe("AppHeader vent texture and light line (016 FR-2, FR-3)", () => {
  const rule = (sel: string) => {
    const m = css.match(new RegExp(`${sel.replace(/[.\\[\\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : "";
  };

  it("has is-live and a light line when something is live; static otherwise", () => {
    live.value = true;
    const { container, unmount } = renderHeader();
    expect(container.querySelector(".app-header")?.classList.contains("is-live")).toBe(true);
    expect(container.querySelector(".app-header-line .app-header-sweep")).toBeTruthy();
    unmount();
    live.value = false;
    const r = renderHeader();
    expect(r.container.querySelector(".app-header")?.classList.contains("is-live")).toBe(false);
    expect(r.container.querySelector(".app-header-line")).toBeTruthy();
  });

  it("animates the sweep only when live, and never under reduced motion", () => {
    expect(rule(".app-header-sweep")).toMatch(/animation-name:\s*none|animation:\s*none/);
    expect(rule(".app-header.is-live .app-header-sweep")).toMatch(/animation:\s*[a-z-]*sweep/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.app-header[^{]*\{[^}]*animation:\s*none/,
    );
  });

  it("fades a static vent texture with a gradient mask-image", () => {
    const r = rule(".app-header::before");
    expect(r).toMatch(/repeating-linear-gradient/);
    expect(r).toMatch(/mask-image:[^;]*gradient/);
    expect(r).not.toMatch(/animation/);
  });

  it("keyframes animate only transform", () => {
    const frames = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})+\s*\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.every((p) => p === "transform")).toBe(true);
    }
  });
});
