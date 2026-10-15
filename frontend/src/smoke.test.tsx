import { render, screen } from "@testing-library/react";
import { Shell } from "./main";

test("shell renders the app title", () => {
  render(<Shell />);
  expect(screen.getByRole("heading", { name: "Collaborative coding" })).toBeTruthy();
});
