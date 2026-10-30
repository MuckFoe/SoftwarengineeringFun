# 008 — Chat always beside the description: plan

HOW only. Requirement ids refer to `spec.md`. This amends the *Window structure* row "Session" of spec 003's plan: the right inspector no longer holds *Description* and *Chat* as tabs, it holds both at once, stacked.

## Architecture

Frontend only, plus one field added to an existing backend error body (FR-9, see Contracts). The inspector itself (`ui/Panels.tsx` `Inspector`, 320 px, collapses by width, stays mounted) is reused unchanged. What goes inside it changes: `InspectorTabs` in `pages/SessionWindow.tsx` is deleted and replaced by a stacked description/chat area with a draggable divider. The toolbar gains one chat toggle.

### Module layout (frontend/src)

```
ui/           SplitPane.tsx        new: vertical split, top / divider / bottom, pointer + keyboard resize, min heights (FR-5, NFR-2)
              SplitPane.module.css new
components/   SessionInspector.tsx new: Description region above Chat region inside a SplitPane; chat part hideable (FR-1, FR-2, FR-8, FR-9)
              SessionInspector.module.css new
              chatVisibility.ts    new: pure load/save of the remembered chat state + useChatVisible hook (FR-4)
              ChatPane.tsx         changed: optional `visible` prop; scrolls to newest on hidden → shown (FR-3); column layout with pinned input (FR-8)
              DescriptionPane.tsx  unchanged; wrapped by SessionInspector, which owns the scrolling
pages/        SessionWindow.tsx    changed: InspectorTabs and InspectorTab removed; SessionInspector in both the active and the stale window;
                                   chat toggle button in both toolbars; toggleChat shortcut rewired (FR-2, FR-3, FR-6, FR-7, FR-9)
api/          client.ts, types.ts  changed: the stale result carries `problemId` (FR-9)
```

**Dependency direction:** unchanged from spec 003, `pages → components → ui → theme`. `SplitPane` is a `ui` primitive and imports nothing from `api/`, `collab/`, `auth/` or `components/`. `chatVisibility.ts` imports nothing but React. `SessionInspector` imports `ui/SplitPane`, `ChatPane` and `DescriptionPane`, never `api/` (data comes in as props from `SessionWindow`).

### Side area layout (FR-1, FR-2, FR-5, FR-6, FR-8)

```
Inspector (aside "Inspector", 320 px, existing toggle)
└─ SessionInspector
   ├─ chat shown:  SplitPane
   │               ├─ top:    section "Description"  (overflow-y: auto)
   │               ├─ divider (role="separator", focusable)
   │               └─ bottom: section "Chat"         (ChatPane: message list scrolls, input pinned)
   └─ chat hidden: section "Description" fills the whole height; the Chat section stays mounted
                   but collapsed (height 0, `collapsedProps(false)` → aria-hidden + inert)
```

- **No tabs.** Nothing with `role="tablist"`/`"tab"`/`"tabpanel"` remains in the session window (AC FR-1).
- **Chat stays mounted while hidden** so it keeps receiving messages and keeps an unsent draft; it is out of the accessibility tree and inert while hidden, as the existing `collapsedProps` does for panels. On hidden → shown, `ChatPane` scrolls its message list to the bottom in a layout effect (FR-3).
- **Divider (FR-5).** `SplitPane` stores the top part's height as a fraction of the container (`topFraction`, default 0.5) in component state. Pointer: `pointerdown` on the divider captures the pointer; `pointermove` sets the top height to the pointer's offset in the container, clamped. Dragging up shrinks the description and grows the chat. Keyboard: ↑/↓ move by 16 px, Home/End jump to the top part's minimum/maximum. Clamp: top ≥ `minTop` and bottom ≥ `minBottom`; if the container is shorter than `minTop + minBottom`, both get their share in proportion to their minimums. The fraction is kept across hide/show of the chat and of the inspector within the page lifetime (FR-6) but is not stored (spec: out of scope).
- **Minimums.** Description 120 px; chat 160 px, enough for the chat header, one message line and the input with its counter. Under `prefers-reduced-motion` nothing here animates except the existing collapse fade.
- **Independent scrolling (FR-8).** `SplitPane` top and bottom are `min-height: 0; overflow: hidden` flex children. The Description section scrolls itself (`overflow-y: auto`). `ChatPane`'s root is `display: flex; flex-direction: column; height: 100%`, its message list `flex: 1 1 auto; min-height: 0; overflow-y: auto`, its input form `flex: none`, so the input is always at the bottom of the chat part.
- **Width (NFR-1).** The parts stack vertically inside the existing 320 px inspector, so spec 003's width budget (sidebar overlay + editor ≥ 420 px + inspector 320 px at 1024 px) is unchanged. Long words and images inside either part wrap or scale (`overflow-wrap: anywhere`, `img { max-width: 100% }`, the latter already in `.prose`).

