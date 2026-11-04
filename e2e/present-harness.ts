// Spec 013 task 8: a parent page and a presentation frame for exercising bridge.js in real
// Chromium without the app stack. Frames are built by the backend's own code
// (app.present.html_check.analyze, then app.present.frame.build_frame, run through `uv`),
// so the injection, the slide-hiding CSS and FRAME_HEADERS are exactly what the app serves.
// Both documents are served with page.route on fake origins; nothing leaves the browser.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";

const BACKEND = path.resolve(import.meta.dirname, "..", "backend");
export const FIXTURES = path.join(BACKEND, "tests", "fixtures", "presentations");

const PARENT_URL = "http://parent.sdd.test/";
const FRAME_URL = "http://frame.sdd.test/frame";

export type Anchor = { path: number[]; fx: number; fy: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Message = { sdd: string; [key: string]: unknown };

export type BuiltFrame = {
  kind: "slides" | "page";
  slideCount: number;
  frame: string;
};
export type Built = {
  headers: Record<string, string>;
  docs: Record<string, BuiltFrame>;
};

const BUILD_SCRIPT = `
import json, sys
from app.present.frame import FRAME_HEADERS, build_frame
from app.present.html_check import analyze
docs = {}
for name, doc in json.load(sys.stdin).items():
    a = analyze(doc["html"].encode("utf-8"))
    docs[name] = {"kind": a.kind, "slideCount": a.slide_count,
                  "frame": build_frame(a.html, a.kind, doc.get("slide"))}
json.dump({"headers": FRAME_HEADERS, "docs": docs}, sys.stdout)
`;

/** Analyzes and builds each document with the backend's Python, keyed by the given name. */
export function buildFrames(docs: Record<string, { html: string; slide?: number | null }>): Built {
  const out = execFileSync("uv", ["run", "--quiet", "python", "-c", BUILD_SCRIPT], {
    cwd: BACKEND,
    input: JSON.stringify(docs),
    encoding: "utf-8",
  });
  return JSON.parse(out) as Built;
}

export function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf-8");
}

export type Harness = {
  frame: Frame;
  /** Every message the iframe posted to the parent, in order. */
  messages: () => Promise<Message[]>;
  /** Posts `msg` from the parent window to the iframe. */
  send: (msg: Message) => Promise<void>;
  /** Waits for a message of type `sdd` (and, if given, with `req`) and returns it. */
  waitFor: (sdd: string, req?: number) => Promise<Message>;
  /** Sends a request-style message and waits for its reply of type `reply`. */
  request: (msg: Message, reply: string) => Promise<Message>;
};

type Options = {
  hash?: string;
  /** The iframe's size; defaults to the page viewport. */
  width?: number;
  height?: number;
};

let nextReq = 1;

/** Serves a parent page holding `frameHtml` in a sandboxed iframe and waits for `ready`. */
export async function openHarness(
  page: Page,
  built: Built,
  name: string,
  options: Options = {},
): Promise<Harness> {
  const doc = built.docs[name];
  if (!doc) throw new Error(`no built document ${name}`);
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const width = options.width ?? viewport.width;
  const height = options.height ?? viewport.height;
  const src = FRAME_URL + (options.hash ?? "");
  const parent = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
<iframe id="f" title="presentation" sandbox="allow-scripts"
  style="border:0;display:block;width:${width}px;height:${height}px"></iframe>
<script>
  window.__msgs = [];
  const f = document.getElementById("f");
  addEventListener("message", (e) => { if (e.source === f.contentWindow) window.__msgs.push(e.data); });
  window.__send = (m) => f.contentWindow.postMessage(m, "*");
  f.src = ${JSON.stringify(src)};
</script>
</body></html>`;

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === PARENT_URL) {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: parent,
      });
    }
    if (url.split("#")[0] === FRAME_URL) {
      return route.fulfill({
        status: 200,
        headers: {
          ...built.headers,
          "Content-Type": "text/html; charset=utf-8",
        },
        body: doc.frame,
      });
    }
    return route.abort();
  });
  await page.goto(PARENT_URL);

  const messages = () => page.evaluate(() => (window as unknown as { __msgs: Message[] }).__msgs);
  const waitFor = async (sdd: string, req?: number): Promise<Message> => {
    const handle = await page.waitForFunction(
      ([type, id]) =>
        (window as unknown as { __msgs: Message[] }).__msgs.find(
          (m) => m && m.sdd === type && (id === null || m.req === id),
        ),
      [sdd, req ?? null] as const,
    );
    return (await handle.jsonValue()) as Message;
  };
  const send = (msg: Message) =>
    page.evaluate((m) => (window as unknown as { __send: (m: Message) => void }).__send(m), msg);
  const request = async (msg: Message, reply: string): Promise<Message> => {
    const req = nextReq++;
    await send({ ...msg, req });
    return waitFor(reply, req);
  };

  await waitFor("ready");
  const element = await page.locator("#f").elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error("iframe has no frame");
  return { frame, messages, send, waitFor, request };
}

/** Which of the frame's slide marks (by the plan's rule) are displayed. */
export function visibleMarks(frame: Frame): Promise<boolean[]> {
  return frame.evaluate(() => {
    const all = [...document.querySelectorAll("[data-slide]")];
    const top = all.filter((el) => !el.parentElement?.closest("[data-slide]"));
    const marks = top.length ? top : [...document.querySelectorAll("body > section")];
    return marks.map((el) => getComputedStyle(el).display !== "none");
  });
}
