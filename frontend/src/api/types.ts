// Wire types for spec 001, mirroring plan.md "Contracts" exactly.
// Ids are uuids (plan data model), so they travel as strings.

import type { Run, RunStatus } from "../scratch/scratchReducer";

// ---- HTTP ----

/** An account's stored preferences (spec 012 FR-15). */
export interface Preferences {
  appearance: "light" | "dark" | "system";
  chat_visible: boolean;
}

/** GET /api/me. `preferences` is `null` until the account first stores any (spec 012 FR-16). */
export type Me =
  | { signed_in: false; roles: [] }
  | { signed_in: true; name: string; roles: string[]; preferences: Preferences | null };

/** One row of GET /api/me/sessions (spec 012 FR-2), newest activity first. */
export interface RecentSession {
  kind: "coding" | "learning" | "presentation" | "chess";
  invite_id: string;
  title: string;
  last_activity_at: string;
  stale: boolean;
  hosted_by_me: boolean;
  /** Spec 016: at least one participant is connected now. Always sent by the API. */
  live?: boolean;
  /** Spec 019: the viewer may delete this session (its host, or an admin). */
  can_delete: boolean;
}

export interface ProblemSummary {
  id: string;
  title: string;
  is_starter: boolean;
  /** Spec 018: one of the fixed category ids, or null when unset. */
  category?: string | null;
  difficulty?: Difficulty | null;
}

export type Difficulty = "easy" | "medium" | "hard";

/** GET /api/problems/categories (spec 018), in catalogue order. */
export interface ProblemCategory {
  id: string;
  label: string;
}

/** A problem as everyone sees it. Never carries tests. */
export interface Problem {
  id: string;
  title: string;
  /** Markdown source (spec 002). */
  description: string;
  /** The description rendered by the server; safe to insert as HTML (spec 002). */
  description_html: string;
  signature: string;
  deleted: boolean;
}

export interface ProblemTest {
  args: unknown[];
  expected: unknown;
}

/** Editor-only: the body of POST/PUT /api/problems. */
export interface ProblemInput {
  title: string;
  description: string;
  signature: string;
  tests: ProblemTest[];
  /** Spec 018: omitted leaves the stored value unchanged. */
  category?: string | null;
  difficulty?: Difficulty | null;
}

/** Editor-only: GET /api/problems/{id}/edit. */
export type EditableProblem = ProblemInput & { id: string };

export interface FieldError {
  field: string;
  test_index?: number;
  message: string;
}

export interface CreatedProblem {
  id: string;
}

export interface CreatedSession {
  invite_id: string;
}

export interface SessionState {
  state: "active";
}

/** POST /api/images (spec 002). */
export interface UploadedImage {
  id: string;
  url: string;
}

/** POST /api/problems/preview (spec 002). */
export interface DescriptionPreview {
  html: string;
}

/** One GIF from GIF search (spec 007). Media URLs are GIPHY's; no GIF file is stored. */
export interface GifResult {
  id: string;
  title: string;
  url: string;
  still_url: string;
  width: number;
  height: number;
}

/** A text chat message (spec 002). `sent_at` is ISO-8601 UTC. `kind` absent = text (006). */
export interface TextChatMessage {
  id: number;
  sender_name: string;
  /** The sender's participant (spec 012 FR-3). */
  participant_id: string;
  /** Whether the sender was signed in (spec 012 FR-8). */
  signed_in: boolean;
  sent_at: string;
  kind?: "text";
  text: string;
}

/** A GIF chat message (spec 007). */
export interface GifChatMessage {
  id: number;
  sender_name: string;
  /** The sender's participant (spec 012 FR-3). */
  participant_id: string;
  /** Whether the sender was signed in (spec 012 FR-8). */
  signed_in: boolean;
  sent_at: string;
  kind: "gif";
  gif: GifResult;
}

/** One chat message: text (spec 002) or GIF (spec 007). */
export type ChatMessage = TextChatMessage | GifChatMessage;

/** GET /api/sessions/{invite}/chat (spec 002). */
export interface ChatHistory {
  messages: ChatMessage[];
  read_only: boolean;
}

// Error bodies.
export interface MissingRoleBody {
  error: "missing_role";
  role: string;
}
export interface ValidationBody {
  errors: FieldError[];
}
export interface NotFoundBody {
  error: "not_found";
}
export interface StaleBody {
  error: "stale";
  can_reactivate: boolean;
  /** The session's current problem (spec 008), so a stale session can still show its description. */
  problem_id: string;
}
export interface ImageTooLargeBody {
  error: "image_too_large";
  limit_bytes: number;
}
export interface ImageFormatBody {
  error: "image_format";
  accepted: string[];
}
/** 422 on saving a problem whose description is refused (spec 002). */
export type DescriptionErrorCode =
  | "description_required"
  | "too_many_images"
  | "image_not_found"
  | "image_source_not_allowed";
export interface DescriptionErrorBody {
  error: DescriptionErrorCode;
  limit?: number;
  id?: string;
}

// ---- WebSocket ----

