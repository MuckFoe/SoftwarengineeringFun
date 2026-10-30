// Wire shapes for learning sessions (spec 006, plan "Wire shapes" and "WebSocket").
import type { ChatMessage, Participant } from "../api/types";

export type StepKind = "explanation" | "quiz" | "terminal";

export interface LessonOutline {
  key: string;
  title: string;
  topic: string;
  steps: { position: number; title: string; kind: StepKind }[];
}

export type StepCheck =
  | { type: "choice"; options: string[]; multiple: boolean }
  | { type: "text" }
  | { type: "terminal"; prompt: string };

/** Revealed only once a step is passed or its answer shown (FR-14, FR-14a, FR-15). */
export type Answer =
  | { type: "choice"; correct: number[] }
  | { type: "text"; accept: string[] }
  | { type: "terminal"; command: string; output: string };

/** Submitted text and output are data: render as text, never as HTML (NFR-4). */
export interface Attempt {
  id: number;
  by: string;
  kind: "choice" | "text" | "command";
  submitted: number[] | string;
  correct: boolean;
  output: string | null;
  at: string;
}

export interface StepPassed {
  by: string;
  at: string;
  after_reveal: boolean;
}

export interface StepView {
  position: number;
  title: string;
  kind: StepKind;
  /** Server-rendered HTML (raw HTML off). */
  body_html: string;
  check: StepCheck | null;
  has_hint: boolean;
  /** Only once revealed. */
  hint_html: string | null;
  /** ≥3 wrong attempts and not yet revealed. */
  show_answer_available: boolean;
  answer: Answer | null;
  attempts: Attempt[];
  passed: StepPassed | null;
}

export interface Summary {
  steps: {
    position: number;
    title: string;
    attempts: number;
    passed_by: string;
    after_reveal: boolean;
  }[];
}

/** The plan's `Record`, renamed so it does not shadow TypeScript's `Record`. */
export interface LearningRecord {
  lesson: LessonOutline;
  current_step: number;
  completed: boolean;
  stale: boolean;
  /** The passed steps plus the current one. */
  steps: StepView[];
  summary: Summary | null;
}

export type LearnErrorCode =
  | "not_current_step"
  | "no_check"
  | "no_hint"
  | "show_answer_unavailable"
  | "session_completed"
  | "session_stale"
  | "too_long"
  | "chat_empty"
  | "chat_too_long";

export type LearnServerMessage =
  | {
      type: "welcome";
      you: { participant_id: string };
      record: LearningRecord;
      chat: ChatMessage[];
    }
  | { type: "presence"; participants: Participant[] }
  | { type: "attempt"; step: number; attempt: Attempt; show_answer_available: boolean }
  | { type: "hint_revealed"; step: number; hint_html: string }
  | { type: "answer_revealed"; step: number; answer: Answer }
  | {
      type: "step_passed";
      step: number;
      passed: StepPassed;
      answer: Answer | null;
      next: StepView | null;
    }
  | { type: "completed"; summary: Summary }
  | { type: "chat_message"; message: ChatMessage; client_id: string }
  | { type: "chat_removed"; id: number }
  | { type: "error"; code: LearnErrorCode };

export type LearnClientMessage =
  | { type: "submit_choice"; step: number; selected: number[] }
  | { type: "submit_text"; step: number; text: string }
  | { type: "submit_command"; step: number; command: string }
  | { type: "continue"; step: number }
  | { type: "reveal_hint"; step: number }
  | { type: "show_answer"; step: number }
  | { type: "chat_send"; text: string; client_id: string };
