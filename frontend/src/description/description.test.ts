import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  imageReferenceCount,
  imageRefusal,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_DESCRIPTION,
} from "./imageChecks";
import { applyCommand, insertImage, type TextEdit } from "./markdownCommands";

/** Run a command over `before[sel]after`, where the selection is marked by `[` and `]`. */
function run(marked: string, command: Parameters<typeof applyCommand>[0]): TextEdit {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  const value = marked.replace("[", "").replace("]", "");
  return applyCommand(command, value, start, end);
}

const selected = (e: TextEdit) => e.value.slice(e.selectionStart, e.selectionEnd);

describe("markdown commands: inline", () => {
  it("Bold wraps the selection in ** and keeps it selected", () => {
    const e = run("say [x] now", "bold");
    expect(e.value).toBe("say **x** now");
    expect(selected(e)).toBe("x");
  });

  it("Italic wraps the selection in *", () => {
    expect(run("[word]", "italic").value).toBe("*word*");
  });

  it("Inline code wraps the selection in backticks", () => {
    expect(run("call [f(x)] here", "inlineCode").value).toBe("call `f(x)` here");
  });

  it("Inline code around text with a backtick uses a longer fence", () => {
    expect(run("[a`b]", "inlineCode").value).toBe("`` a`b ``");
  });

  it("Link makes the selection the link text and selects the URL to type", () => {
    const e = run("see [the docs].", "link");
    expect(e.value).toBe("see [the docs](https://).");
    expect(selected(e)).toBe("https://");
  });

  it("with nothing selected, inserts a selected placeholder", () => {
    const e = run("a [] b", "bold");
    expect(e.value).toBe("a **bold text** b");
    expect(selected(e)).toBe("bold text");
  });
});

describe("markdown commands: lines", () => {
  it("Heading prefixes the cursor's line with ##", () => {
    const e = run("intro\nTa[]sk\nmore", "heading");
    expect(e.value).toBe("intro\n## Task\nmore");
    expect(selected(e)).toBe("## Task");
  });

  it("Bulleted list prefixes every selected line with -", () => {
    expect(run("[one\ntwo]", "bulletedList").value).toBe("- one\n- two");
  });

  it("Numbered list numbers every selected line 1., 2.", () => {
    const e = run("before\n[first\nsecond]\nafter", "numberedList");
    expect(e.value).toBe("before\n1. first\n2. second\nafter");
    expect(selected(e)).toBe("1. first\n2. second");
  });

  it("a selection ending at a line break does not take in the next line", () => {
    expect(run("[one\n]two", "bulletedList").value).toBe("- one\ntwo");
  });

  it("Code block fences the selection on its own lines", () => {
    const e = run("text [x = 1\ny = 2] tail", "codeBlock");
    expect(e.value).toBe("text \n```\nx = 1\ny = 2\n```\n tail");
    expect(selected(e)).toBe("x = 1\ny = 2");
  });

  it("Code block on whole lines adds no extra blank lines", () => {
    expect(run("a\n[code]\nb", "codeBlock").value).toBe("a\n```\ncode\n```\nb");
  });
});

describe("insertImage", () => {
  it("inserts the reference at the cursor and leaves the rest unchanged", () => {
    const value = "First paragraph.\n\nSecond.";
    const at = value.indexOf("Second.");
    const e = insertImage(value, at, at, "abc-123", "diagram");
    expect(e.value).toBe("First paragraph.\n\n![diagram](/api/images/abc-123)Second.");
    expect(e.selectionStart).toBe(e.selectionEnd);
    expect(e.value.slice(0, e.selectionStart)).toBe(
      "First paragraph.\n\n![diagram](/api/images/abc-123)",
    );
  });

  it("does not remove selected text", () => {
    const e = insertImage("keep me", 0, 4, "id1", "a");
    expect(e.value).toBe("keep![a](/api/images/id1) me");
  });

  it("escapes brackets in the alt text", () => {
    expect(insertImage("", 0, 0, "id1", "a [b]").value).toBe("![a \\[b\\]](/api/images/id1)");
  });
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const withImages = (n: number) =>
  Array.from({ length: n }, (_, i) => `![i${i}](/api/images/${uuid(i)})`).join("\n\n");

describe("image pre-checks", () => {
  it("accepts PNG, JPEG, GIF and WebP up to 2 MB, and up to 10 images", () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_IMAGES_PER_DESCRIPTION).toBe(10);
    expect(imageRefusal({ type: "image/webp", size: MAX_IMAGE_BYTES }, withImages(9))).toBeNull();
  });

  it("FR4: a 3 MB image is refused with a message naming 2 MB", () => {
    const refusal = imageRefusal({ type: "image/png", size: 3 * 1024 * 1024 }, "");
    expect(refusal?.code).toBe("image_too_large");
    expect(refusal?.message).toContain("2 MB");
  });

  it("FR4: a PDF is refused with a message listing the accepted formats", () => {
    const refusal = imageRefusal({ type: "application/pdf", size: 1000 }, "");
    expect(refusal?.code).toBe("image_format");
    for (const name of ["PNG", "JPEG", "GIF", "WebP"]) expect(refusal?.message).toContain(name);
  });

  it("FR4: an 11th image is refused with a message stating the limit of 10", () => {
    const refusal = imageRefusal({ type: "image/png", size: 1000 }, withImages(10));
    expect(refusal?.code).toBe("too_many_images");
    expect(refusal?.message).toContain("10");
  });

  it("counts distinct image references only", () => {
    const source = `${withImages(3)}\n\n![again](/api/images/${uuid(0)})\n\n![x](https://e.com/a.png)`;
    expect(imageReferenceCount(source)).toBe(3);
    expect(imageReferenceCount("no images")).toBe(0);
  });
});
