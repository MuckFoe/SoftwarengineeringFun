import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GifResult } from "../../api/types";
import { GifImage } from "./GifImage";

const gif: GifResult = {
  id: "abc123",
  title: "Happy dance",
  url: "https://media.giphy.com/media/abc123/200w.gif",
  still_url: "https://media.giphy.com/media/abc123/200w_s.gif",
  width: 200,
  height: 150,
};

afterEach(cleanup);

describe("GifImage", () => {
  it("FR-10: announces the GIF's title", () => {
    render(<GifImage gif={gif} />);
    expect(screen.getByRole("img", { name: "Happy dance" })).toBeTruthy();
  });

  it('FR-10: announces "GIF" when the title is empty', () => {
    render(<GifImage gif={{ ...gif, title: "" }} />);
    expect(screen.getByRole("img", { name: "GIF" })).toBeTruthy();
  });

  it("NFR-1: loads media without sending a referrer", () => {
    render(<GifImage gif={gif} />);
    const img = screen.getByRole("img", { name: "Happy dance" });
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("src")).toBe(gif.url);
  });

  it("has explicit width and height so a late load doesn't shift the chat", () => {
    render(<GifImage gif={gif} />);
    const img = screen.getByRole("img", { name: "Happy dance" });
    expect(img.getAttribute("width")).toBe("200");
    expect(img.getAttribute("height")).toBe("150");
  });

  it("NFR-6: the reduced-motion source carries the still URL", () => {
    const { container } = render(<GifImage gif={gif} />);
    const source = container.querySelector("picture > source");
    expect(source?.getAttribute("media")).toBe("(prefers-reduced-motion: reduce)");
    expect(source?.getAttribute("srcset")).toBe(gif.still_url);
  });

  it('FR-12: a failed load shows "GIF no longer available" at the same size', () => {
    const { container } = render(<GifImage gif={gif} />);
    fireEvent.error(screen.getByRole("img", { name: "Happy dance" }));
    const placeholder = screen.getByText("GIF no longer available");
    expect(placeholder).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(placeholder.style.width).toBe("200px");
    expect(placeholder.style.height).toBe("150px");
  });
});
