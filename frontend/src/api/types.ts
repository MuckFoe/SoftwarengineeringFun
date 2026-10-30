// Wire types for spec 001, mirroring plan.md "Contracts" exactly.
// Ids are uuids (plan data model), so they travel as strings.

// ---- HTTP ----

export interface Me {
  signed_in: boolean;
  name?: string;
  roles: string[];
}

export interface ProblemSummary {
  id: string;
  title: string;
  is_starter: boolean;
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

/** One chat message (spec 002). `sent_at` is ISO-8601 UTC. */
export interface ChatMessage {
  id: number;
  sender_name: string;
  text: string;
  sent_at: string;
}

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
}

export interface Participant {
  id: string;
  name: string;
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
  | ChatErrorCode;

/** Refusals of a `chat_send`, answered to the sender only (spec 002). */
export type ChatErrorCode = "chat_empty" | "chat_too_long" | "session_stale";

export interface WelcomeMessage {
  type: "welcome";
  participant_id: string;
  current_problem: Problem;
  problems: Record<string, ProblemProgress>;
  presence: Participant[];
  run_in_progress: boolean;
  /** The session's chat history, in id order (spec 002). */
  chat: ChatMessage[];
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
  | ChatRemovedMessage;

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

export type ClientMessage = RunMessage | SwitchProblemMessage | ChatSendMessage;

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
