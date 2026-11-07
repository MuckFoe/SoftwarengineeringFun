import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodePreview } from "./CodePreview";

afterEach(cleanup);

describe("CodePreview", () => {
  it("FR-4: renders excerpt inert", () => {
    const { container } = render(<CodePreview excerpt={"def f():\n    return 1"} />);
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre.textContent).toBe("def f():\n    return 1");
    expect(pre.getAttribute("aria-hidden")).toBe("true");
    expect(pre.getAttribute("tabindex")).toBe("-1");
    expect(container.querySelector("textarea, input, [contenteditable]")).toBeNull();
  });
  it("FR-4: renders nothing for empty or null", () => {
    for (const e of ["", null, undefined, "  \n "]) {
      const { container, unmount } = render(<CodePreview excerpt={e} />);
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });
});
