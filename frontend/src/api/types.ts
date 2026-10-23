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
  description: string;
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
  | "invalid_name";

export interface WelcomeMessage {
  type: "welcome";
  participant_id: string;
  current_problem: Problem;
  problems: Record<string, ProblemProgress>;
  presence: Participant[];
  run_in_progress: boolean;
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
}

export type ServerMessage =
  | WelcomeMessage
  | PresenceMessage
  | ProblemSwitchedMessage
  | ProblemDeletedMessage
  | RunStartedMessage
  | RunFinishedMessage
  | RunFailedMessage
  | ErrorMessage;

export interface RunMessage {
  type: "run";
}

export interface SwitchProblemMessage {
  type: "switch_problem";
  problem_id: string;
}

export type ClientMessage = RunMessage | SwitchProblemMessage;
