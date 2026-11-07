import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 016 task 25 (FR-9, FR-1): problems, profile and not-found styles take the v2 tokens:
// card-radius tables on a surface, pill link-buttons, motion tokens, and no hard-edged
// spec-015 radius. Source-level, like the guard tests.
const css = (f: string) => readFileSync(join(process.cwd(), "src/pages", f), "utf8");

describe("v2 screens: problems, profile, not found (FR-9)", () => {
  it("problems table is a card-radius surface", () => {
    const t = css("ProblemsWindow.module.css");
    expect(t).toMatch(/\.table\s*\{[^}]*var\(--radius-card\)/);
    expect(t).toMatch(/\.table\s*\{[^}]*background:\s*var\(--surface\)/);
    expect(t).toMatch(/\.table tbody tr\s*\{[^}]*transition:[^;}]*var\(--motion-fast\)/);
  });

  it("profile link-buttons are pills on motion tokens, with the v2 focus ring", () => {
    const t = css("ProfileWindow.module.css");
    expect(t).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(t).not.toMatch(/--radius-0|--dur-|--ease-audi/);
    expect(t).toMatch(/var\(--motion-fast\)/);
    expect(t).toMatch(/\.action:first-child\s*\{[^}]*box-shadow:\s*var\(--glow\)/);
  });

  it("not-found link and profile sessions table use v2 tokens", () => {
    const n = css("NotFound.module.css");
    expect(n).toMatch(/\.link\s*\{[^}]*color:\s*var\(--accent\)/);
    expect(n).not.toMatch(/--radius-0|--action-primary-fill/);
    expect(n).toMatch(/var\(--motion-fast\)/);
    const s = css("ProfileSessions.module.css");
    expect(s).toMatch(/\.table\s*\{[^}]*var\(--radius-card\)/);
    expect(s).toMatch(/\.table\s*\{[^}]*background:\s*var\(--surface\)/);
  });

  it("problem editor sheet alert is a card-radius surface on v2 tokens", () => {
    const t = css("ProblemEditorSheet.module.css");
    expect(t).toMatch(/\.alert\s*\{[^}]*border-radius:\s*var\(--radius-card\)/);
    expect(t).toMatch(/\.alert\s*\{[^}]*background:\s*var\(--surface\)/);
    expect(t).toMatch(/\.alert\s*\{[^}]*color:\s*var\(--text\)/);
    expect(t).toMatch(/\.alertText\s*\{[^}]*color:\s*var\(--text-muted\)/);
    expect(t).not.toMatch(/--radius-0|--surface-1|--text-interactive|--form-caption/);
  });
});
