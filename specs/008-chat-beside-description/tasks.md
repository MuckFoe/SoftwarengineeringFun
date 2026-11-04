# 008 — Chat always beside the description: tasks

Source: `plan.md` (approved) and `spec.md`. Paths are relative to `frontend/src/` unless they start with `backend/` or `e2e/`. Every task is test-first (constitution 1) and is ticked only when the full suite, lint and `tsc --noEmit` pass (constitution 2, 8).

The plan's "Decisions for the human to confirm" (chat button opens the side area too, 50/50 split with 120/160 px minimums, hidden chat stays mounted, `problem_id` in the stale 423, chat toggle in the stale toolbar, learn sessions untouched, `localStorage["chatVisible"]`) were confirmed by the user on 2026-10-30.

## Waves

| Wave | Tasks | Why this order |
|---|---|---|
| 1 | 1, 2, 3, 4 — all `[P]` | Leaf modules with no dependency on each other: remembered state, the split primitive, the backend 423 field, the client's stale type. Each has its own files. |
| 2 | 5 | `SessionInspector` composes `SplitPane` (task 2). |
| 3 | 6 | Swaps the tabs for `SessionInspector` in the session window; the E2E chat selectors must change in this same task so the suite stays green (plan, constitution compliance 2). It also writes the FR-8, NFR-1 and NFR-2 E2E tests up front, marked expected-to-fail, so tasks 10 and 12 are test-first. |
| 4 | 7 | The chat toggle needs the remembered state (task 1) and the stacked layout (task 6). |
| 5 | 8, 9 — all `[P]` | Stale window (needs 3, 4, 7) and scroll-to-newest on show (needs 7) touch disjoint files. |
| 6 | 10 | Independent scrolling; flips the FR-8 test written in task 6. Shares `e2e/chat-beside-description.spec.ts` with 9, so it runs after it. |
| 7 | 11 | Pointer drag on the divider; shares the same E2E file. |
| 8 | 12 | Flips the NFR-1/NFR-2 tests written in task 6 once the toggle (7) and the divider (11) are in. |

## Checklist

- [x] **1** — `[P]` Remembered chat visibility (`chatVisibility.ts`)
- [x] **2** — `[P]` `SplitPane` primitive: layout, clamp, keyboard divider, collapsible bottom
- [x] **3** — `[P]` Backend: stale 423 body carries `problem_id`
- [x] **4** — `[P]` Client: stale result carries `problemId`
- [x] **5** — `SessionInspector`: Description above Chat in a `SplitPane`
- [x] **6** — Replace the Description/Chat tabs with `SessionInspector`; migrate E2E chat selectors
- [x] **7** — Chat toggle button and `toggleChat` shortcut, remembered per browser
- [x] **8** — `[P]` Stale session shows the description above the read-only chat
- [x] **9** — `[P]` Chat scrolls to its newest message when shown again
- [x] **10** — Description and chat scroll independently, chat input pinned
- [x] **11** — Drag the divider with the pointer
- [x] **12** — Width at 1024 px and keyboard/screen-reader checks

## Tasks

### 1. `[P]` Remembered chat visibility (`chatVisibility.ts`)