### Chat toggle (FR-2, FR-3, FR-6, FR-7)

State in `SessionWindow`: `inspectorOpen` (existing, not remembered) and `chatVisible` (new, remembered via `useChatVisible`). The chat is on screen when `inspectorOpen && chatVisible`.

| Action | Effect |
|---|---|
| Chat button / `toggleChat` shortcut while the chat is on screen | `chatVisible = false`; the description takes the whole side area (FR-2) |
| Chat button / `toggleChat` shortcut while the chat is not on screen | `chatVisible = true` and `inspectorOpen = true` (FR-3) |
| Existing inspector button | toggles `inspectorOpen` only; `chatVisible` is untouched, so showing it again restores description + chat or description alone as before (FR-6) |

- **Button:** `<Button variant="plain" icon="chat" label={chatOnScreen ? "Hide chat" : "Show chat"} aria-pressed={chatOnScreen} />`, placed directly after the inspector toggle in the toolbar, so it is reached by the toolbar's existing arrow-key navigation (NFR-2). The `chat` icon already exists in `ui/Icon.tsx`. No other panel control (sidebar `sidebar`, run results `doc`, inspector `doc`) uses `chat`, so FR-7 holds without touching the others' icons; changing those is F4, out of scope.
- **Shortcut:** the existing `toggleChat` registry entry (⌃⌘C / Ctrl+Alt+C, spec 003 FR-17) keeps its keys and label and calls the same handler as the button. No registry change.

### Stale session (FR-9)

Today the stale window shows only the chat, because the 423 body doesn't say which problem the session is on. The stale body gains `problem_id` (the session's `current_problem_id`); `StaleWindow` fetches `GET /api/problems/{id}` (existing, public) and passes its `description_html` to `SessionInspector` with the chat `readOnly`. While the problem is loading, or if it can't be loaded, the Chat region fills the side area alone, as today. The stale toolbar gets the same chat toggle (FR-2, FR-4 apply to any session); it has no inspector toggle today and gets none.

## Data model

No database change.

Client-side, per browser, next to spec 003's `localStorage["appearance"]`:

```
localStorage["chatVisible"]: "shown" | "hidden"     missing or any other value → "shown"
```

Read and write are wrapped in try/catch exactly like `theme/appearance.ts`; a failing storage falls back to `"shown"` and never throws. Not remembered: the divider fraction and `inspectorOpen` (spec: out of scope / unchanged).

## Contracts

