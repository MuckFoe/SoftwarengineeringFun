import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";
import type { ChatMessage } from "../api/types";
import { useMe } from "../auth/useMe";
import { apiPath } from "../base";
import { type SendResult, useChat } from "../chat/useChat";
import { ChatPane } from "../components/ChatPane";
import { PresenceList } from "../components/PresenceList";
import { NotFound } from "../pages/NotFound";
import { AppHeader } from "../ui/AppHeader";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Hud } from "../ui/Hud";
import { InlineMessage } from "../ui/InlineMessage";
import { Inspector } from "../ui/Panels";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { TextField } from "../ui/TextField";
import { Window } from "../ui/Window";
import { CompletionSummary } from "./CompletionSummary";
import styles from "./LearningSessionWindow.module.css";
import {
  type LearnCloseError,
  type LearnEvents,
  LearnSocket,
  type SocketFactory,
} from "./learnSocket";
import { initialLearnState, type LearnAction, type LearnState, learnReducer } from "./learnState";
import type { LearnClientMessage, LearningRecord, LearnServerMessage } from "./learnTypes";
import { StepView } from "./StepView";

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "stale"; canReactivate: boolean }
  | { kind: "ready" }
  | { kind: "error" };

const CLOSE_MESSAGES: Record<LearnCloseError, string> = {
  full: "This session is full (5 participants max).",
  invalid_name: "That name was refused by the server.",
  not_found: "Session not found.",
  stale: "This session has gone stale.",
  replaced: "This session was opened in another tab or window.",
  disconnected: "Disconnected from the session.",
};

/** The server messages that change the lesson state (chat is useChat's). */
const LESSON_MESSAGES = [
  "welcome",
  "presence",
  "attempt",
  "hint_revealed",
  "answer_revealed",
  "step_passed",
  "completed",
  "error",
] as const satisfies readonly LearnServerMessage["type"][];

type Action = LearnAction | { type: "reset" };

function reducer(state: LearnState, action: Action): LearnState {
  return action.type === "reset" ? initialLearnState : learnReducer(state, action);
}

/** Same rule as joining a coding session (FR-7). */
function nameProblem(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 30) {
    return "Enter a name from 1 to 30 characters.";
  }
  return null;
}

/** Learn REST (plan.md "REST"); the caller reads the status. */
function learnFetch(method: string, path: string): Promise<Response> {
  return fetch(apiPath(`/learn/sessions/${path}`), { method, credentials: "same-origin" });
}

async function learnJson<T>(path: string): Promise<T> {
  const res = await learnFetch("GET", path);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return (await res.json()) as T;
}

interface Props {
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: SocketFactory;
}

/**
 * A learning session (spec 006 FR-7–FR-10, FR-15, FR-24, FR-26, FR-27, FR-29): the name
 * prompt, then the step list, the step being looked at, who is connected and the chat. A
 * stale session shows its record and chat read-only, with Reactivate for admins, as a
 * coding session does. Signed in, there is no name prompt: it joins as the account
 * (spec 012 FR-1, FR-3, FR-14); signed out it asks for a name as before (FR-6). A
 * connection replaced by a newer one (`4409`) stops and offers *Use here* (FR-5).
 */
