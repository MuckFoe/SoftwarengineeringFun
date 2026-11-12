import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, getHints, getProblem, getSession, reactivateSession } from "../api/client";
import type {
  Hint,
  HintPending,
  Participant,
  Problem,
  ProblemProgress,
  WsErrorCode,
} from "../api/types";
import { useMe } from "../auth/useMe";
import { BASE } from "../base";
import { useChat } from "../chat/useChat";
import { type ClosedEvent, CollabProvider, type SocketFactory } from "../collab/provider";
import type { ChatGifs } from "../components/ChatPane";
import { CodeEditor, editorAccess } from "../components/CodeEditor";
import { useChatPinned } from "../components/chatVisibility";
import { editorTheme } from "../components/editorTheme";
import { PresenceList } from "../components/PresenceList";
import { ProblemList, useProblemSwitcher } from "../components/ProblemSourceList";
import { RunPanel } from "../components/RunPanel";
import {
  type ChatPaneProps,
  type PanelPin,
  SessionInspector,
} from "../components/SessionInspector";
import { type HintNotice, HintsPanel } from "../hints/HintsPanel";
import { ScratchPanel } from "../scratch/ScratchPanel";
import {
  initialScratchState,
  type ScratchAction,
  type ScratchState,
  scratchReducer,
} from "../scratch/scratchReducer";
import { ShortcutScope, useShortcut } from "../shortcuts/useShortcut";
import { AppHeader } from "../ui/AppHeader";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { HeaderButton } from "../ui/HeaderButton";
import { Hud } from "../ui/Hud";
import { InlineMessage } from "../ui/InlineMessage";
import { LiveBadge } from "../ui/LiveBadge";
import { PinnablePanel, type PinnablePanelHandle } from "../ui/PinnablePanel";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { Tabs } from "../ui/Tabs";
import { TextField } from "../ui/TextField";
import { usePinned } from "../ui/usePinned";
import { Window } from "../ui/Window";
import { NotFound } from "./NotFound";
import styles from "./SessionWindow.module.css";

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "stale"; canReactivate: boolean; problemId: string }
  | { kind: "ready" }
  | { kind: "error" }
  | { kind: "deleted"; by: DeletedBy };

/** Who deleted the session (spec 019 FR-7); null when only the 410 or the 4411 said so. */
type DeletedBy = "host" | "admin" | null;

/** The socket close code for a deleted session (spec 019 plan, same as chess). */
const CLOSE_DELETED = 4411;

const DELETED_BY: Record<"host" | "admin", string> = {
  host: "The host deleted it.",
  admin: "An admin deleted it.",
};

const CLOSE_MESSAGES: Record<ClosedEvent["error"], string> = {
  session_full: "This session is full (5 participants max).",
  invalid_name: "That name was refused by the server.",
  not_found: "Session not found.",
  stale: "This session has gone stale.",
  replaced: "This session was opened in another tab or window.",
  disconnected: "Disconnected from the session.",
};

/** Notices for the `error` replies that can arrive once joined. */
const ERROR_NOTICES: Partial<Record<WsErrorCode, string>> = {
  run_in_progress: "A run is already in progress.",
  problem_deleted: "This problem has been deleted, so it can't be run.",
  problem_not_found: "That problem no longer exists.",
};

const NO_PROGRESS: ProblemProgress = { accepted: false };

/** The bottom panel's two results: the script run's output, and the tests' results. */
type ResultsTab = "output" | "tests";

const RESULTS_TABS = [
  { id: "output", label: "Output" },
  { id: "tests", label: "Tests" },
] as const;

/** The pinned run results' height, bar included; the pinned chat matches it (2026-11-12). */
const RESULTS_HEIGHT_PX = 220;

type Chat = ReturnType<typeof useChat>;