export const WS_CLOSE = {
  notFound: 4404,
  stale: 4410,
  full: 4403,
  invalidName: 4422,
  /** Spec 012 FR-5: this participant connected again elsewhere; the older socket is closed. */
  replaced: 4409,
} as const;

export type Outcome =
  | "passed"
  | "wrong_answer"
  | "error"
  | "time_limit_exceeded"
  | "memory_limit_exceeded";

/** One test's outcome. Never args, expected, the returned value or stdout. */
export interface TestResult {
  position: number;
  outcome: Outcome;
  error_message?: string;
  traceback?: string;
}

export interface RunResult {
  run_id: string;
  problem_id: string;
  accepted: boolean;
  results: TestResult[];
  /** Spec 016 FR-17. Only on `run_finished`; absent or null when not measured. */
  duration_ms?: number | null;
  memory_kb?: number | null;
  /** Also on `last_run` after a reload. */
  examples_passed?: number | null;
  examples_total?: number | null;
}

export interface Participant {
  id: string;
  name: string;
  /** Joined with an account (spec 012 FR-8). */
  signed_in: boolean;
}

/** `welcome.you` (spec 012): who this socket joined as. */
export interface You {
  participant_id: string;
  name: string;
  signed_in: boolean;
}

export interface ProblemProgress {
  accepted: boolean;
  last_run?: RunResult;
}

export type WsErrorCode =
  | "run_in_progress"
  | "problem_deleted"
  | "problem_not_found"
  | "session_full"
  | "stale"
  | "invalid_name"
  | ChatErrorCode
  | GifErrorCode;

/** Refusals of a `chat_send`, answered to the sender only (spec 002). */
export type ChatErrorCode = "chat_empty" | "chat_too_long" | "session_stale";

/** Refusals of a `gif_search` or `chat_send_gif`, answered to the sender only (spec 007). */
export type GifErrorCode = "gif_unavailable" | "gif_rate_limited" | "gif_not_allowed";

export interface WelcomeMessage {
  type: "welcome";
  participant_id: string;
  you: You;
  current_problem: Problem;
  problems: Record<string, ProblemProgress>;
  presence: Participant[];
  run_in_progress: boolean;
  /** The session's chat history, in id order (spec 002). */
  chat: ChatMessage[];
  /** The session's latest run with its own input, or null (spec 011). Absent from older servers. */
  scratch_run?: Run | null;
  /** A model is configured (spec 020 FR-1, FR-2). Absent from older servers: treat as false. */
  hints_enabled?: boolean;
  /** Every hint of this session, all problems, by (problem, number) (spec 020). Absent: []. */
  hints?: Hint[];
  /** A hint being prepared, for late joiners (spec 020 FR-8). Absent: null. */
  hint_pending?: HintPending | null;
}

export interface PresenceMessage {
  type: "presence";
  participants: Participant[];
}

export interface ProblemSwitchedMessage {
  type: "problem_switched";
  problem: Problem;
  by: string;
  /** This session's progress on the problem switched to (FR-17). */
  state: ProblemProgress;
}

export interface ProblemDeletedMessage {
  type: "problem_deleted";
  problem_id: string;
}

export interface RunStartedMessage {
  type: "run_started";
  run_id: string;
  by: string;
}

export interface RunFinishedMessage {
  type: "run_finished";
  run: RunResult;
}

/** A run that ended without results (the runner failed); everyone saw it start. */
export interface RunFailedMessage {
  type: "run_failed";
  run_id: string;
  reason: "infra_error";
}

export interface ErrorMessage {
  type: "error";
  code: WsErrorCode;
  /** On chat refusals: the `client_id` of the refused `chat_send` (spec 002). */
  client_id?: string;
  /** On `chat_too_long`: the limit in characters. */
  limit?: number;
  /** On GIF search refusals: the `request_id` of the refused `gif_search` (spec 007). */
  request_id?: string;
  /** On `gif_rate_limited`: whole seconds to wait, at least 1 (spec 007). */
  retry_after?: number;
}

/** A chat message to everyone in the session, the sender included (spec 002). */
export interface ChatMessageFrame {
  type: "chat_message";
  message: ChatMessage;
  client_id: string;
}

/** An admin removed a message (spec 002 FR19). */
export interface ChatRemovedMessage {
  type: "chat_removed";
  id: number;
}

/** GIF search results, to the searcher only (spec 007). Up to 24; `[]` when nothing matches. */
export interface GifResultsMessage {
  type: "gif_results";
  request_id: string;
  trending: boolean;
  results: GifResult[];
}

export type { Run, RunStatus, Segment } from "../scratch/scratchReducer";

/** A run with its own input began (spec 011); `run` is the snapshot so far. */
export interface ScratchRunStartedMessage {
  type: "scratch_run_started";
  run: Run;
}

/** Output of the run, `seq` being the byte offset of `t` in the output so far (spec 011). */
export interface ScratchRunOutputMessage {
  type: "scratch_run_output";
  seq: number;
  s: "out" | "err";
  t: string;
}

