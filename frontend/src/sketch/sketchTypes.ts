// Sketch board wire types and limits (spec 022 plan, Contracts and Data model), mirroring
// backend sketch/rules.py. Coordinates are integers on a fixed logical board; points are a
// flat array [x0, y0, x1, y1, ...].

export const PALETTE = [
  "ink",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;
export type SketchColor = (typeof PALETTE)[number];

export const BOARD_W = 1600;
export const BOARD_H = 1000;
export const LINE_WIDTH = 4;
export const ERASER_WIDTH = 24;
export const MAX_POINTS = 1000;
export const MAX_CLIENT_ID = 64;
export const BUDGET_BYTES = 1_000_000;
/** Size of a box or ellipse placed by a click without dragging (FR-5), 16:10 like the board. */
export const STANDARD_SHAPE_W = 160;
export const STANDARD_SHAPE_H = 100;

export type ShapeKind = "pen" | "box" | "ellipse";
export type SketchKind = ShapeKind | "erase" | "clear";

/** What a client draws, before the server gives it a seq. */
export type ActionBody =
  | { kind: ShapeKind; color: SketchColor; points: number[] }
  | { kind: "erase"; points: number[] }
  | { kind: "clear" };

/** A confirmed action as the server sends it. */
export type SketchAction = { seq: number; client_id: string } & ActionBody;

/** An own action drawn locally, awaiting the server's echo with the same client_id. */
export type PendingAction = { client_id: string } & ActionBody;

export type SketchRefusal = "full" | "invalid" | "not_yours" | "stale";

// Client → server.
export type SketchAddMessage = {
  type: "sketch_add";
  client_id: string;
  action: Exclude<ActionBody, { kind: "clear" }>;
};
export type SketchClearMessage = { type: "sketch_clear"; client_id: string };
export type SketchUndoMessage = { type: "sketch_undo"; seq: number };
export type SketchClientMessage = SketchAddMessage | SketchClearMessage | SketchUndoMessage;

// Server → client.
export type SketchAddedMessage = { type: "sketch_added"; action: SketchAction };
export type SketchRemovedMessage = { type: "sketch_removed"; seq: number };
export type SketchRefusedMessage = {
  type: "sketch_refused";
  client_id?: string;
  seq?: number;
  reason: SketchRefusal;
};
export type SketchServerMessage = SketchAddedMessage | SketchRemovedMessage | SketchRefusedMessage;

/** The `sketch` field of the session socket's `welcome`. */
export type SketchSnapshot = { actions: SketchAction[]; full: boolean };

/** `GET /api/sessions/{invite}/sketch`. */
export type SketchReadResponse = { actions: SketchAction[]; read_only: boolean };