/** Everything shown once joined, kept current from the session's messages. */
interface Joined {
  participants: Participant[];
  problem: Problem;
  /** Accepted status and last run per problem this session has used (FR-17, FR-28). */
  progress: Record<string, ProblemProgress>;
  running: boolean;
  notice: string | null;
  /** The session's script run, started by Run (spec 011, 2026-11-12 change). */
  scratch: ScratchState;
  /** This participant asked for a script run and the server hasn't answered yet. */
  scratchStarting: boolean;
  /** Which result the bottom panel shows; a run or check starting selects its own. */
  resultsTab: ResultsTab;
  /** Every hint of the session, all problems (spec 020 FR-15); shown filtered to the current one. */
  hints: Hint[];
  /** A model is configured (spec 020 FR-1, FR-2). */
  hintsEnabled: boolean;
  /** A hint being prepared for the session (FR-5, FR-8, FR-14a). */
  hintPending: HintPending | null;
  hintNotice: HintNotice | null;
}

/**
 * The tab a fresh join opens on: Tests while a check is going, or when the problem has test
 * results and the session has no script run; otherwise Output.
 */
function firstTab(msg: {
  run_in_progress: boolean;
  scratch_run?: unknown;
  current_problem: Problem;
  problems: Record<string, ProblemProgress>;
}): ResultsTab {
  if (msg.run_in_progress) return "tests";
  if (msg.scratch_run) return "output";
  return msg.problems[msg.current_problem.id]?.last_run ? "tests" : "output";
}

/** One problem's hints, by number (spec 020 FR-13). */
function hintsFor(hints: Hint[], problemId: string): Hint[] {
  return hints.filter((h) => h.problem_id === problemId).sort((a, b) => a.number - b.number);
}

function nameProblem(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 30) {
    return "Enter a name from 1 to 30 characters.";
  }
  return null;
}

interface Props {
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: SocketFactory;
}

/**
 * Join states for a session (FR-12, FR-12a, FR-13, FR-14, FR-30, FR-31, FR-32), then the
 * session window (spec 003 FR-10): problems and participants in the sidebar, the editor in
 * the main area, the script run's output and the tests' results in the bottom panel, the
 * description and chat in the inspector, and Run, Check, Invite and the panel toggles in
 * the toolbar (FR-10, FR-14, FR-15,
 * FR-17, FR-26, FR-28).
 */
