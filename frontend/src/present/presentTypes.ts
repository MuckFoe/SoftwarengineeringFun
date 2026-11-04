// Spec 013 wire contract (plan.md "Contracts"): REST bodies, WebSocket frames and the
// postMessage bridge protocol between the session page and the presentation frame.
import type {
  ChatErrorCode,
  ChatMessage,
  ChatMessageFrame,
  ChatRemovedMessage,
  ChatSendGifMessage,
  ChatSendMessage,
  GifErrorCode,
  GifResultsMessage,
  GifSearchMessage,
} from "../api/types";

export type { ChatHistory } from "../api/types";

// --- Shared shapes ---------------------------------------------------------------------

export type PresentationKind = "slides" | "page";

/** A point on the content: child-element indices from `<body>`, then fractions of that box. */
export interface Anchor {
  path: number[];
  fx: number;
  fy: number;
}

/** Where the host is: a 0-based slide (null for a single page) and the viewport-centre anchor. */
export interface Place {
  slide: number | null;
  anchor: Anchor | null;
}

/** A drawn stroke; `points` are `[fx, fy]` fractions of the anchor's box (or the viewport's). */
export interface Stroke {
  id: string;
  participant_id: string;
  color: string;
  anchor: Anchor | null;
  points: [number, number][];
}

export interface PresentParticipant {
  id: string;
  name: string;
  color: string;
  /** Spec 012 FR-8: set by the server from the participant's account. */
  signed_in?: boolean;
}

export interface PresentHost {
  id: string;
  name: string;
  away: boolean;
  /** The host's participant has an account: show the *signed in* mark (012 FR-8). */
  signed_in?: boolean;
}

// --- REST ------------------------------------------------------------------------------

/** One library entry; also the body of add (201) and replace (200). */
export interface PresentationSummary {
  id: string;
  title: string;
  topic: string;
  kind: PresentationKind;
  slide_count: number;
}

/** POST /api/present/analyze. */
export interface Analysis {
  kind: PresentationKind;
  slide_count: number;
}

/** POST /api/present/sessions. */
export interface StartedSession {
  invite_id: string;
}

/** GET /api/present/sessions/{invite}. */
export interface PresentSessionState {
  title: string;
  topic: string;
  kind: PresentationKind;
  slide_count: number;
  available: boolean;
  stale: boolean;
  can_reactivate: boolean;
  host_name: string | null;
  /** The host's participant has an account (012 FR-8). */
  host_signed_in?: boolean;
  place: Place;
}

export type PresentErrorCode =
  | "too_large"
  | "not_html"
  | "empty"
  | "invalid_title"
  | "invalid_topic"
  | "missing_role"
  | "unauthorized"
  | "not_found"
  | "presentation_removed"
  | "not_stale"
  | "http";

/** Every non-2xx answer, resolved rather than thrown. */
export interface PresentError {
  error: PresentErrorCode;
  /** On `too_large`: the upload limit in bytes. */
  limit_bytes?: number;
  /** On `missing_role`: the role required. */
  role?: string;
}

// --- WebSocket: server → client --------------------------------------------------------

export type PresentWsErrorCode =
  | "not_host"
  | "bad_slide"
  | "session_stale"
  | "drawing_full"
  | "not_connected"
  | "presentation_unavailable"
  | ChatErrorCode
  | GifErrorCode;

export type HostReason = "start" | "returned" | "away" | "timeout" | "handover" | "claimed";

export interface PresentWelcomeMessage {
  type: "welcome";
  you: { participant_id: string; rejoin_token: string; name: string };
  available: boolean;
  kind: PresentationKind;
  slide_count: number;
  host: PresentHost | null;
  place: Place;
  participants: PresentParticipant[];
  strokes: Stroke[];
  chat: ChatMessage[];
}

export interface PresentPresenceMessage {
  type: "presence";
  participants: PresentParticipant[];
}

export interface HostMessage {
  type: "host";
  host: PresentHost | null;
  reason: HostReason;
}

export interface PlaceMessage extends Place {
  type: "place";
}

/** The host's pointer, to everyone but the host; null when it left the frame. */
export interface PointerMessage {
  type: "pointer";
  anchor: Anchor | null;
}

export interface StrokeStartMessage {
  type: "stroke_start";
  stroke: Stroke;
}

export interface StrokePointsMessage {
  type: "stroke_points";
  id: string;
  points: [number, number][];
}

export interface DrawingsClearedMessage {
  type: "drawings_cleared";
}

export interface PresentationRemovedMessage {
  type: "presentation_removed";
}

/** Refusals, to the sender only. Chat/GIF refusals carry the 002/007 extra fields. */
export interface PresentErrorMessage {
  type: "error";
  code: PresentWsErrorCode;
  client_id?: string;
  limit?: number;
  request_id?: string;
  retry_after?: number;
}

export type PresentServerMessage =
  | PresentWelcomeMessage
  | PresentPresenceMessage
  | HostMessage
  | PlaceMessage
  | PointerMessage
  | StrokeStartMessage
  | StrokePointsMessage
  | DrawingsClearedMessage
  | PresentationRemovedMessage
  | PresentErrorMessage
  | ChatMessageFrame
  | ChatRemovedMessage
  | GifResultsMessage;

// --- WebSocket: client → server --------------------------------------------------------

export interface PlaceRequest extends Place {
  type: "place";
}

export interface PointerRequest {
  type: "pointer";
  anchor: Anchor | null;
}

export interface HandOverRequest {
  type: "hand_over";
  participant_id: string;
}

export interface StrokeStartRequest {
  type: "stroke_start";
  id: string;
  anchor: Anchor | null;
  points: [number, number][];
}

export interface StrokePointsRequest {
  type: "stroke_points";
  id: string;
  points: [number, number][];
}

export interface ClearDrawingsRequest {
  type: "clear_drawings";
}

export type PresentClientMessage =
  | PlaceRequest
  | PointerRequest
  | HandOverRequest
  | StrokeStartRequest
  | StrokePointsRequest
  | ClearDrawingsRequest
  | ChatSendMessage
  | ChatSendGifMessage
  | GifSearchMessage;

// --- Bridge protocol (window.postMessage, every message `{sdd: <type>, ...}`) ------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frame → page. */
export type FrameToPageMessage =
  | { sdd: "ready"; kind: PresentationKind; slideCount: number }
  | { sdd: "scrolled"; anchor: Anchor | null }
  | { sdd: "pointer"; x: number; y: number; anchor: Anchor }
  | { sdd: "pointer"; anchor: null }
  | { sdd: "key"; key: string }
  | { sdd: "layout" }
  | { sdd: "resolved"; req: number; rects: (Rect | null)[] }
  | { sdd: "anchorAt"; req: number; anchor: Anchor | null; rect: Rect | null };

/** Page → frame. */
export type PageToFrameMessage =
  | { sdd: "show"; slide: number | null; anchor: Anchor | null }
  | { sdd: "follow"; on: boolean }
  | { sdd: "resolve"; req: number; anchors: (Anchor | null)[] }
  | { sdd: "anchorAt"; req: number; x: number; y: number };