export function LearningSessionWindow({ createSocket }: Props) {
  const { invite = "" } = useParams();
  const enc = encodeURIComponent(invite);
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);
  const [state, dispatch] = useReducer(reducer, initialLearnState);
  const socketRef = useRef<LearnSocket | null>(null);
  // State as well as the ref, so useChat subscribes before the welcome (and its history) arrives.
  const [socket, setSocket] = useState<LearnSocket | null>(null);
  const [staleChat, setStaleChat] = useState<ChatMessage[]>([]);
  // A stale session has no socket, so useChat (whose REST is the coding session's) stays live.
  const chat = useChat({ invite, provider: socket, stale: false });
  const me = useMe();
  const signedIn = me.status === "ready" && me.me.signed_in;
  // Why the last connection ended, when it isn't the name prompt's to say (signed in, or
  // replaced). While set, nothing reconnects by itself.
  const [closed, setClosed] = useState<LearnCloseError | null>(null);
  // The name the last anonymous join used, so *Use here* rejoins as the same person.
  const lastName = useRef<string | null>(null);

  /** Opens the socket: `name` null joins as the signed-in account. */
  const connect = useCallback(
    (asName: string | null) => {
      const next = new LearnSocket({ invite, name: asName, createSocket });
      socketRef.current = next;
      setSocket(next);
      for (const type of LESSON_MESSAGES) {
        next.on(type, (msg: LearnEvents[typeof type]) => dispatch(msg as LearnAction));
      }
      next.on("closed", (ev) => {
        socketRef.current = null;
        setSocket(null);
        dispatch({ type: "reset" });
        if (asName === null || ev.error === "replaced") setClosed(ev.error);
        else setNameError(CLOSE_MESSAGES[ev.error]);
      });
    },
    [invite, createSocket],
  );

  // Signed in: join as soon as the session is known to be live, without a prompt.
  useEffect(() => {
    if (!invite || !signedIn || page.kind !== "ready" || closed !== null) return;
    if (socketRef.current) return;
    connect(null);
  }, [invite, signedIn, page.kind, closed, connect]);

  function takeOver() {
    setClosed(null);
    setNameError(null);
    if (!socketRef.current) connect(signedIn ? null : lastName.current);
  }

  useEffect(() => {
    if (!invite) return;
    let current = true;
    learnFetch("GET", enc).then(
      async (res) => {
        if (!current) return;
        if (res.ok) setPage({ kind: "ready" });
        else if (res.status === 404) setPage({ kind: "not_found" });
        else if (res.status === 423) {
          const body = (await res.json().catch(() => ({}))) as { can_reactivate?: boolean };
          if (current) setPage({ kind: "stale", canReactivate: body.can_reactivate === true });
        } else setPage({ kind: "error" });
      },
      () => {
        if (current) setPage({ kind: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [invite, enc]);

  // Stale: the read-only record and chat come from REST (plan "Frontend behaviour").
  const stale = page.kind === "stale";
  useEffect(() => {
    if (!stale) return;
    let current = true;
    learnJson<LearningRecord>(`${enc}/record`).then(
      (record) => {
        if (current) dispatch({ type: "welcome", you: { participant_id: "" }, record, chat: [] });
      },
      () => {
        if (current) setPage({ kind: "error" });
      },
    );
    learnJson<{ messages: ChatMessage[] }>(`${enc}/chat`).then(
      (history) => {
        if (current) setStaleChat(history.messages);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [stale, enc]);

  useEffect(() => {
    return () => socketRef.current?.destroy();
  }, []);

  const removeMessage = useCallback(
    async (id: number) => {
      const res = await learnFetch("DELETE", `${enc}/chat/${id}`);
      if (!res.ok && res.status !== 404) throw new Error(`DELETE chat: ${res.status}`);
      // Live sessions also get `chat_removed` over the socket.
      setStaleChat((messages) => messages.filter((m) => m.id !== id));
    },
    [enc],
  );

  async function reactivate() {
    setReactivateError(null);
    let res: Response | null = null;
    try {
      res = await learnFetch("POST", `${enc}/reactivate`);
    } catch {
      res = null;
    }
    // 409: it isn't stale any more, which is what reactivating was for.
    if (!res || !(res.ok || res.status === 409)) {
      setReactivateError("Could not reactivate this session.");
      return;
    }
    dispatch({ type: "reset" });
    setStaleChat([]);
    setClosed(null);
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
    lastName.current = name.trim();
    connect(lastName.current);
  }

  if (page.kind === "not_found") return <NotFound message="Session not found" />;

  const toolbarEnd = (
    <>
      <span className={styles.spacer} />
    </>
  );

  if (socket && state.lesson) {
    return (
      <>
        <SessionView
          state={state}
          dispatch={dispatch}
          readOnly={false}
          onSend={(message) => socket.send(message)}
          chat={
            <ChatPane
              messages={chat.messages}
              readOnly={false}
              send={chat.send}
              canRemove={chat.canRemove}
              remove={removeMessage}
            />
          }
          toolbarEnd={toolbarEnd}
        />
        {/* Signed in, reactivating joins at once (spec 012 FR-1): its Hud outlives the join. */}
        {hud && <Hud key={hud.key} message={hud.message} />}
      </>
    );
  }

  if (page.kind === "stale") {
    return (
      <SessionView
        state={state}
        dispatch={dispatch}
        readOnly
        onSend={() => undefined}
        chat={
          <ChatPane
            messages={staleChat}
            readOnly
            send={() => Promise.resolve<SendResult>("session_stale")}
            canRemove={chat.canRemove}
            remove={removeMessage}
          />
        }
        banner={
          <Banner
            tone="warning"
            actions={
              page.canReactivate && (
                <Button variant="secondary" onClick={() => void reactivate()}>
                  Reactivate
                </Button>
              )
            }
          >
            This session has gone stale, so nothing can be submitted.
            {reactivateError && (
              <InlineMessage id="reactivate-error">{reactivateError}</InlineMessage>
            )}
          </Banner>
        }
        toolbarEnd={toolbarEnd}
      />
    );
  }

  let body: ReactNode;
  if (page.kind === "loading" || (page.kind === "ready" && me.status === "loading")) {
    body = <p className={styles.loading}>Loading…</p>;
  } else if (page.kind === "error") {
    body = (
      <EmptyState icon="exclamation" title="Could not load this session">
        <span role="alert">Could not load this session.</span>
      </EmptyState>
    );
  } else if (closed !== null) {
    body = (
      <div className={styles.joinCard}>
        <h1 className={styles.joinTitle}>Learning session</h1>
        <InlineMessage id="join-closed">{CLOSE_MESSAGES[closed]}</InlineMessage>
        <div className={styles.joinActions}>
          <Button variant="primary" onClick={takeOver}>
            {closed === "replaced" ? "Use here" : "Try again"}
          </Button>
        </div>
      </div>
    );
  } else if (signedIn) {
    body = <p className={styles.loading}>Joining…</p>;
  } else {
    body = (
      <div className={styles.joinCard}>
        <h1 className={styles.joinTitle}>Join this learning session</h1>
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
      </div>
    );
  }

  return (
    <>
      <Window toolbar={<AppHeader label="Learning session">{toolbarEnd}</AppHeader>}>{body}</Window>
      {hud && <Hud key={hud.key} message={hud.message} />}
    </>
  );
}

interface SessionViewProps {
  state: LearnState;
  dispatch: Dispatch<Action>;
  /** Stale: every step read-only. */
  readOnly: boolean;
  onSend(message: LearnClientMessage): void;
  chat: ReactNode;
  banner?: ReactNode;
  toolbarEnd: ReactNode;
}

/**
 * The session window: areas, steps and participants in the sidebar, the step being looked
 * at (or the completion summary) in the main area, the chat in the inspector.
 */
function SessionView({
  state,
  dispatch,
  readOnly,
  onSend,
  chat,
  banner,
  toolbarEnd,
}: SessionViewProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const viewed = state.steps.find((s) => s.position === state.viewing);
  // Looking back, a completed session and a stale one submit nothing (FR-15, FR-26, FR-27).
  const stepReadOnly = readOnly || state.completed || state.viewing !== state.current;

  return (
    <Window
      sidebarOpen={sidebarOpen}
      sidebar={
        <Sidebar label="Sidebar">
          <SidebarSection title="Steps">
            <StepList state={state} dispatch={dispatch} />
          </SidebarSection>
          <SidebarSection title="Participants">
            <PresenceList participants={state.participants} />
          </SidebarSection>
        </Sidebar>
      }
      toolbar={
        <AppHeader label="Learning session">
          <Button
            variant="plain"
            icon="sidebar"
            label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          />
          <h1 className={styles.title}>{state.lesson?.title ?? "Learning session"}</h1>
          {toolbarEnd}
        </AppHeader>
      }
      banner={banner}
      inspector={
        <Inspector open label="Chat">
          {chat}
        </Inspector>
      }
    >
      <div className={styles.main}>
        {state.completed && state.summary && (
          <section className={styles.summary} aria-labelledby="learn-summary-title">
            <h2 id="learn-summary-title" className={styles.summaryTitle}>
              Lesson completed
            </h2>
            <CompletionSummary summary={state.summary} />
          </section>
        )}
        {viewed && <StepView step={viewed} readOnly={stepReadOnly} onSend={onSend} />}
      </div>
    </Window>
  );
}

/** Every lesson step: passed ones and the current one can be opened; later ones can't yet. */
function StepList({ state, dispatch }: { state: LearnState; dispatch: Dispatch<Action> }) {
  const steps = state.lesson?.steps ?? [];
  return (
    <ol aria-label="Steps" className={styles.steps}>
      {steps.map((s) => {
        const passed = state.passed.includes(s.position);
        const current = !state.completed && s.position === state.current;
        return (
          <li key={s.position}>
            <button
              type="button"
              className={styles.step}
              disabled={!passed && !current}
              aria-current={current ? "step" : undefined}
              aria-pressed={s.position === state.viewing}
              onClick={() => dispatch({ type: "view_step", position: s.position })}
            >
              <span className={styles.stepTitle}>{`${s.position + 1}. ${s.title}`}</span>
              {passed && <span className={styles.passed}> passed</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
