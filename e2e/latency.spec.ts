// Spec 003 AC-23 / NFR-5: live collaboration is no slower than before the redesign.
// Two participants in one session; one makes single-character edits, one at a time, and
// the other's editor is watched for each. A round is 50 edits and yields one p95; the
// median of 5 rounds' p95 must stay within 10 % of the pre-redesign baseline recorded in
// specs/003-apple-style-ui-overhaul/notes.md. (A single round's p95 varies by ±20 % on
// identical code, so one round alone can't hold a 10 % bound.)
//
// Only `.cm-content` (CodeMirror's own class) and the join form's label/role are used,
// so the same file runs on the pre-redesign tree (to take the baseline) and the new UI.
//   Baseline: LATENCY_RECORD=1 npx playwright test latency   (prints the result, asserts nothing)
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, openContexts, test } from "./fixtures";

const PROBLEM_TITLE = "Sum Two Numbers";
const EDITS_PER_ROUND = 50;
const ROUNDS = 5;
const EDITS = EDITS_PER_ROUND * ROUNDS;
const MARKER = "#lat:";
const NOTES = path.join(
  import.meta.dirname,
  "..",
  "specs",
  "003-apple-style-ui-overhaul",
  "notes.md",
);

async function createSession(request: APIRequestContext): Promise<string> {
  const found = await request.get(`/api/problems?q=${encodeURIComponent(PROBLEM_TITLE)}`);
  expect(found.ok()).toBe(true);
  const problems = (await found.json()) as Array<{ id: string; title: string }>;
  const problem = problems.find((p) => p.title === PROBLEM_TITLE);
  if (!problem) throw new Error(`no seeded problem titled ${PROBLEM_TITLE}`);
  const created = await request.post("/api/sessions", { data: { problem_id: problem.id } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { invite_id: string }).invite_id;
}

async function join(page: Page, invite: string, name: string): Promise<void> {
  await page.goto(`/s/${invite}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator(".cm-content")).toContainText("pass");
}

// Browser-side (strings: this package's tsconfig has no DOM lib). Both pages run in the
// same browser on the same machine, so `performance.timeOrigin + performance.now()` is a
// shared high-resolution clock.

/** Typist: record when each key goes down, before the editor handles it. */
const RECORD_KEYDOWNS = `() => {
  window.__keydowns = [];
  window.addEventListener("keydown", (e) => {
    if (e.key === "x") window.__keydowns.push(performance.timeOrigin + performance.now());
  }, true);
}`;

/** Watcher: record when the marker line first holds each new number of x's. */
const RECORD_ARRIVALS = `() => {
  window.__arrivals = [];
  const content = document.querySelector(".cm-content");
  const count = () => {
    for (const line of content.querySelectorAll(".cm-line")) {
      const text = line.textContent ?? "";
      const at = text.indexOf(${JSON.stringify(MARKER)});
      if (at >= 0) return (text.slice(at + ${MARKER.length}).match(/^x*/) ?? [""])[0].length;
    }
    return 0;
  };
  new MutationObserver(() => {
    const now = performance.timeOrigin + performance.now();
    const n = count();
    while (window.__arrivals.length < n) window.__arrivals.push(now);
  }).observe(content, { childList: true, subtree: true, characterData: true });
}`;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

/** ROUNDS is odd, so the median is the middle value. */
function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function baselineP95(): number {
  const line = /AC-23 baseline median p95:\s*([\d.]+)\s*ms/.exec(readFileSync(NOTES, "utf-8"));
  if (!line?.[1]) throw new Error(`no "AC-23 baseline median p95: <n> ms" line in ${NOTES}`);
  return Number(line[1]);
}

test("AC-23: median p95 edit propagation is within 10 % of the pre-redesign baseline", async ({
  browser,
  request,
  browserName,
}) => {
  const invite = await createSession(request);
  const [typistContext, watcherContext] = await openContexts(browser, 2);
  if (!typistContext || !watcherContext) throw new Error("could not open two browser contexts");
  try {
    const typist = await typistContext.newPage();
    const watcher = await watcherContext.newPage();
    await join(typist, invite, "Typist");
    await join(watcher, invite, "Watcher");

    // A fresh line at the end of the code that holds only the marker and the x's.
    await typist.locator(".cm-content").click();
    await typist.keyboard.press("ControlOrMeta+End");
    await typist.keyboard.press("Enter");
    await typist.keyboard.type(MARKER);
    await expect(watcher.locator(".cm-content")).toContainText(MARKER);

    await typist.evaluate(`(${RECORD_KEYDOWNS})()`);
    await watcher.evaluate(`(${RECORD_ARRIVALS})()`);

    for (let i = 1; i <= EDITS; i++) {
      await typist.keyboard.press("x");
      await watcher.waitForFunction(`window.__arrivals.length >= ${i}`, null, { polling: "raf" });
    }

    const sent = (await typist.evaluate("window.__keydowns")) as number[];
    const seen = (await watcher.evaluate("window.__arrivals")) as number[];
    expect(sent).toHaveLength(EDITS);
    const latencies = seen.slice(0, EDITS).map((t, i) => t - (sent[i] ?? Number.NaN));
    const rounds = Array.from({ length: ROUNDS }, (_, r) =>
      p95(latencies.slice(r * EDITS_PER_ROUND, (r + 1) * EDITS_PER_ROUND)),
    );
    const measured = median(rounds);
    console.log(
      `AC-23 ${browserName}: median p95 ${measured.toFixed(2)} ms ` +
        `(rounds: ${rounds.map((x) => x.toFixed(2)).join(", ")} ms; ${EDITS_PER_ROUND} edits each)`,
    );

    if (process.env.LATENCY_RECORD) return;
    expect(measured).toBeLessThanOrEqual(baselineP95() * 1.1);
  } finally {
    await typistContext.close();
    await watcherContext.close();
  }
});