```ts
// ui/SplitPane.tsx
export interface SplitPaneProps {
  top: ReactNode;
  bottom: ReactNode;
  /** When false only `top` is laid out; `bottom` stays mounted, collapsed to 0, aria-hidden + inert. */
  bottomOpen: boolean;
  minTop: number;            // px
  minBottom: number;         // px
  defaultTopFraction?: number; // 0..1, default 0.5
  /** Accessible name of the divider, e.g. "Resize description and chat". */
  dividerLabel: string;
}
export function SplitPane(p: SplitPaneProps): JSX.Element;
// Divider renders: <div role="separator" aria-orientation="horizontal" tabIndex={0}
//   aria-label={dividerLabel} aria-valuemin={0} aria-valuemax={100}
//   aria-valuenow={round(topFraction * 100)} />   (value = description share in percent)
// Keys on the divider: ArrowUp/ArrowDown ±16 px, Home → top at minTop, End → bottom at minBottom.
// Exported for unit tests:
export function clampTop(top: number, container: number, minTop: number, minBottom: number): number;

// components/chatVisibility.ts
export type ChatVisibility = "shown" | "hidden";
export const CHAT_VISIBILITY_KEY = "chatVisible";
export function loadChatVisibility(): ChatVisibility;          // never throws
export function saveChatVisibility(v: ChatVisibility): void;   // never throws
export function useChatVisible(): [visible: boolean, setVisible: (v: boolean) => void]; // saves on every set

// components/SessionInspector.tsx
export interface SessionInspectorProps {
  /** Sanitised description HTML; undefined while unknown → the Chat region fills the area alone. */
  descriptionHtml?: string;
  chatVisible: boolean;
  chat: ChatPaneProps;       // passed through to ChatPane (readOnly true in a stale session)
}
export function SessionInspector(p: SessionInspectorProps): JSX.Element;
// Renders <section aria-label="Description"> (DescriptionPane inside) and
// <section aria-label="Chat"> (ChatPane inside, visible={chatVisible}), in a
// SplitPane with minTop=120, minBottom=160, dividerLabel="Resize description and chat".

// components/ChatPane.tsx — existing props plus:
export interface ChatPaneProps {
  // ...existing: messages, readOnly, send, canRemove?, remove?
  /** Default true. On false → true the message list scrolls to its newest message. */
  visible?: boolean;
}

// api/types.ts / api/client.ts — the stale result
type SessionStatus = { kind: "active" } | { kind: "stale"; canReactivate: boolean; problemId: string } | …;
```

```
GET /api/sessions/{invite}   (existing)
  423 {"error": "stale", "can_reactivate": bool, "problem_id": "<uuid>"}   ← problem_id added
  200 / 404 unchanged
```

Backend change: one key added to the `detail` dict in `backend/app/sessions/api.py` `get_session`, from `session.current_problem_id`, already loaded by `service.get_status`. The learn sessions' 423 (spec 006) is not touched.

## Test strategy

