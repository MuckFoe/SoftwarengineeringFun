import type {
  Anchor,
  Place,
  PresentationKind,
  PresentHost,
  PresentParticipant,
  PresentServerMessage,
  PresentWsErrorCode,
  Stroke,
} from "./presentTypes";

/** A presentation session as one participant sees it (plan "Following", "Hosting", "Drawing"). */
export interface PresentState {
  you: { participant_id: string; name: string } | null;
  /** False once the presentation was removed (FR-5). */
  available: boolean;
  kind: PresentationKind | null;
  slideCount: number;
  host: PresentHost | null;
  /** The last place the host showed; untouched by changes of host (FR-29). */
  place: Place;
  participants: PresentParticipant[];
  /** Live strokes, oldest first, including this participant's own (echoed locally). */
  strokes: Stroke[];
  /** The host's pointer, or null when it is off the presentation (FR-13). */
  cursor: Anchor | null;
  /** This participant's drawing tool; local only, never sent (FR-19). */
  drawing: boolean;
  /** The last refusal from the server, if any. */
  error: PresentWsErrorCode | null;
}

/** Local actions: the drawing toggle and the echo of this participant's own strokes,
 * which the server relays to everyone but the drawer. */
export type PresentLocalAction =
  | { type: "drawing_toggled" }
  | { type: "local_stroke_start"; id: string; anchor: Anchor | null; points: [number, number][] }
  | { type: "local_stroke_points"; id: string; points: [number, number][] };

export type PresentAction = PresentServerMessage | PresentLocalAction;

export const initialPresentState: PresentState = {
  you: null,
  available: true,
  kind: null,
  slideCount: 0,
  host: null,
  place: { slide: null, anchor: null },
  participants: [],
  strokes: [],
  cursor: null,
  drawing: false,
  error: null,
};

export function isHost(state: PresentState): boolean {
  return state.you !== null && state.host !== null && state.host.id === state.you.participant_id;
}

export function hostName(state: PresentState): string | null {
  return state.host?.name ?? null;
}

export function hostAway(state: PresentState): boolean {
  return state.host?.away ?? false;
}

/** Whether this participant may move the place and report a pointer. */
export function canLead(state: PresentState): boolean {
  return isHost(state) && state.available;
}

function addPoints(state: PresentState, id: string, points: [number, number][]): PresentState {
  if (!state.strokes.some((s) => s.id === id)) return state;
  return {
    ...state,
    strokes: state.strokes.map((s) =>
      s.id === id ? { ...s, points: [...s.points, ...points] } : s,
    ),
  };
}

/** Pure: folds one server frame or local action into the state. */
export function presentReducer(state: PresentState, action: PresentAction): PresentState {
  switch (action.type) {
    case "welcome":
      return {
        ...state,
        you: { participant_id: action.you.participant_id, name: action.you.name },
        available: action.available,
        kind: action.kind,
        slideCount: action.slide_count,
        host: action.host,
        place: action.place,
        participants: action.participants,
        strokes: action.strokes,
        cursor: null,
        error: null,
      };
    case "presence":
      return { ...state, participants: action.participants };
    case "host":
      return {
        ...state,
        host: action.host,
        // A new host's pointer isn't the old one's; an away host's pointer is off the page (FR-13).
        cursor: action.host?.id === state.host?.id && !action.host?.away ? state.cursor : null,
      };
    case "place":
      return {
        ...state,
        place: { slide: action.slide, anchor: action.anchor },
        // FR-21: a slide change clears drawings; scrolling a single page never does.
        strokes: action.slide === state.place.slide ? state.strokes : [],
      };
    case "pointer":
      return { ...state, cursor: action.anchor };
    case "stroke_start":
      return { ...state, strokes: [...state.strokes, action.stroke] };
    case "stroke_points":
      return addPoints(state, action.id, action.points);
    case "drawings_cleared":
      return { ...state, strokes: [] };
    case "presentation_removed":
      return { ...state, available: false, cursor: null };
    case "error":
      return { ...state, error: action.code };
    case "drawing_toggled":
      return { ...state, drawing: !state.drawing };
    case "local_stroke_start": {
      const you = state.you;
      if (you === null) return state;
      const color = state.participants.find((p) => p.id === you.participant_id)?.color ?? "";
      const stroke: Stroke = {
        id: action.id,
        participant_id: you.participant_id,
        color,
        anchor: action.anchor,
        points: action.points,
      };
      return { ...state, strokes: [...state.strokes, stroke] };
    }
    case "local_stroke_points":
      return addPoints(state, action.id, action.points);
    case "chat_message":
    case "chat_removed":
    case "gif_results":
      // Chat is the chat hook's concern, not the presentation's.
      return state;
  }
}
