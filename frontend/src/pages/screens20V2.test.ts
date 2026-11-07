import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spec 016 task 20 (FR-9, FR-1): the session editor, run output and scratch run use the v2
// tokens only: no literal colour, radius or duration, and rounded surfaces take radius tokens.

const read = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");
const files = {
  session: read("pages/SessionWindow.module.css"),
  run: read("components/RunPanel.module.css"),
  scratch: read("scratch/ScratchPanel.module.css"),
};

describe("session, run and scratch styles (v2)", () => {
  for (const [name, css] of Object.entries(files)) {
    it(`${name}: no literal colour, radius, duration or square radius`, () => {
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
      expect(css).not.toMatch(/border-radius\s*:\s*[^;]*\b\d+(\.\d+)?(px|rem|em|%)/);
      expect(css).not.toMatch(/(?<![\w.-])\d+\.?\d*m?s\b/);
      expect(css).not.toMatch(/--radius-0\b/);
      expect(css).not.toMatch(/ui-monospace/);
    });
  }

  it("join card is a v2 card, inputs and output blocks use radius tokens", () => {
    expect(files.session).toMatch(/\.joinCard[^}]*var\(--radius-card\)/s);
    expect(files.session).toMatch(/\.inviteInput[^}]*var\(--radius-md\)/s);
    expect(files.run).toMatch(/\.accepted[^}]*var\(--radius-pill\)/s);
    expect(files.run).toMatch(/\.traceback[^}]*var\(--radius-md\)/s);
    expect(files.scratch).toMatch(/\.output[^}]*var\(--radius-md\)/s);
  });
});