export interface ScratchRunEndMessage {
  type: "scratch_run_end";
  status: RunStatus;
  exit_code: number | null;
}

/** A `scratch_run` that did not start, to the sender only (spec 011 FR-9, FR-12). */
export type ScratchRunRefusedMessage =
  | { type: "scratch_run_refused"; reason: "in_progress"; by: string }
  | { type: "scratch_run_refused"; reason: "stale" };

/** A model-generated hint on one problem of the session (spec 020 FR-6, FR-15). */
export interface Hint {
  id: string;
  problem_id: string;
  /** Numbered within the problem, from 1. */
  number: number;
  asked_by: string;
  note: string | null;
  body: string;
  created_at: string;
}

/** A hint being prepared (spec 020 FR-5, FR-8); `warming` once `hint_warming` was sent (FR-14a). */
export interface HintPending {
  problem_id: string;
  by: string;
  note: string | null;
  warming: boolean;
}

/** Someone asked for a hint; broadcast (spec 020 FR-5). */
export interface HintStartedMessage {
  type: "hint_started";
  pending: HintPending;
}

/** The model is cold and the hint takes longer; broadcast (spec 020 FR-14a). */
export interface HintWarmingMessage {
  type: "hint_warming";
  problem_id: string;
}

/** The hint is ready; broadcast (spec 020 FR-6). */
export interface HintReadyMessage {
  type: "hint_ready";
  hint: Hint;
}

/** No hint this time; broadcast (spec 020 FR-10, FR-14). */
export interface HintFailedMessage {
  type: "hint_failed";
  problem_id: string;
  reason: "unavailable" | "withheld";
}

/** A `hint_request` that did not start, to the sender only (spec 020 FR-2, FR-3, FR-8). */
export type HintRefusedMessage =
  | { type: "hint_refused"; reason: "in_progress"; by: string }
  | { type: "hint_refused"; reason: "stale" | "problem_deleted" | "disabled" };

export type ServerMessage =
  | WelcomeMessage
  | PresenceMessage
  | ProblemSwitchedMessage
  | ProblemDeletedMessage
  | RunStartedMessage
  | RunFinishedMessage
  | RunFailedMessage
  | ErrorMessage
  | ChatMessageFrame
  | ChatRemovedMessage
  | GifResultsMessage
  | ScratchRunStartedMessage
  | ScratchRunOutputMessage
  | ScratchRunEndMessage
  | ScratchRunRefusedMessage
  | HintStartedMessage
  | HintWarmingMessage
  | HintReadyMessage
  | HintFailedMessage
  | HintRefusedMessage;

export interface RunMessage {
  type: "run";
}

export interface SwitchProblemMessage {
  type: "switch_problem";
  problem_id: string;
}

export interface ChatSendMessage {
  type: "chat_send";
  client_id: string;
  text: string;
}

/** Search GIFs (spec 007). `q` may be `""` for trending. */
export interface GifSearchMessage {
  type: "gif_search";
  request_id: string;
  q: string;
}

/** Post a GIF by id (spec 007); the server looks up everything else. */
export interface ChatSendGifMessage {
  type: "chat_send_gif";
  client_id: string;
  gif_id: string;
}

/** Run the code with this text as standard input (spec 011). */
export interface ScratchRunMessage {
  type: "scratch_run";
  input: string;
}

/** Ask the model for a hint on the current problem (spec 020 FR-5); the server normalizes `note`. */
export interface HintRequestMessage {
  type: "hint_request";
  note?: string;
}

export type ClientMessage =
  | HintRequestMessage
  | ScratchRunMessage
  | RunMessage
  | SwitchProblemMessage
  | ChatSendMessage
  | GifSearchMessage
  | ChatSendGifMessage;

/**
 * GET /api/sessions/stale (spec 003, admin only): one stale session. The learning-session
 * list (spec 006, GET /api/learn/sessions/stale) names a lesson instead of a problem.
 */
export interface StaleSession {
  invite_id: string;
  problem_title?: string;
  lesson_title?: string;
  stale_at: string;
  last_activity_at: string;
}

/** GET /api/home (spec 017): one live or idle session tile. */
export interface HomeParticipant {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface SessionTile {
  id: string;
  /** The invite the session's route takes (/s/:invite and its kin). */
  invite_id: string;
  kind: "coding" | "learning" | "presentation";
  title: string;
  host: { id: string; name: string };
  live: boolean;
  participant_count: number;
  participants: HomeParticipant[];
  last_active_at: string | null;
  has_preview: boolean;
}

export interface GameTile {
  id: string;
  /** The invite the game's route takes (/games/chess/s/:invite). */
  invite_id: string;
  title: string;
  opponent: { id: string; name: string } | null;
  status: "in_progress" | "waiting";
  turn: "you" | "opponent" | "none";
  fen: string;
}

export interface HomePreview {
  session_id: string;
  language: string;
  excerpt: string;
}

export interface HomeSnapshot {
  user: { first_name: string | null; display_name: string | null; username: string };
  live_participant_count: number | null;
  sessions: SessionTile[];
  idle_total: number;
  games: GameTile[];
}
