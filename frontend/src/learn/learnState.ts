import type { Participant } from "../api/types";
import type {
  LearnErrorCode,
  LearnServerMessage,
  LessonOutline,
  StepView,
  Summary,
} from "./learnTypes";

/**
 * A learning session as one participant sees it. `current` is shared by the group;
 * `viewing` is this participant's own: a passed step looked back at, or the current one
 * (FR-15).
 */
export interface LearnState {
  lesson: LessonOutline | null;
  you: string | null;
  current: number;
  /** Positions of passed steps, ascending. */
  passed: number[];
  /** The passed steps plus the current one, by position. */
  steps: StepView[];
  participants: Participant[];
  viewing: number;
  completed: boolean;
  summary: Summary | null;
  /** The last refusal from the server, if any. */
  error: LearnErrorCode | null;
}

export type LearnAction = LearnServerMessage | { type: "view_step"; position: number };

export const initialLearnState: LearnState = {
  lesson: null,
  you: null,
  current: 0,
  passed: [],
  steps: [],
  participants: [],
  viewing: 0,
  completed: false,
  summary: null,
  error: null,
};

function updateStep(
  state: LearnState,
  position: number,
  change: (step: StepView) => StepView,
): LearnState {
  return {
    ...state,
    steps: state.steps.map((s) => (s.position === position ? change(s) : s)),
  };
}

/** Pure: folds one server message (or the local `view_step`) into the state. */
export function learnReducer(state: LearnState, action: LearnAction): LearnState {
  switch (action.type) {
    case "welcome": {
      const { record } = action;
      return {
        ...state,
        lesson: record.lesson,
        you: action.you.participant_id,
        current: record.current_step,
        passed: record.steps.filter((s) => s.passed !== null).map((s) => s.position),
        steps: [...record.steps].sort((a, b) => a.position - b.position),
        viewing: record.current_step,
        completed: record.completed,
        summary: record.summary,
        error: null,
      };
    }
    case "presence":
      return { ...state, participants: action.participants };
    case "attempt":
      return updateStep(state, action.step, (s) => ({
        ...s,
        attempts: [...s.attempts, action.attempt],
        show_answer_available: action.show_answer_available,
      }));
    case "hint_revealed":
      return updateStep(state, action.step, (s) => ({ ...s, hint_html: action.hint_html }));
    case "answer_revealed":
      return updateStep(state, action.step, (s) => ({
        ...s,
        answer: action.answer,
        show_answer_available: false,
      }));
    case "step_passed": {
      const passedState = updateStep(state, action.step, (s) => ({
        ...s,
        passed: action.passed,
        answer: action.answer ?? s.answer,
        show_answer_available: false,
      }));
      const next = action.next;
      const current = next ? next.position : state.current;
      return {
        ...passedState,
        current,
        passed: state.passed.includes(action.step)
          ? state.passed
          : [...state.passed, action.step].sort((a, b) => a - b),
        steps: next
          ? [...passedState.steps.filter((s) => s.position !== next.position), next].sort(
              (a, b) => a.position - b.position,
            )
          : passedState.steps,
        viewing: state.viewing === state.current ? current : state.viewing,
      };
    }
    case "completed":
      return { ...state, completed: true, summary: action.summary };
    case "error":
      return { ...state, error: action.code };
    case "view_step":
      return action.position === state.current || state.passed.includes(action.position)
        ? { ...state, viewing: action.position }
        : state;
    case "chat_message":
    case "chat_removed":
      // Chat is the chat hook's concern, not the lesson's.
      return state;
  }
}
