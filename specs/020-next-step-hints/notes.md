# 020 next-step hints: notes

## Drift

- 2026-11-12, task 18: the look matrix's narrow (390 px) "session hint*" entries surfaced two pre-existing defects of the coding session window, also present in a plain guest session without hints. Both were fixed outside 020's declared files, with the user's approval:
  - Toolbar overflow at 390 px ("Hide inspector" and "Hide chat" past the right edge, Run and Invite squashed). `AppHeader` got a `stackNarrow` option: at narrow width the screen's own controls take a second header row as 36 px icons (Run and Invite keep their text for screen readers), and the session window uses it. At narrow width the session sidebar now also starts closed, since it covered most of the editor.
  - axe `scrollable-region-focusable` on `.cm-scroller`: the editor content now carries `tabindex="0"` (and its "Code" name) in the live and the stale read-only editor, so the scroll area holds a tab stop; an editable content was in the tab order already, so no stop is added there.
  - Files: `frontend/src/ui/AppHeader.tsx`, `frontend/src/ui/appHeader.css`, `frontend/src/ui/AppHeader.test.tsx`, `frontend/src/components/CodeEditor.tsx`, `frontend/src/pages/SessionWindow.tsx`, `frontend/src/pages/SessionWindow.test.tsx`.

## Found during implementation (for /sdd-validate)

- **Runner concurrency (task 8):** the runner's `ThreadingHTTPServer` drops connections at about 20 simultaneous runs, so plan.md's "run all ~18 concurrently" isn't literally possible. The guard sweep test runs at most two problems at a time. A real hint sends at most 3 candidates. Also, only easy seed problems have one-line reference bodies, so medium and hard problems check only their full reference.
- **Focus after sending a note (task 17):** focus sometimes doesn't return to "Hint" after a note is sent (about 1 run in 6), probably because Hint is disabled while the hint is prepared. AC-16 doesn't strictly require it; it is a small keyboard gap in `HintsPanel.tsx`.
- **Cold-state race in E2E (tasks 17, 18):** `POST /cold` on the fake is one-shot, and any hint request from the parallel Playwright project can use it up. The warming-up matrix entry retries up to 3 times, and `hints.spec.ts` runs in the serial giphy project.
- **Pending states held in the look matrix (task 18):** the preparing and warming-up entries drop `hint_failed` with `page.routeWebSocket`, so the state stays on screen for checks at three widths. plan.md instead describes capturing within the roughly 6 s window.
- **Narrow layout:** after the 390 px fix the editor is only about 70 px wide, because the inspector and chat take the rest of the screen. The look checks pass, but it is barely usable on a phone. That is a follow-up beyond 020. At 1280 px the session toolbar is cramped (Run's label spills out), which predates 020.
- **Existing tests that hints touched:** the batched gate needed `test_schema.py` (migration list), `test_secrecy.py` (sweep of the new hints route), `test_ws_presence.py` (`hint_llm` on its stand-in app) and `descriptions.spec.ts` (the hints panel's live region sits inside the Description region).
- **Gate durations:** pytest 308 s, vitest 20 s, Playwright 93 s, about 7 min in total.

## Production, 2026-11-12: hints withheld

- **Symptom:** in production every hint on an easy problem said "No hint could be given this time".
- **Cause:** with "at most one line of code" in the system message, qwen3.6:35b answered with the one-line solution (e.g. `return sorted(set(a) & set(b))`). The guard ran it, it passed every test, and the hint was withheld: 0 of 6 shown. The guard behaved as specified.
- **Fix:**
  - The system message now forbids solving code, even a one-liner, and asks for at most one fragment and no `return` statement.
  - The guard no longer counts backticked bare names toward the one code line, but still test-runs every fragment.
- **Result:** 17 of 20 hints shown across five starter problems. The 3 withheld answers listed four fragments that spell out the whole recipe, which FR-9 forbids.
