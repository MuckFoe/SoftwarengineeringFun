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
import { useChatVisible } from "../components/chatVisibility";
import { editorTheme } from "../components/editorTheme";
import { PresenceList } from "../components/PresenceList";
import { ProblemList, useProblemSwitcher } from "../components/ProblemSourceList";
import { RunPanel } from "../components/RunPanel";
import { type ChatPaneProps, SessionInspector } from "../components/SessionInspector";
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
import { BottomPanel, Inspector } from "../ui/Panels";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { TextField } from "../ui/TextField";
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

type Chat = ReturnType<typeof useChat>;

/** Everything shown once joined, kept current from the session's messages. */
interface Joined {
  participants: Participant[];
  problem: Problem;
  /** Accepted status and last run per problem this session has used (FR-17, FR-28). */
  progress: Record<string, ProblemProgress>;
  running: boolean;
  notice: string | null;
  /** The run with the session's own input (spec 011). */
  scratch: ScratchState;
  /** Every hint of the session, all problems (spec 020 FR-15); shown filtered to the current one. */
  hints: Hint[];
  /** A model is configured (spec 020 FR-1, FR-2). */
  hintsEnabled: boolean;
  /** A hint being prepared for the session (FR-5, FR-8, FR-14a). */
  hintPending: HintPending | null;
  hintNotice: HintNotice | null;
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
 * the main area, run results in the bottom panel, the description and chat in the
 * inspector, and Run, Invite and the panel toggles in the toolbar (FR-10, FR-14, FR-15,
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
      setJoined({
        participants: msg.presence,
        problem: msg.current_problem,
        progress: msg.problems,
        running: msg.run_in_progress,
        notice: null,
        scratch: { ...initialScratchState, run: msg.scratch_run ?? null },
        // Absent from older servers: no model, no hints (spec 020 contract).
        hints: msg.hints ?? [],
        hintsEnabled: msg.hints_enabled ?? false,
        hintPending: msg.hint_pending ?? null,
        hintNotice: null,
      });
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
    provider.on("scratch_run_started", (msg) => scratch({ type: "started", run: msg.run }));
    provider.on("scratch_run_output", (msg) =>
      scratch({ type: "output", seq: msg.seq, s: msg.s, t: msg.t }),
    );
    provider.on("scratch_run_end", (msg) =>
      scratch({ type: "end", status: msg.status, exit_code: msg.exit_code }),
    );
    provider.on("scratch_run_refused", (msg) =>
      scratch(
        msg.reason === "in_progress"
          ? { type: "refused", reason: "in_progress", by: msg.by }
          : { type: "refused", reason: "stale" },
      ),
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
    provider.on("run_started", () => update(() => ({ running: true, notice: null })));
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
    // Shown as running at once (spec 003 FR-3); run_started/run_finished confirm it.
    const run = () => {
      setJoined((prev) => (prev ? { ...prev, running: true, notice: null } : prev));
      provider.send({ type: "run" });
    };
    return (
      <>
        <JoinedWindow
          provider={provider}
          joined={joined}
          chat={chat}
          // GIF search only for a live session (spec 007 FR-1, FR-8); the stale page gets none.
          gifs={{ invite: invite ?? "", provider, sendGif: chat.sendGif }}
          inviteLink={inviteLink}
          onRun={run}
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
 * Reactivate beside the notice for admins, and the editor and Run visibly disabled.
 * The problem's description sits above the read-only chat once it has loaded; until
 * then, or if it can't be loaded, the chat fills the side area alone (spec 008 FR-9).
 */
function StaleWindow({ invite, canReactivate, problemId, error, chat, onReactivate }: StaleProps) {
  const [descriptionHtml, setDescriptionHtml] = useState<string | undefined>(undefined);
  const [hints, setHints] = useState<Hint[]>([]);
  const [chatVisible, setChatVisible] = useChatVisible();

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
        <Inspector open label="Inspector">
          <SessionInspector
            descriptionHtml={descriptionHtml}
            chatVisible={chatVisible}
            chat={chatProps(chat)}
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
        </Inspector>
      }
      toolbar={
        <AppHeader label="Session" stackNarrow>
          <h1 className={styles.title}>Stale session</h1>
          <span className={styles.spacer} />
          <Button variant="primary" size="xs" icon="play" disabled>
            <span className="app-header-pill-text">Run</span>
          </Button>
          {/* No inspector toggle here, so the chat toggle alone (spec 008 FR-2, FR-4). */}
          <Button
            variant="plain"
            icon="chat"
            label={chatVisible ? "Hide chat" : "Show chat"}
            aria-pressed={chatVisible}
            onClick={() => setChatVisible(!chatVisible)}
          />
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
  onRun(): void;
}

function JoinedWindow({ provider, joined, chat, gifs, inviteLink, onRun: run }: JoinedProps) {
  const { problem } = joined;
  // The sidebar (problems, participants) starts closed: the editor gets the room, and the
  // sidebar toggle or its shortcut opens it.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const switcher = useProblemSwitcher(provider, problem.id);
  const [runPanelOpen, setRunPanelOpen] = useState(true);
  const [scratchOpen, setScratchOpen] = useState(false);
  // On a phone the inspector would cover the editor, so it starts closed there.
  const [inspectorOpen, setInspectorOpen] = useState(
    () =>
      typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 40rem)").matches,
  );
  const [chatVisible, setChatVisible] = useChatVisible();
  const chatOnScreen = inspectorOpen && chatVisible;
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);

  useShortcut("toggleSidebar", () => setSidebarOpen((open) => !open));
  // Registered only once joined, so none of these act while the session is stale.
  useShortcut("run", run, { enabled: !joined.running && !problem.deleted });
  useShortcut("toggleRunPanel", () => setRunPanelOpen((open) => !open));
  useShortcut("copyInviteLink", () => void copyInvite());
  useShortcut("toggleChat", toggleChat);

  /**
   * Hides the chat when it is on screen (FR-2); otherwise shows it, opening the inspector
   * if needed (FR-3). Remembered per browser (FR-4); `inspectorOpen` is not (FR-6).
   */
  function toggleChat() {
    if (chatOnScreen) {
      setChatVisible(false);
    } else {
      setChatVisible(true);
      setInspectorOpen(true);
    }
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
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar label="Sidebar">
            <SidebarSection title="Problems">
              <ProblemList switcher={switcher} />
            </SidebarSection>
            <SidebarSection title="Participants">
              {joined.participants.length > 1 && <LiveBadge />}
              <PresenceList participants={joined.participants} />
            </SidebarSection>
          </Sidebar>
        }
        toolbar={
          <AppHeader
            label="Session"
            stackNarrow
            actions={
              // The view toggles, one quiet group at the right, so the left keeps the title.
              <div className="app-header-group" role="group" aria-label="View">
                <HeaderButton
                  icon="sidebar"
                  label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                  aria-pressed={sidebarOpen}
                  onClick={() => setSidebarOpen((open) => !open)}
                />
                <HeaderButton
                  icon="bottomPanel"
                  label={runPanelOpen ? "Hide run results" : "Show run results"}
                  aria-pressed={runPanelOpen}
                  onClick={() => setRunPanelOpen((open) => !open)}
                />
                <HeaderButton
                  icon="pencil"
                  label={scratchOpen ? "Hide own-input run" : "Show own-input run"}
                  aria-pressed={scratchOpen}
                  onClick={() => setScratchOpen((open) => !open)}
                />
                <HeaderButton
                  icon="inspector"
                  label={inspectorOpen ? "Hide inspector" : "Show inspector"}
                  aria-pressed={inspectorOpen}
                  onClick={() => setInspectorOpen((open) => !open)}
                />
                <HeaderButton
                  icon="chat"
                  label={chatOnScreen ? "Hide chat" : "Show chat"}
                  aria-pressed={chatOnScreen}
                  onClick={toggleChat}
                />
              </div>
            }
          >
            <h1 className={styles.title}>{problem.title}</h1>
            <Button
              variant="primary"
              size="xs"
              icon="play"
              busy={joined.running}
              busyLabel="Running"
              disabled={joined.running || problem.deleted}
              onClick={run}
            >
              <span className="app-header-pill-text">Run</span>
            </Button>
            <HeaderButton icon="link" onClick={() => void copyInvite()}>
              Invite
            </HeaderButton>
          </AppHeader>
        }
        inspector={
          <Inspector open={inspectorOpen} label="Inspector">
            <SessionInspector
              descriptionHtml={problem.description_html}
              chatVisible={chatVisible}
              chat={chatProps(chat, gifs)}
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
          </Inspector>
        }
        bottomPanel={
          <BottomPanel open={runPanelOpen} label="Run results">
            <RunPanel
              running={joined.running}
              deleted={problem.deleted}
              progress={joined.progress[problem.id] ?? NO_PROGRESS}
              notice={joined.notice}
              onRun={run}
              showRunButton={false}
            />
            {scratchOpen && (
              <ScratchPanel
                state={joined.scratch}
                stale={false}
                onRun={(input) => provider.send({ type: "scratch_run", input })}
              />
            )}
          </BottomPanel>
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
