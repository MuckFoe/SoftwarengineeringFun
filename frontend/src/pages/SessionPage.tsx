import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import { ApiError, getSession, reactivateSession } from "../api/client";
import type { Participant, Problem, ProblemProgress, WsErrorCode } from "../api/types";
import { type ClosedEvent, CollabProvider, type SocketFactory } from "../collab/provider";
import { CodeEditor } from "../components/CodeEditor";
import { PresenceList } from "../components/PresenceList";
import { ProblemSwitcher } from "../components/ProblemSwitcher";
import { RunPanel } from "../components/RunPanel";
import { NotFound } from "./NotFound";

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
 * session itself: its problem, editor, runs and switching (FR-10, FR-17, FR-26, FR-28).
 */
export function SessionPage({ createSocket }: Props) {
  const { invite } = useParams();
  const location = useLocation();
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const providerRef = useRef<CollabProvider | null>(null);

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
    await reactivateSession(invite).catch(() => undefined);
    setPage({ kind: "ready" });
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
      })),
    );
    provider.on("closed", (ev) => {
      providerRef.current = null;
      setJoined(null);
      setNameError(CLOSE_MESSAGES[ev.error]);
    });
  }

  if (page.kind === "loading") return <p>Loading…</p>;
  if (page.kind === "not_found") return <NotFound message="Session not found" />;
  if (page.kind === "error") return <p role="alert">Could not load this session.</p>;
  if (page.kind === "stale") {
    return (
      <section>
        <p>This session has gone stale.</p>
        {page.canReactivate && (
          <button type="button" onClick={() => void reactivate()}>
            Reactivate
          </button>
        )}
      </section>
    );
  }

  const inviteLink = (
    <p>
      Invite link:{" "}
      <input
        readOnly
        value={new URL(location.pathname, window.location.origin).toString()}
        aria-label="Invite link"
      />
    </p>
  );

  if (joined && providerRef.current) {
    const provider = providerRef.current;
    const { problem } = joined;
    return (
      <section>
        {inviteLink}
        <PresenceList participants={joined.participants} />
        <h2>{problem.title}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{problem.description}</p>
        <CodeEditor doc={provider.doc} awareness={provider.awareness} problemId={problem.id} />
        <RunPanel
          running={joined.running}
          deleted={problem.deleted}
          progress={joined.progress[problem.id] ?? NO_PROGRESS}
          notice={joined.notice}
          onRun={() => provider.send({ type: "run" })}
        />
        <ProblemSwitcher provider={provider} />
      </section>
    );
  }

  return (
    <section>
      {inviteLink}
      <form onSubmit={join}>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Join</button>
      </form>
      {nameError && <p role="alert">{nameError}</p>}
    </section>
  );
}