export function SessionWindow({ createSocket }: Props) {
  const { invite } = useParams();
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);
  const me = useMe();
  // Signed in: the server names us after the account, so there is no name sheet (spec 012 FR-1).
  // Anything but a signed-in answer, a failed /api/me included, asks for a name (FR-6).
  const signedIn = me.status === "ready" && me.me.signed_in;
  /** Why a signed-in connection ended; null while connecting or joined. */
  const [ended, setEnded] = useState<ClosedEvent["error"] | null>(null);
  const autoJoined = useRef(false);
  const lastName = useRef<string | undefined>(undefined);
  const providerRef = useRef<CollabProvider | null>(null);
  // State as well as the ref, so useChat subscribes before the welcome (and its history) arrives.
  const [provider, setProvider] = useState<CollabProvider | null>(null);
  const chat = useChat({ invite: invite ?? "", provider, stale: page.kind === "stale" });
  const inviteLink = new URL(`${BASE}s/${invite}`, window.location.origin).toString();

  useEffect(() => {
    if (!invite) return;
    let current = true;
    getSession(invite).then(
      () => {
        if (current) setPage({ kind: "ready" });
      },
      (err: unknown) => {
        if (!current) return;
        if (err instanceof ApiError && err.error.kind === "not_found") {
          setPage({ kind: "not_found" });
        } else if (err instanceof ApiError && err.error.kind === "session_deleted") {
          setPage({ kind: "deleted", by: null });
        } else if (err instanceof ApiError && err.error.kind === "stale") {
          setPage({
            kind: "stale",
            canReactivate: err.error.canReactivate,
            problemId: err.error.problemId,
          });
        } else {
          setPage({ kind: "error" });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [invite]);

  useEffect(() => {
    return () => providerRef.current?.destroy();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connects once, when both are known.
  useEffect(() => {
    if (page.kind !== "ready" || !signedIn || autoJoined.current) return;
    autoJoined.current = true;
    connect();
  }, [page.kind, signedIn]);

  // The scratch output skipped ahead of what we hold: join again for a fresh welcome (spec 011).
  const needsSnapshot = joined?.scratch.needsSnapshot ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-joins once per gap.
  useEffect(() => {
    if (!needsSnapshot) return;
    providerRef.current?.destroy();
    connect(lastName.current);
  }, [needsSnapshot]);

  async function reactivate() {
    if (!invite) return;
    setReactivateError(null);
    try {
      await reactivateSession(invite);
    } catch (err) {
      // 409: it isn't stale any more, which is what reactivating was for (FR-9).
      if (!(err instanceof ApiError && err.error.kind === "conflict")) {
        setReactivateError("Could not reactivate this session.");
        return;
      }
    }
    setPage({ kind: "ready" });
    setHud({ key: Date.now(), message: "Session reactivated" });
  }

  function join(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    const problem = nameProblem(name);
    if (problem) {
      setNameError(problem);
      return;
    }
    setNameError(null);
    connect(name.trim());
  }

  /** Opens the socket; without a name when signed in (spec 012 FR-1). Never reconnects by itself. */
  function connect(displayName?: string) {
    if (!invite) return;
    lastName.current = displayName;
    setEnded(null);
    const provider = new CollabProvider({ inviteId: invite, name: displayName, createSocket });
    providerRef.current = provider;
    setProvider(provider);
    const update = (change: (prev: Joined) => Partial<Joined>) =>
      setJoined((prev) => (prev ? { ...prev, ...change(prev) } : prev));
    provider.on("welcome", (msg) => {
      setJoined((prev) => ({
        participants: msg.presence,
        problem: msg.current_problem,
        progress: msg.problems,
        running: msg.run_in_progress,
        notice: null,
        scratch: { ...initialScratchState, run: msg.scratch_run ?? null },
        scratchStarting: false,
        // A re-join for a fresh snapshot keeps the tab the participant was looking at.
        resultsTab: prev?.resultsTab ?? firstTab(msg),
        // Absent from older servers: no model, no hints (spec 020 contract).
        hints: msg.hints ?? [],
        hintsEnabled: msg.hints_enabled ?? false,
        hintPending: msg.hint_pending ?? null,
        hintNotice: null,
      }));
    });
    // A new request clears the last notice, so a second failure in a row is announced again.
    provider.on("hint_started", (msg) =>
      update(() => ({ hintPending: msg.pending, hintNotice: null })),
    );
    provider.on("hint_warming", () =>
      update((prev) => ({
        hintPending: prev.hintPending ? { ...prev.hintPending, warming: true } : null,
      })),
    );
    provider.on("hint_ready", (msg) =>
      update((prev) => ({
        hints: prev.hints.some((h) => h.id === msg.hint.id)
          ? prev.hints
          : [...prev.hints, msg.hint],
        hintPending: null,
        hintNotice: null,
      })),
    );
    provider.on("hint_failed", (msg) =>
      update(() => ({ hintPending: null, hintNotice: msg.reason })),
    );
    provider.on("hint_refused", (msg) =>
      update((prev) => {
        if (msg.reason === "in_progress") return { hintNotice: "in_progress" };
        // The button was out of date: hide it as the server says (FR-2, FR-3).
        if (msg.reason === "disabled") return { hintsEnabled: false };
        if (msg.reason === "problem_deleted")
          return { problem: { ...prev.problem, deleted: true } };
        return {};
      }),
    );
    const scratch = (action: ScratchAction) =>
      update((prev) => ({ scratch: scratchReducer(prev.scratch, action) }));
    provider.on("scratch_run_started", (msg) =>
      update((prev) => ({
        scratch: scratchReducer(prev.scratch, { type: "started", run: msg.run }),
        scratchStarting: false,
        resultsTab: "output",
      })),
    );
    provider.on("scratch_run_output", (msg) =>
      scratch({ type: "output", seq: msg.seq, s: msg.s, t: msg.t }),
    );
    provider.on("scratch_run_end", (msg) =>
      scratch({ type: "end", status: msg.status, exit_code: msg.exit_code }),
    );
    provider.on("scratch_run_refused", (msg) =>
      update((prev) => ({
        scratchStarting: false,
        scratch: scratchReducer(
          prev.scratch,
          msg.reason === "in_progress"
            ? { type: "refused", reason: "in_progress", by: msg.by }
            : { type: "refused", reason: "stale" },
        ),
      })),
    );
    provider.on("presence", (msg) => update(() => ({ participants: msg.participants })));
    provider.on("problem_switched", (msg) =>
      update((prev) => ({
        problem: msg.problem,
        progress: { ...prev.progress, [msg.problem.id]: msg.state },
        notice: null,
        hintNotice: null,
      })),
    );
    provider.on("problem_deleted", (msg) =>
      update((prev) =>
        prev.problem.id === msg.problem_id ? { problem: { ...prev.problem, deleted: true } } : {},
      ),
    );
    provider.on("run_started", () =>
      update(() => ({ running: true, notice: null, resultsTab: "tests" })),
    );
    provider.on("run_finished", (msg) =>
      update((prev) => {
        const before = prev.progress[msg.run.problem_id] ?? NO_PROGRESS;
        // Accepted is the session's status, not this run's: it stays once earned (FR-23).
        const progress = { accepted: before.accepted || msg.run.accepted, last_run: msg.run };
        return { running: false, progress: { ...prev.progress, [msg.run.problem_id]: progress } };
      }),
    );
    provider.on("run_failed", () =>
      update(() => ({ running: false, notice: "The run could not be completed. Try again." })),
    );
    provider.on("error", (msg) =>
      update((prev) => ({
        notice: ERROR_NOTICES[msg.code] ?? null,
        problem: msg.code === "problem_deleted" ? { ...prev.problem, deleted: true } : prev.problem,
        // A run refused for a deleted problem never started.
        running: msg.code === "problem_deleted" ? false : prev.running,
      })),
    );
    onSessionDeleted(provider, (by) => setPage({ kind: "deleted", by }));
    provider.on("closed", (ev) => {
      // Deleted (spec 019 FR-7): keep who deleted it if the message came first.
      if (ev.code === CLOSE_DELETED) {
        setPage((prev) => (prev.kind === "deleted" ? prev : { kind: "deleted", by: null }));
      }
      // A provider replaced by a re-join (spec 011) closing late is not the session ending.
      if (providerRef.current !== provider) return;
      providerRef.current = null;
      setProvider(null);
      setJoined(null);
      // A 4409 means this participant moved to another tab: stay closed until "Use here" (FR-5).
      if (displayName === undefined) setEnded(ev.error);
      else setNameError(CLOSE_MESSAGES[ev.error]);
    });
  }

  if (page.kind === "deleted") {
    return (
      <Window
        toolbar={
          <AppHeader label="Session">
            <span className={styles.spacer} />
          </AppHeader>
        }
      >
        <DeletedState by={page.by} />
      </Window>
    );
  }

  if (page.kind === "not_found") return <NotFound message="Session not found" />;

  if (joined && providerRef.current) {
    const provider = providerRef.current;
    // Check runs the hidden tests. Shown as running at once (spec 003 FR-3);
    // run_started/run_finished confirm it.
    const check = () => {
      setJoined((prev) =>
        prev ? { ...prev, running: true, notice: null, resultsTab: "tests" } : prev,
      );
      provider.send({ type: "run" });
    };
    // Run runs the code as a script with empty input (spec 011, 2026-11-12 change).
    const runCode = () => {
      setJoined((prev) => (prev ? { ...prev, scratchStarting: true, resultsTab: "output" } : prev));
      provider.send({ type: "scratch_run", input: "" });
    };
    const setResultsTab = (tab: ResultsTab) =>
      setJoined((prev) => (prev ? { ...prev, resultsTab: tab } : prev));
    return (
      <>
        <JoinedWindow
          provider={provider}
          joined={joined}
          chat={chat}
          // GIF search only for a live session (spec 007 FR-1, FR-8); the stale page gets none.
          gifs={{ invite: invite ?? "", provider, sendGif: chat.sendGif }}
          inviteLink={inviteLink}
          onRun={runCode}
          onCheck={check}
          onResultsTab={setResultsTab}
        />
        {/* Signed in, reactivating joins at once (spec 012 FR-1): its Hud outlives the join. */}
        {hud && <Hud key={hud.key} message={hud.message} />}
      </>
    );
  }

  if (page.kind === "stale") {
    return (
      <StaleWindow
        invite={invite ?? ""}
        canReactivate={page.canReactivate}
        problemId={page.problemId}
        error={reactivateError}
        chat={chat}
        onReactivate={() => void reactivate()}
      />
    );
  }

  let body: ReactNode;
  if (page.kind === "loading" || me.status === "loading") {
    body = <p className={styles.loading}>Loading…</p>;
  } else if (page.kind === "error") {
    body = (
      <EmptyState icon="exclamation" title="Could not load this session">
        <span role="alert">Could not load this session.</span>
      </EmptyState>
    );
  } else if (signedIn) {
    body = (
      <div className={styles.joinCard}>
        <h1 className={styles.joinTitle}>Join this session</h1>
        {ended ? (
          <>
            <InlineMessage id="join-ended" tone={ended === "replaced" ? "info" : "error"}>
              {CLOSE_MESSAGES[ended]}
            </InlineMessage>
            <div className={styles.joinActions}>
              <Button variant="primary" onClick={() => connect()}>
                {ended === "replaced" ? "Use here" : "Join"}
              </Button>
            </div>
          </>
        ) : (
          <p className={styles.loading}>Joining…</p>
        )}
        <InviteField link={inviteLink} />
      </div>
    );
  } else {
    body = (
      <div className={styles.joinCard}>
        <h1 className={styles.joinTitle}>Join this session</h1>
        <form className={styles.joinForm} onSubmit={join}>
          <TextField
            label="Your name"
            value={name}
            onChange={setName}
            invalid={nameError !== null}
            describedBy={nameError ? "join-name-error" : undefined}
          />
          {nameError && <InlineMessage id="join-name-error">{nameError}</InlineMessage>}
          <div className={styles.joinActions}>
            <Button variant="primary" type="submit">
              Join
            </Button>
          </div>
        </form>
        <InviteField link={inviteLink} />
      </div>
    );
  }

  return (
    <>
      <Window
        toolbar={
          <AppHeader label="Session">
            <span className={styles.spacer} />
          </AppHeader>
        }
      >
        {body}
      </Window>
      {hud && <Hud key={hud.key} message={hud.message} />}
    </>
  );
}

/**
 * Calls `handler` when the server says the session was deleted (spec 019 FR-7). The provider
 * emits every message type it receives; `session_deleted` is not in the shared message types.
 */
function onSessionDeleted(provider: CollabProvider, handler: (by: DeletedBy) => void) {
  const on = provider.on.bind(provider) as unknown as (
    type: "session_deleted",
    h: (msg: { by?: unknown }) => void,
  ) => () => void;
  on("session_deleted", (msg) => handler(msg.by === "host" || msg.by === "admin" ? msg.by : null));
}

/** A deleted session (spec 019 FR-7, FR-8): says so, and who did it when known, with a way home. */
function DeletedState({ by }: { by: DeletedBy }) {
  return (
    <EmptyState
      icon="trash"
      title="This session was deleted"
      action={
        <Link className={styles.homeLink} to="/">
          Back to home
        </Link>
      }
    >
      {by && DELETED_BY[by]}
    </EmptyState>
  );
}

interface StaleProps {
  invite: string;
  canReactivate: boolean;
  /** The problem the session is on (spec 008 FR-9); "" if the server didn't say. */
  problemId: string;
  error: string | null;
  chat: Chat;
  onReactivate(): void;
}

/**
 * A stale session (spec 003 FR-12, AC-13): a calm banner under the toolbar, with
 * Reactivate beside the notice for admins, and the editor, Run and Check visibly disabled.
 * The problem's description sits above the read-only chat once it has loaded; until
 * then, or if it can't be loaded, the chat fills the side area alone (spec 008 FR-9).
 */
function StaleWindow({ invite, canReactivate, problemId, error, chat, onReactivate }: StaleProps) {
  const [descriptionHtml, setDescriptionHtml] = useState<string | undefined>(undefined);
  const [hints, setHints] = useState<Hint[]>([]);
  const pins = useInspectorPins();

  // Hints already given stay visible, read-only (spec 020 FR-3, FR-15).
  useEffect(() => {
    if (!invite || !problemId) return;
    let current = true;
    getHints(invite).then(
      (body) => {
        if (current) setHints(hintsFor(body.hints, problemId));
      },
      () => {
        // Not loaded: no hints shown, as with no hints.
      },
    );
    return () => {
      current = false;
    };
  }, [invite, problemId]);

  useEffect(() => {
    if (!problemId) return;
    let current = true;
    getProblem(problemId).then(
      (problem) => {
        if (current) setDescriptionHtml(problem.description_html);
      },
      () => {
        // Not loaded: the chat alone, as before spec 008.
      },
    );
    return () => {
      current = false;
    };
  }, [problemId]);

  return (
    <Window
      inspector={
        // The history stays readable; only sending is unavailable (spec 002 FR16).
        <SessionInspector
          descriptionHtml={descriptionHtml}
          chatVisible={pins.chat.pinned}
          chat={chatProps(chat)}
          pins={pins}
          hints={
            hints.length > 0 && (
              <HintsPanel
                hints={hints}
                canAsk={false}
                pending={null}
                notice={null}
                onAsk={() => {}}
              />
            )
          }
        />
      }
      toolbar={
        <AppHeader label="Session" stackNarrow>
          <h1 className={styles.title}>Stale session</h1>
          <span className={styles.spacer} />
          <Button variant="primary" size="xs" icon="play" disabled>
            <span className="app-header-pill-text">Run</span>
          </Button>
          <Button variant="bordered" size="xs" icon="checkmark" disabled>
            <span className="app-header-pill-text">Check</span>
          </Button>
        </AppHeader>
      }
      banner={
        <Banner
          tone="warning"
          actions={
            canReactivate && (
              <Button variant="bordered" onClick={onReactivate}>
                Reactivate
              </Button>
            )
          }
        >
          This session has gone stale, so it can't be edited or run.
          {error && <InlineMessage id="reactivate-error">{error}</InlineMessage>}
        </Banner>
      }
    >
      <div className={styles.main}>
        <div className={styles.editor}>
          <ReadOnlyEditor />
        </div>
      </div>
    </Window>
  );
}

/** The editor, shown but not editable (CodeMirror `readOnly` + `editable` false). */
function ReadOnlyEditor() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const state = EditorState.create({
      extensions: [
        basicSetup,
        python(),
        editorTheme,
        editorAccess,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    });
    const view = new EditorView({ state, parent });
    return () => view.destroy();
  }, []);

  return <div ref={containerRef} />;
}

function InviteField({ link }: { link: string }) {
  return (
    <label className={styles.invite}>
      <span className={styles.inviteLabel}>Invite link</span>
      <input className={styles.inviteInput} readOnly value={link} aria-label="Invite link" />
    </label>
  );
}

interface JoinedProps {
  provider: CollabProvider;
  joined: Joined;
  chat: Chat;
  gifs: ChatGifs;
  inviteLink: string;
  /** Runs the code as a script (spec 011, 2026-11-12 change). */
  onRun(): void;
  /** Runs the hidden tests. */
  onCheck(): void;
  onResultsTab(tab: ResultsTab): void;
}

function JoinedWindow({
  provider,
  joined,
  chat,
  gifs,
  inviteLink,
  onRun,
  onCheck,
  onResultsTab,
}: JoinedProps) {
  const { problem } = joined;
  const scratchBusy = joined.scratchStarting || joined.scratch.run?.status === "running";
  const switcher = useProblemSwitcher(provider, problem.id);
  // Each panel is pinned (laid out) or a strip that peeks on hover or focus, remembered per
  // browser. The sidebar (problems, participants) starts unpinned so the editor gets the room;
  // the run results start pinned; the description and chat as `useInspectorPins` says.
  const [sidebarPinned, setSidebarPinned] = usePinned("sidebar", false);
  const [outputPinned, setOutputPinned] = usePinned("output", true);
  const sidebarRef = useRef<PinnablePanelHandle>(null);
  const outputRef = useRef<PinnablePanelHandle>(null);
  const chatRef = useRef<PinnablePanelHandle>(null);
  const pins = useInspectorPins(chatRef);
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);

  useShortcut("toggleSidebar", () => togglePin(sidebarPinned, setSidebarPinned, sidebarRef));
  // Registered only once joined, so none of these act while the session is stale.
  useShortcut("run", run, { enabled: !scratchBusy && !problem.deleted });
  useShortcut("check", check, { enabled: !joined.running && !problem.deleted });
  useShortcut("toggleRunPanel", () => togglePin(outputPinned, setOutputPinned, outputRef));
  useShortcut("copyInviteLink", () => void copyInvite());
  // Spec 008's chat toggle, now the chat's pin (2026-11-12).
  useShortcut("toggleChat", () => togglePin(pins.chat.pinned, pins.chat.onPinnedChange, chatRef));

  // Starting either one shows its result: an unpinned results panel peeks, it is not pinned.
  function run() {
    if (!outputPinned) outputRef.current?.peek();
    onRun();
  }

  function check() {
    if (!outputPinned) outputRef.current?.peek();
    onCheck();
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setHud({ key: Date.now(), message: "Invite link copied" });
    } catch {
      setHud({ key: Date.now(), message: `Invite link: ${inviteLink}` });
    }
  }

  return (
    <ShortcutScope scope="session">
      <Window
        leftPanel={
          <PinnablePanel
            ref={sidebarRef}
            title="Sidebar"
            icon="sidebar"
            edge="left"
            pinned={sidebarPinned}
            onPinnedChange={setSidebarPinned}
          >
            <Sidebar label="Sidebar">
              <SidebarSection title="Problems">
                <ProblemList switcher={switcher} />
              </SidebarSection>
              <SidebarSection title="Participants">
                {joined.participants.length > 1 && <LiveBadge />}
                <PresenceList participants={joined.participants} />
              </SidebarSection>
            </Sidebar>
          </PinnablePanel>
        }
        toolbar={
          <AppHeader label="Session" stackNarrow>
            <h1 className={styles.title}>{problem.title}</h1>
            <Button
              variant="primary"
              size="xs"
              icon="play"
              busy={scratchBusy}
              busyLabel="Running"
              disabled={scratchBusy || problem.deleted}
              onClick={run}
            >
              <span className="app-header-pill-text">Run</span>
            </Button>
            <Button
              variant="bordered"
              size="xs"
              icon="checkmark"
              busy={joined.running}
              busyLabel="Checking"
              disabled={joined.running || problem.deleted}
              onClick={check}
            >
              <span className="app-header-pill-text">Check</span>
            </Button>
            <HeaderButton icon="link" onClick={() => void copyInvite()}>
              Invite
            </HeaderButton>
          </AppHeader>
        }
        inspector={
          <SessionInspector
            descriptionHtml={problem.description_html}
            chatVisible={pins.chat.pinned}
            chat={chatProps(chat, gifs)}
            pins={pins}
            // Pinned beside pinned run results, the chat's bar lines up with theirs.
            chatHeight={outputPinned ? RESULTS_HEIGHT_PX : undefined}
            hints={
              <HintsPanel
                hints={hintsFor(joined.hints, problem.id)}
                canAsk={joined.hintsEnabled && !problem.deleted}
                pending={joined.hintPending}
                notice={joined.hintNotice}
                onAsk={(note) => provider.send({ type: "hint_request", note })}
              />
            }
          />
        }
        bottomPanel={
          <PinnablePanel
            ref={outputRef}
            title="Run results"
            icon="bottomPanel"
            edge="bottom"
            size={`${RESULTS_HEIGHT_PX}px`}
            region
            pinned={outputPinned}
            onPinnedChange={setOutputPinned}
            actions={
              <div className={styles.resultsTabs}>
                <Tabs
                  tabs={RESULTS_TABS}
                  value={joined.resultsTab}
                  onChange={(id) => onResultsTab(id as ResultsTab)}
                  label="Results"
                />
              </div>
            }
          >
            {/* Each tab panel scrolls itself and is a keyboard stop, as tab panels are. */}
            {joined.resultsTab === "output" ? (
              <div
                role="tabpanel"
                aria-label="Output"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling tab panel is a keyboard stop (WAI-ARIA tabs).
                tabIndex={0}
                className={styles.results}
              >
                {problem.deleted && (
                  <InlineMessage id="output-deleted" tone="info">
                    This problem has been deleted.
                  </InlineMessage>
                )}
                <ScratchPanel state={joined.scratch} />
              </div>
            ) : (
              <div
                role="tabpanel"
                aria-label="Tests"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling tab panel is a keyboard stop (WAI-ARIA tabs).
                tabIndex={0}
                className={styles.results}
              >
                <RunPanel
                  running={joined.running}
                  deleted={problem.deleted}
                  progress={joined.progress[problem.id] ?? NO_PROGRESS}
                  notice={joined.notice}
                  onRun={check}
                  showRunButton={false}
                />
              </div>
            )}
          </PinnablePanel>
        }
      >
        <div className={styles.main}>
          <div className={styles.editor}>
            <CodeEditor doc={provider.doc} awareness={provider.awareness} problemId={problem.id} />
          </div>
        </div>
      </Window>
      {hud && <Hud key={hud.key} message={hud.message} />}
    </ShortcutScope>
  );
}

/** ChatPane's props from the session's chat; `gifs` is left out while the session is stale (spec 007). */
function chatProps(chat: Chat, gifs?: ChatGifs): ChatPaneProps {
  return {
    messages: chat.messages,
    readOnly: chat.readOnly,
    send: chat.send,
    canRemove: chat.canRemove,
    remove: chat.remove,
    gifs,
  };
}

/** Shortcut on a panel's pin: pins an unpinned panel; unpins a pinned one, leaving it peeking. */
function togglePin(
  pinned: boolean,
  setPinned: (pinned: boolean) => void,
  ref: { current: PinnablePanelHandle | null },
): void {
  setPinned(!pinned);
  if (pinned) ref.current?.peek();
}

/** True on a phone-sized screen, read once when the window mounts. */
function startsNarrow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 40rem)").matches;
}

/**
 * The description's and chat's pins (spec 008, 2026-11-12). The chat's is its remembered
 * visibility. Both start pinned, except on a phone, where they would cover the editor: there
 * they start unpinned unless this browser already chose.
 */
function useInspectorPins(chatRef?: PanelPin["handle"]): { description: PanelPin; chat: PanelPin } {
  const [narrow] = useState(startsNarrow);
  const [descriptionPinned, setDescriptionPinned] = usePinned("description", !narrow);
  const [chatPinned, setChatPinned] = useChatPinned(!narrow);
  return {
    description: { pinned: descriptionPinned, onPinnedChange: setDescriptionPinned },
    chat: { pinned: chatPinned, onPinnedChange: setChatPinned, handle: chatRef },
  };
}