Levels as in spec 003: **component** = Vitest + Testing Library in jsdom (`frontend/`, with jsdom's real `localStorage`). **Backend integration** = pytest against real Postgres (`backend/tests/integration/`). **E2E** = Playwright in real browsers against the compose test stack (`e2e/`). Per constitution rule 4, layout (heights, scrolling, dragging, viewport width) is not faked in jsdom: anything that needs a layout engine is tested in E2E.

New E2E file: `e2e/chat-beside-description.spec.ts`. Existing E2E specs that select the chat by `role="tab"`/`"tabpanel"` named "Chat" (`chat.spec.ts`, `session-002.spec.ts`, `keyboard.spec.ts`, `hub-lifecycle.spec.ts`) switch to `getByRole("region", { name: "Chat" })` and drop the tab click; their assertions stay.

| AC | Level | Test |
|---|---|---|
| FR-1 | component + E2E | Component: `SessionWindow` with a description → regions "Description" and "Chat" both present, Description before Chat in DOM order, no `tablist`/`tab` role. E2E: both regions visible, Description's bounding box above Chat's. |
| FR-2 | E2E | Click "Hide chat" → Chat region not visible, Description region's height equals the side area's content height (± 1 px). |
| FR-3 | E2E | Ada hides the chat; Ben sends 30 messages; Ada clicks "Show chat" → Chat region below Description, newest message inside the list's visible box (`scrollTop + clientHeight ≥ scrollHeight − 1`). |
| FR-4 | unit + E2E | Unit: `loadChatVisibility` defaults to `shown`, round-trips `hidden`/`shown`, ignores junk values, survives a throwing storage. E2E: hide chat, open another session in the same context → starts hidden; show it, reload → starts visible. |
| FR-5 | unit + E2E | Unit: `clampTop` keeps both minimums, incl. a container shorter than their sum. E2E: drag divider up 100 px → Chat taller, Description shorter by the same amount; drag to the top edge → Description height = 120, drag to the bottom edge → Chat height = 160. |
| FR-6 | E2E | Chat visible: hide inspector, show inspector → both regions visible, divider at the same position. Chat hidden: hide and show inspector → only Description visible. |
| FR-7 | component | Render the session toolbar: the chat button's icon name is `chat` and differs from the icon of every other panel toggle (sidebar, run results, inspector); its accessible name is "Hide chat", and "Show chat" after activating it. |
| FR-8 | E2E | Long description + 50 messages: scroll Description to bottom → Chat list `scrollTop` and the input's bounding box unchanged. Send a message → the input's bottom edge equals the Chat region's bottom edge (± 1 px). |
| FR-9 | integration + component + E2E | Integration: stale `GET /api/sessions/{invite}` → 423 body includes `problem_id` equal to the session's current problem. Component: `StaleWindow` with a fetched description renders Description above Chat, chat input disabled. E2E (extends `stale.spec.ts` fixture): stale session with history → history shown below the description, message input disabled. |
| NFR-1 | E2E | 1024×768, sidebar overlay shown, inspector and chat shown: `document.documentElement.scrollWidth ≤ clientWidth`; type into the editor and see the text appear. |
| NFR-2 | component + E2E | Component: divider has `role="separator"`, a name, `aria-valuenow`; ↑/↓/Home/End change it. E2E keyboard-only (no `click`): Tab to the toolbar, arrow to "Hide chat", press Space → chat hidden, again → shown; Tab to the divider, press ↑ three times → Chat taller. `@axe-core/playwright` on the session window: zero violations, and two `region` landmarks named "Description" and "Chat". |

Spec 003's AC-15 (description beside the editor at 1280 px), AC-16 (chat grouping, counter, stale input) and AC-20 (1024 px) E2E tests keep passing unchanged apart from the selector change above.

## Dependencies

None added. The splitter, the remembered state and the scrolling are a few dozen lines on top of existing React, CSS Modules and pointer events; no splitter package is justified.

## Constitution compliance

1. **Test-first:** every row in the test table is written as a failing test inside the task that implements it.
2. **Green before done:** the full suite includes the existing 002/003 E2E specs, whose chat selectors change in the same task that removes the tabs, so the suite never goes red across tasks.
3. **Traceable tests:** the table maps every FR and NFR acceptance criterion in `spec.md` to at least one test.
4. **Real dependencies:** no mocks. `localStorage` is jsdom's real implementation; the "throwing storage" unit case replaces `window.localStorage` with an object whose methods throw, which is a browser API the project doesn't own being made to fail, not a mock of project code. Layout-dependent behaviour goes to E2E instead of stubbing `getBoundingClientRect`. The stale-session integration test uses real Postgres.
5. **Fixed stack:** React + TS strict + Vite and FastAPI, unchanged.
6. **Dependency justification:** no new dependency (see Dependencies).
7. **No secrets:** none introduced.
8. **Lint/format:** new TS/CSS under `biome ci` and `tsc --noEmit`; the one-line backend change under `ruff`.
9. **Module layout and dependency direction:** stated under Architecture.

No conflicts.

## Decisions for the human to confirm

1. **Chat button while the side area is hidden opens both** (side area + chat), instead of being disabled. Reason: the existing `toggleChat` shortcut already opens the inspector to the chat, and it gives one predictable "Show chat" action.
2. **Default split 50/50, minimums 120 px (description) / 160 px (chat).** Reason: 160 px keeps the chat header, one message and the pinned input usable; the spec leaves the numbers to the plan.
3. **The hidden chat stays mounted (collapsed, inert)** rather than unmounting. Reason: an unsent draft survives hide/show and new messages keep arriving, so scroll-to-newest on show is a single scroll.
4. **Stale 423 body gains `problem_id`, and the stale window fetches the description from the existing public problem endpoint.** Reason: AC FR-9 needs the description in a stale session, which today's stale view can't know. This is the only backend change; the alternative (embedding `description_html` in the 423) would duplicate the problem endpoint's rendering.
5. **The chat toggle is also added to the stale window's toolbar** (it has no inspector toggle and gets none). Reason: FR-2 and FR-4 apply to any session, so a remembered "hidden" must be reversible there too.
6. **Learn sessions (spec 006) are not changed**, even if they reuse the chat. Reason: the spec amends only the session window (003 FR-15).
7. **Remembered key is `localStorage["chatVisible"]` with values `shown`/`hidden`**, stored like the appearance choice.
