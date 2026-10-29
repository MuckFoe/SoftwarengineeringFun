import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BottomPanel, Inspector } from "./Panels";
import { Sidebar, SidebarSection } from "./Sidebar";
import { Window } from "./Window";

afterEach(cleanup);

function Layout({ sidebarOpen = true, bottomOpen = true, inspectorOpen = false }) {
  return (
    <Window
      toolbar={<div role="toolbar" aria-label="Session" />}
      sidebarOpen={sidebarOpen}
      sidebar={
        <Sidebar label="Session sidebar">
          <SidebarSection title="Problems">
            <p>p1</p>
          </SidebarSection>
          <SidebarSection title="Participants">
            <p>Ada</p>
          </SidebarSection>
        </Sidebar>
      }
      inspector={
        <Inspector open={inspectorOpen} label="Inspector">
          <p>description</p>
        </Inspector>
      }
      bottomPanel={
        <BottomPanel open={bottomOpen} label="Run results">
          <p>3 of 3 passed</p>
        </BottomPanel>
      }
    >
      <p>editor</p>
    </Window>
  );
}

describe("Window", () => {
  it("lays out toolbar, sidebar, main, inspector and bottom panel as landmarks", () => {
    render(<Layout inspectorOpen />);
    expect(screen.getByRole("toolbar", { name: "Session" })).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain("editor");
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
  });

  it("hides the sidebar from the accessibility tree when closed", () => {
    const { rerender } = render(<Layout />);
    expect(screen.getByRole("navigation", { name: "Session sidebar" })).toBeTruthy();
    rerender(<Layout sidebarOpen={false} />);
    expect(screen.queryByRole("navigation", { name: "Session sidebar" })).toBeNull();
  });
});

describe("Sidebar", () => {
  // AC-11 (component part)
  it("is a navigation landmark whose sections are labelled regions", () => {
    render(<Layout />);
    const nav = screen.getByRole("navigation", { name: "Session sidebar" });
    expect(nav.className).toMatch(/material/);
    expect(screen.getByRole("region", { name: "Problems" }).textContent).toContain("p1");
    expect(screen.getByRole("region", { name: "Participants" }).textContent).toContain("Ada");
  });
});

describe("BottomPanel", () => {
  // AC-11 (component part)
  it("can be hidden and shown again", () => {
    const { rerender } = render(<Layout bottomOpen />);
    expect(screen.getByRole("region", { name: "Run results" }).textContent).toContain("passed");

    rerender(<Layout bottomOpen={false} />);
    expect(screen.queryByRole("region", { name: "Run results" })).toBeNull();
    expect(screen.queryByText("3 of 3 passed")).not.toBeNull(); // kept mounted, so it can animate

    rerender(<Layout bottomOpen />);
    expect(screen.getByRole("region", { name: "Run results" })).toBeTruthy();
  });

  it("is inert while hidden, so nothing in it takes focus", () => {
    render(<Layout bottomOpen={false} />);
    const panel = screen.getByText("3 of 3 passed").closest("section");
    expect(panel?.hasAttribute("inert")).toBe(true);
    expect(panel?.className).toMatch(/motion-collapse/);
  });
});

describe("Inspector", () => {
  it("can be hidden and shown again", () => {
    const { rerender } = render(<Layout inspectorOpen />);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
    rerender(<Layout inspectorOpen={false} />);
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
  });
});