- **Plan:** Module layout `components/chatVisibility.ts`; Data model `localStorage["chatVisible"]`; Contracts `chatVisibility.ts`. **Spec:** FR-4.
- **Files:** `components/chatVisibility.ts` (new), `components/chatVisibility.test.ts` (new)
- **Depends on:** nothing
- **Do:** `ChatVisibility`, `CHAT_VISIBILITY_KEY = "chatVisible"`, `loadChatVisibility()` (missing or any value other than `"shown"`/`"hidden"` → `"shown"`), `saveChatVisibility(v)`, and `useChatVisible()` that saves on every set. Read and write wrapped in try/catch like `theme/appearance.ts`; never throws. Imports nothing but React.
- **Acceptance:**
  - *FR-4 — Given a participant hid the chat, When they open the same or another session later in the same browser, Then the chat starts hidden; Given they showed it again, Then it starts visible.* Unit (jsdom's real `localStorage`): `loadChatVisibility` returns `"shown"` with nothing stored; round-trips `"hidden"` and `"shown"`; returns `"shown"` for a junk value; with `window.localStorage` replaced by an object whose methods throw, load returns `"shown"` and save does not throw. Hook: `setVisible(false)` stores `"hidden"`, `setVisible(true)` stores `"shown"`, and a fresh render of the hook starts from the stored value. (The cross-session E2E is in task 7.)

### 2. `[P]` `SplitPane` primitive: layout, clamp, keyboard divider, collapsible bottom

- **Plan:** Module layout `ui/SplitPane.tsx`; Side area layout — *Divider (FR-5)*, *Minimums*, *Independent scrolling*; Contracts `ui/SplitPane.tsx`. **Spec:** FR-2, FR-5, NFR-2.
- **Files:** `ui/SplitPane.tsx` (new), `ui/SplitPane.module.css` (new), `ui/SplitPane.test.tsx` (new)
- **Depends on:** nothing
- **Do:** Vertical split with top / divider / bottom; `topFraction` in component state (default `defaultTopFraction ?? 0.5`); exported pure `clampTop(top, container, minTop, minBottom)` (both minimums kept; container shorter than `minTop + minBottom` → shares proportional to the minimums). Divider is `role="separator"`, `aria-orientation="horizontal"`, `tabIndex={0}`, `aria-label={dividerLabel}`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow=round(topFraction*100)`; ArrowUp/ArrowDown ±16 px, Home → top at `minTop`, End → bottom at `minBottom`. `bottomOpen=false` → only `top` laid out, divider not rendered or not focusable, `bottom` stays mounted at height 0 with `collapsedProps(false)` (aria-hidden + inert). Top and bottom are `min-height: 0; overflow: hidden` flex children. Imports nothing from `api/`, `collab/`, `auth/` or `components/`. Pointer dragging is task 11.
- **Acceptance:**
  - *FR-5 — Given both are visible, When the participant drags the divider up, Then the chat grows and the description shrinks, And neither can be made smaller than its minimum.* Unit: `clampTop` returns `minTop` for values below it, `container − minBottom` for values above that, the value itself in between, and proportional shares (e.g. container 140, mins 120/160 → top 60) when the container is too short.
  - *NFR-2 — Given only a keyboard, When a participant moves through the session window, Then they can reach and activate the chat control and move the divider, …* Component: the divider has role `separator`, the given accessible name and an `aria-valuenow`; it is reachable by Tab; ArrowUp lowers and ArrowDown raises `aria-valuenow`, Home sets it to the minimum share, End to the maximum. (Pixel amounts need a layout engine; the jsdom test asserts direction and the Home/End extremes only, per plan's test strategy.)
  - *FR-2 — Given the chat is visible, When the participant activates "Hide chat", Then the chat is not visible …* Component: with `bottomOpen={false}` the bottom content is still in the DOM but `aria-hidden="true"` and `inert`, and no focusable separator remains.

### 3. `[P]` Backend: stale 423 body carries `problem_id`

- **Plan:** Stale session (FR-9); Contracts `GET /api/sessions/{invite}` 423. **Spec:** FR-9.
- **Files:** `backend/app/sessions/api.py`, `backend/tests/integration/test_sessions_api.py`
- **Depends on:** nothing
- **Do:** In `get_session`, add `"problem_id": str(session.current_problem_id)` to the 423 `detail` dict. Update the two existing tests that assert the exact 423 body (`test_fr30_…` around lines 118 and 134) to include `problem_id`. The learn sessions' 423 (spec 006) is not touched.
- **Acceptance:**
  - *FR-9 — Given a stale session with chat history, When it is opened, Then the history is shown below the description, And no message can be sent.* Integration (real Postgres): a stale `GET /api/sessions/{invite}` returns 423 with body `{"error": "stale", "can_reactivate": <bool>, "problem_id": "<the session's current_problem_id>"}`; 200 and 404 unchanged. `ruff check` and `ruff format --check` clean.

### 4. `[P]` Client: stale result carries `problemId`

- **Plan:** Module layout `api/client.ts, types.ts`; Contracts `SessionStatus`. **Spec:** FR-9.
- **Files:** `api/types.ts`, `api/client.ts`, `api/client.test.ts`
- **Depends on:** nothing (codes against the contract of task 3)
- **Do:** `StaleBody` gains `problem_id: string`; the stale `SessionStatus` / error variant gains `problemId: string`, mapped from `problem_id`.
- **Acceptance:**
  - *FR-9 — Given a stale session …, When it is opened, Then the history is shown below the description …* Extend the existing "maps a 423 to {stale, canReactivate}" test: a 423 `{error: "stale", can_reactivate: true, problem_id: "p-1"}` maps to `{kind: "stale", canReactivate: true, problemId: "p-1"}`. `tsc --noEmit` passes across the frontend (existing callers compile).

### 5. `SessionInspector`: Description above Chat in a `SplitPane`

- **Plan:** Module layout `components/SessionInspector.tsx`; Side area layout; Contracts `SessionInspector`. **Spec:** FR-1, FR-2, FR-8, FR-9, NFR-2.
- **Files:** `components/SessionInspector.tsx` (new), `components/SessionInspector.module.css` (new), `components/SessionInspector.test.tsx` (new)
- **Depends on:** 2
- **Do:** Render `<section aria-label="Description">` (wrapping `DescriptionPane`, `overflow-y: auto`, `overflow-wrap: anywhere`) as `top` and `<section aria-label="Chat">` (wrapping `ChatPane` with the passed `chat` props) as `bottom` of a `SplitPane` with `minTop=120`, `minBottom=160`, `dividerLabel="Resize description and chat"`, `bottomOpen={chatVisible}`. `descriptionHtml === undefined` → the Chat region fills the area alone (no Description region, no divider). Never imports `api/`. Passing `visible` to `ChatPane` is task 9.
- **Acceptance:**
  - *FR-1 — Given a session with a description and chat, When a participant opens it, Then the description and the chat are both visible, the description above the chat, and there is no Description/Chat tab control.* Component: regions "Description" and "Chat" both present, Description before Chat in DOM order, no element with role `tablist`, `tab` or `tabpanel`.
  - *FR-2 — Given the chat is visible, When the participant activates "Hide chat", Then the chat is not visible and the description fills the side area.* Component: `chatVisible={false}` → the Chat region is `aria-hidden` and inert (still mounted), the Description region is not.
  - *FR-9 — Given a stale session with chat history, When it is opened, Then the history is shown below the description, And no message can be sent.* Component: with `chat.readOnly` true the message input is disabled; with `descriptionHtml` undefined only the Chat region is rendered.
  - *NFR-2 — … a screen reader announces separate description and chat regions.* Component: `getByRole("region", { name: "Description" })` and `getByRole("region", { name: "Chat" })` both resolve.

### 6. Replace the Description/Chat tabs with `SessionInspector`; migrate E2E chat selectors

- **Plan:** Module layout `pages/SessionWindow.tsx` (InspectorTabs and InspectorTab removed); Test strategy (existing E2E specs switch to `getByRole("region", { name: "Chat" })`). **Spec:** FR-1.
- **Files:** `pages/SessionWindow.tsx`, `pages/SessionWindow.test.tsx`, `e2e/chat-beside-description.spec.ts` (new); mechanical selector swaps in `e2e/chat.spec.ts`, `e2e/session-002.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/hub-lifecycle.spec.ts`, `e2e/descriptions.spec.ts`
- **Depends on:** 5
- **Do:** Delete `InspectorTabs`, `InspectorTab`, `TAB_LABELS` and the `inspectorTab` state. `JoinedWindow` renders `<SessionInspector descriptionHtml=… chatVisible={true} chat=… />` in the Inspector. `StaleWindow` renders `<SessionInspector descriptionHtml={undefined} chatVisible={true} chat={…readOnly} />` (chat alone, as today; task 8 adds the description). The `toggleChat` shortcut, until task 7, only opens the inspector. In `SessionWindow.test.tsx` replace `tab`/`tabpanel` queries with `region` queries and drop tab clicks; assertions stay. In the five E2E specs replace `getByRole("tab", { name: "Chat" }).click()` (removed) and `getByRole("tabpanel", { name: "Chat" | "Description" })` / `closest('[role="tabpanel"]')` with the `region` equivalents; assertions stay. In the new E2E file add the FR-1 test, and write the FR-8 (task 10), NFR-1 and NFR-2 (task 12) E2E tests now, exactly as their acceptance below states, each marked expected-to-fail with `test.fail(true, "<reason>: until task N")` and shown failing for the right reason. Whichever later task's change makes one of them pass removes its marker in that same task (Playwright reports an unexpected pass of a `test.fail` test as a failure, so the suite stays honest); tasks 10 and 12 at the latest.
- **Note:** This task touches 8 files, over the ~3-file budget; the user approved this size exception on 2026-10-30. The plan requires the selector change in the same task that removes the tabs so the suite never goes red between tasks (constitution 2); the five E2E edits are selector-only. `descriptions.spec.ts` also selects `tabpanel` "Description" (lines 78, 242) though the plan's list omits it, so it is included here.
- **Acceptance:**
  - *FR-1 — Given a session with a description and chat, When a participant opens it, Then the description and the chat are both visible, the description above the chat, and there is no Description/Chat tab control.* Component (`SessionWindow.test.tsx`): `SessionWindow` with a description → regions "Description" and "Chat" in the Inspector, Description first in DOM order, no `tablist`/`tab` role. E2E (`chat-beside-description.spec.ts`): both regions visible, Description's bounding box above Chat's.
  - Spec 003 AC-15, AC-16, AC-20 and the 002 chat/description E2E tests pass unchanged apart from the selector swap.
  - The FR-8, NFR-1 and NFR-2 E2E tests (acceptance in tasks 10 and 12) exist in `chat-beside-description.spec.ts`, each marked expected-to-fail with a reason naming the task that will flip it, and the suite is green.

### 7. Chat toggle button and `toggleChat` shortcut, remembered per browser

- **Plan:** Chat toggle (FR-2, FR-3, FR-6, FR-7) — state, action table, Button, Shortcut. **Spec:** FR-2, FR-4, FR-6, FR-7.
- **Files:** `pages/SessionWindow.tsx`, `pages/SessionWindow.test.tsx`, `e2e/chat-beside-description.spec.ts`
- **Depends on:** 1, 6
- **Do:** In `JoinedWindow`: `const [chatVisible, setChatVisible] = useChatVisible()`; `chatOnScreen = inspectorOpen && chatVisible`; pass `chatVisible` to `SessionInspector`. Toolbar button directly after the inspector toggle: `<Button variant="plain" icon="chat" label={chatOnScreen ? "Hide chat" : "Show chat"} aria-pressed={chatOnScreen} />`. Handler: on screen → `setChatVisible(false)`; not on screen → `setChatVisible(true)` and `inspectorOpen = true`. The `toggleChat` shortcut calls the same handler (no registry change). The inspector toggle changes only `inspectorOpen`.
- **Acceptance:**
  - *FR-7 — Given the session window toolbar, When it is inspected, Then the chat control's icon differs from every other panel control's icon, And its accessible name is "Hide chat" or "Show chat".* Component: the chat button's icon is `chat` and differs from the icons of the sidebar, run results and inspector toggles; its name is "Hide chat", and "Show chat" after activating it.
  - *FR-2 — Given the chat is visible, When the participant activates "Hide chat", Then the chat is not visible and the description fills the side area.* E2E: click "Hide chat" → Chat region not visible; Description region's height equals the side area's content height (± 1 px).
  - *FR-4 — Given a participant hid the chat, When they open the same or another session later in the same browser, Then the chat starts hidden; Given they showed it again, Then it starts visible.* E2E: hide the chat, open another session in the same browser context → starts hidden; show it, reload → starts visible.
  - *FR-6 — Given the chat is visible, When the participant hides the side area and shows it again, Then the description and chat are both back; Given the chat was hidden, Then only the description comes back.* E2E: chat visible → hide and show the inspector → both regions visible, divider at the same position; chat hidden → hide and show the inspector → only Description visible. Plus: with the inspector hidden, "Show chat" (button or ⌃⌘C / Ctrl+Alt+C) opens the inspector with the chat (plan decision 1).

### 8. `[P]` Stale session shows the description above the read-only chat

- **Plan:** Stale session (FR-9). **Spec:** FR-9, FR-2, FR-4.
- **Files:** `pages/SessionWindow.tsx`, `pages/SessionWindow.test.tsx`, `e2e/stale.spec.ts`
- **Depends on:** 3, 4, 7
- **Do:** `StaleWindow` receives `problemId`, fetches `GET /api/problems/{id}` (existing, public) and passes its `description_html` to `SessionInspector` with the chat `readOnly`; while loading or on failure `descriptionHtml` stays undefined (Chat alone, as today). Add the same chat toggle (`useChatVisible`) to the stale toolbar; no inspector toggle there.
- **Acceptance:**
  - *FR-9 — Given a stale session with chat history, When it is opened, Then the history is shown below the description, And no message can be sent.* Component: `StaleWindow` with a fetched description renders the Description region before the Chat region and the chat input is disabled. E2E (extends the `stale.spec.ts` fixture): a stale session with history shows the history below the description, the message input disabled.
  - *FR-2 / FR-4* in a stale session: the stale toolbar has "Hide chat"/"Show chat"; a remembered "hidden" starts the stale chat hidden and "Show chat" brings it back (component).

### 9. `[P]` Chat scrolls to its newest message when shown again

- **Plan:** Side area layout — *Chat stays mounted while hidden*; Contracts `ChatPaneProps.visible`. **Spec:** FR-3.
- **Files:** `components/ChatPane.tsx`, `components/SessionInspector.tsx`, `e2e/chat-beside-description.spec.ts`
- **Depends on:** 7
- **Do:** `ChatPane` gets optional `visible` (default `true`); on `false → true` a layout effect scrolls the message list to the bottom. `SessionInspector` passes `visible={chatVisible}`.
- **Acceptance:**
  - *FR-3 — Given the chat is hidden and new messages arrived meanwhile, When the participant activates "Show chat", Then the chat reappears below the description scrolled to the newest message.* E2E: Ada hides the chat; Ben sends 30 messages; Ada clicks "Show chat" → Chat region below Description, and the message list satisfies `scrollTop + clientHeight ≥ scrollHeight − 1`. An unsent draft typed before hiding is still in the input after showing (plan decision 3).

### 10. Description and chat scroll independently, chat input pinned

- **Plan:** Side area layout — *Independent scrolling (FR-8)*. **Spec:** FR-8.
- **Files:** `components/ChatPane.module.css`, `components/SessionInspector.module.css`, `e2e/chat-beside-description.spec.ts`
- **Depends on:** 9
- **Do:** The FR-8 E2E test was written in task 6, marked expected-to-fail (if an earlier task already flipped it, say so in the diff note). Make `ChatPane`'s root fill the Chat part (`display: flex; flex-direction: column; height: 100%`), list `flex: 1 1 auto; min-height: 0; overflow-y: auto`, form `flex: none`; Description section scrolls itself. Remove the expected-to-fail marker.
- **Acceptance:**
  - *FR-8 — Given a long description and many chat messages, When the participant scrolls the description, Then the chat does not move; When they send a message, Then the input stays at the bottom of the chat.* The FR-8 test written in task 6 as expected-to-fail now passes with its marker removed. It checks: long description + 50 messages; scroll Description to its bottom → the Chat list's `scrollTop` and the input's bounding box are unchanged; send a message → the input's bottom edge equals the Chat region's bottom edge (± 1 px).

### 11. Drag the divider with the pointer

- **Plan:** Side area layout — *Divider (FR-5)*, pointer handling. **Spec:** FR-5.
- **Files:** `ui/SplitPane.tsx`, `e2e/chat-beside-description.spec.ts`
- **Depends on:** 2, 10
- **Do:** `pointerdown` on the divider captures the pointer; `pointermove` sets the top height to the pointer's offset in the container, clamped with `clampTop`; release ends the drag. The fraction survives hide/show of the chat and the inspector within the page lifetime; it is not stored.
- **Acceptance:**
  - *FR-5 — Given both are visible, When the participant drags the divider up, Then the chat grows and the description shrinks, And neither can be made smaller than its minimum.* E2E: drag the divider up 100 px → Chat taller and Description shorter by the same amount; drag to the top edge → Description height 120 px; drag to the bottom edge → Chat height 160 px.

### 12. Width at 1024 px and keyboard/screen-reader checks

- **Plan:** Side area layout — *Width (NFR-1)*; Chat toggle — Button (toolbar arrow-key navigation); Test strategy rows NFR-1, NFR-2. **Spec:** NFR-1, NFR-2.
- **Files:** `e2e/chat-beside-description.spec.ts` (remove markers); fixes, if a check fails, in `components/SessionInspector.module.css` or `ui/SplitPane.module.css`
- **Note:** The NFR-2 axe scan found two violations that predate spec 008: the code editor's textbox has no accessible name, and the window's top bar lies outside any landmark. On 2026-10-30 the user approved fixing both here, in `components/CodeEditor.tsx` and `ui/Window.tsx`.
- **Depends on:** 7, 11
- **Do:** The NFR-1 and NFR-2 E2E tests were written in task 6, marked expected-to-fail until tasks 7 and 11 land (any already flipped by an earlier task: say so in the diff note). Remove the remaining markers and fix only what the tests still show broken.
- **Acceptance:**
  - The NFR-1 and NFR-2 tests written in task 6 as expected-to-fail now pass with their markers removed, and no expected-to-fail marker remains in `chat-beside-description.spec.ts`.
  - *NFR-1 — Given a 1024 px wide window, When a session is open with the side area and chat visible, Then nothing scrolls horizontally and the editor is usable.* E2E at 1024×768 with the sidebar overlay, inspector and chat shown: `document.documentElement.scrollWidth ≤ clientWidth`; typing into the editor shows the text.
  - *NFR-2 — Given only a keyboard, When a participant moves through the session window, Then they can reach and activate the chat control and move the divider, And a screen reader announces separate description and chat regions.* E2E keyboard-only (no `click`): Tab to the toolbar, arrow to "Hide chat", Space → chat hidden, Space again → shown; Tab to the divider, ↑ three times → Chat taller. `@axe-core/playwright` on the session window: zero violations, and `region` landmarks named "Description" and "Chat".
