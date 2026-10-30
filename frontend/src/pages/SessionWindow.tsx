import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";
import { ApiError, getSession, reactivateSession } from "../api/client";
import type { Participant, Problem, ProblemProgress, WsErrorCode } from "../api/types";
import { BASE } from "../base";
import { useChat } from "../chat/useChat";
import { type ClosedEvent, CollabProvider, type SocketFactory } from "../collab/provider";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { ChatPane } from "../components/ChatPane";
import { CodeEditor } from "../components/CodeEditor";
import { DescriptionPane } from "../components/DescriptionPane";
import { editorTheme } from "../components/editorTheme";
import { PresenceList } from "../components/PresenceList";
import { ProblemSourceList } from "../components/ProblemSourceList";
import { RunPanel } from "../components/RunPanel";
import { ShortcutScope, useShortcut } from "../shortcuts/useShortcut";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Hud } from "../ui/Hud";
import { InlineMessage } from "../ui/InlineMessage";
import { BottomPanel, Inspector } from "../ui/Panels";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { TextField } from "../ui/TextField";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import { NotFound } from "./NotFound";
import styles from "./SessionWindow.module.css";

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "stale"; canReactivate: boolean }
  | { kind: "ready" }
  | { kind: "error" };

const CLOSE_MESSAGES: Record<ClosedEvent["error"], string> = {
  session_full: "This session is full (5 participants max).",
  invalid_name: "That name was refused by the server.",
  not_found: "Session not found.",
  stale: "This session has gone stale.",
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
type InspectorTab = "description" | "chat";

/** Everything shown once joined, kept current from the session's messages. */
interface Joined {
  participants: Participant[];
  problem: Problem;
  /** Accepted status and last run per problem this session has used (FR-17, FR-28). */
  progress: Record<string, ProblemProgress>;
  running: boolean;
  notice: string | null;
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
        } else if (err instanceof ApiError && err.error.kind === "stale") {
          setPage({ kind: "stale", canReactivate: err.error.canReactivate });
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
    const provider = new CollabProvider({ inviteId: invite, name: name.trim(), createSocket });
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
      });
    });
    provider.on("presence", (msg) => update(() => ({ participants: msg.participants })));
    provider.on("problem_switched", (msg) =>
      update((prev) => ({
        problem: msg.problem,
        progress: { ...prev.progress, [msg.problem.id]: msg.state },
        notice: null,
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
    provider.on("closed", (ev) => {
      providerRef.current = null;
      setProvider(null);
      setJoined(null);
      setNameError(CLOSE_MESSAGES[ev.error]);
    });
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
      <JoinedWindow
        provider={provider}
        joined={joined}
        chat={chat}
        inviteLink={inviteLink}
        onRun={run}
      />
    );
  }

  if (page.kind === "stale") {
    return (
      <StaleWindow
        canReactivate={page.canReactivate}
        error={reactivateError}
        chat={chat}
        onReactivate={() => void reactivate()}
      />
    );
  }

  let body: ReactNode;
  if (page.kind === "loading") {
    body = <p className={styles.loading}>Loading…</p>;
  } else if (page.kind === "error") {
    body = (
      <EmptyState icon="exclamation" title="Could not load this session">
        <span role="alert">Could not load this session.</span>
      </EmptyState>
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
          <Toolbar label="Session">
            <span className={styles.spacer} />
            <AppearanceControl />
            <AccountControl />
          </Toolbar>
        }
      >
        {body}
      </Window>
      {hud && <Hud key={hud.key} message={hud.message} />}
    </>
  );
}

interface StaleProps {
  canReactivate: boolean;
  error: string | null;
  chat: Chat;
  onReactivate(): void;
}

/**
 * A stale session (spec 003 FR-12, AC-13): a calm banner under the toolbar, with
 * Reactivate beside the notice for admins, and the editor and Run visibly disabled.
 */
function StaleWindow({ canReactivate, error, chat, onReactivate }: StaleProps) {
  return (
    <Window
      inspector={
        // The history stays readable; only sending is unavailable (spec 002 FR16).
        <Inspector open label="Inspector">
          <InspectorTabs tab="chat" onTab={() => undefined} chat={chat} />
        </Inspector>
      }
      toolbar={
        <Toolbar label="Session">
          <h1 className={styles.title}>Stale session</h1>
          <span className={styles.spacer} />
          <Button variant="primary" icon="play" disabled>
            Run
          </Button>
          <AppearanceControl />
          <AccountControl />
        </Toolbar>
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
  inviteLink: string;
  onRun(): void;
}

function JoinedWindow({ provider, joined, chat, inviteLink, onRun: run }: JoinedProps) {
  const { problem } = joined;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [runPanelOpen, setRunPanelOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("description");
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);

  useShortcut("toggleSidebar", () => setSidebarOpen((open) => !open));
  // Registered only once joined, so none of these act while the session is stale.
  useShortcut("run", run, { enabled: !joined.running && !problem.deleted });
  useShortcut("toggleRunPanel", () => setRunPanelOpen((open) => !open));
  useShortcut("copyInviteLink", () => void copyInvite());
  // Shows the chat; hides the inspector when the chat is what it is showing.
  useShortcut("toggleChat", () => {
    if (inspectorOpen && inspectorTab === "chat") {
      setInspectorOpen(false);
    } else {
      setInspectorOpen(true);
      setInspectorTab("chat");
    }
  });

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
              <ProblemSourceList provider={provider} currentProblemId={problem.id} />
            </SidebarSection>
            <SidebarSection title="Participants">
              <PresenceList participants={joined.participants} />
            </SidebarSection>
          </Sidebar>
        }
        toolbar={
          <Toolbar label="Session">
            <Button
              variant="plain"
              icon="sidebar"
              label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            />
            <h1 className={styles.title}>{problem.title}</h1>
            <span className={styles.spacer} />
            <Button
              variant="primary"
              icon="play"
              busy={joined.running}
              busyLabel="Running"
              disabled={joined.running || problem.deleted}
              onClick={run}
            >
              Run
            </Button>
            <Button variant="plain" icon="link" onClick={() => void copyInvite()}>
              Invite
            </Button>
            <Button
              variant="plain"
              icon="bottomPanel"
              label={runPanelOpen ? "Hide run results" : "Show run results"}
              aria-pressed={runPanelOpen}
              onClick={() => setRunPanelOpen((open) => !open)}
            />
            <Button
              variant="plain"
              icon="inspector"
              label={inspectorOpen ? "Hide inspector" : "Show inspector"}
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            />
            <AppearanceControl />
            <AccountControl />
          </Toolbar>
        }
        inspector={
          <Inspector open={inspectorOpen} label="Inspector">
            <InspectorTabs
              tab={inspectorTab}
              onTab={setInspectorTab}
              descriptionHtml={problem.description_html}
              chat={chat}
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

const TAB_LABELS: Record<InspectorTab, string> = { description: "Description", chat: "Chat" };

interface InspectorTabsProps {
  tab: InspectorTab;
  onTab(tab: InspectorTab): void;
  /** Without it there is no Description tab, as in a stale session. */
  descriptionHtml?: string;
  chat: Chat;
}

/**
 * The inspector's tabs (spec 003 plan, Window structure): Description and Chat. The arrow
 * keys move between them, as in the WAI-ARIA tabs pattern (FR-21).
 */
function InspectorTabs({ tab, onTab, descriptionHtml, chat }: InspectorTabsProps) {
  const id = useId();
  const tabs: InspectorTab[] = descriptionHtml === undefined ? ["chat"] : ["description", "chat"];
  const selected = tabs.includes(tab) ? tab : "chat";

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(selected) + step + tabs.length) % tabs.length] ?? selected;
    onTab(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label="Inspector" className={styles.tabs} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-${t}-tab`}
            aria-selected={t === selected}
            aria-controls={`${id}-${t}`}
            tabIndex={t === selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-${selected}`}
        aria-labelledby={`${id}-${selected}-tab`}
        className={styles.tabPanel}
      >
        {selected === "description" && descriptionHtml !== undefined ? (
          <DescriptionPane html={descriptionHtml} />
        ) : (
          <ChatPane
            messages={chat.messages}
            readOnly={chat.readOnly}
            send={chat.send}
            canRemove={chat.canRemove}
            remove={chat.remove}
          />
        )}
      </div>
    </>
  );
}
