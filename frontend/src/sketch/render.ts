// The only canvas code of the sketch board (spec 022 plan, Rendering). Actions are drawn in
// order onto one transparent layer; an erase uses destination-out, so it rubs out what was
// drawn before it and nothing drawn after (FR-6). The board colour is the canvas's CSS
// background. No animation (NFR-6); nothing is ever interpreted as markup (NFR-5).

import {
  type ActionBody,
  BOARD_H,
  BOARD_W,
  ERASER_WIDTH,
  LINE_WIDTH,
  type SketchColor,
} from "./sketchTypes";

/** Resolved CSS colour per palette name, read from the --sketch-* tokens. */
export type SketchColours = Record<SketchColor, string>;

/** Strokes a flat point path; a single point becomes a dot of the line's width. */
function path(ctx: CanvasRenderingContext2D, points: number[], width: number): void {
  const n = Math.floor(points.length / 2);
  if (n === 0) return;
  const x0 = points[0] ?? 0;
  const y0 = points[1] ?? 0;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(x0, y0, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(x0, y0);
  for (let i = 1; i < n; i++) ctx.lineTo(points[2 * i] ?? 0, points[2 * i + 1] ?? 0);
  ctx.stroke();
}

/** Clears the canvas and draws `actions` in order at `scale` canvas pixels per board unit. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  actions: readonly ActionBody[],
  colours: SketchColours,
  scale: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const a of actions) {
    switch (a.kind) {
      case "clear":
        ctx.clearRect(0, 0, BOARD_W, BOARD_H);
        break;
      case "erase":
        ctx.globalCompositeOperation = "destination-out";
        // destination-out only uses alpha; any opaque palette colour will do.
        ctx.strokeStyle = colours.ink;
        ctx.fillStyle = colours.ink;
        ctx.lineWidth = ERASER_WIDTH;
        path(ctx, a.points, ERASER_WIDTH);
        ctx.globalCompositeOperation = "source-over";
        break;
      case "pen":
        ctx.strokeStyle = colours[a.color];
        ctx.fillStyle = colours[a.color];
        ctx.lineWidth = LINE_WIDTH;
        path(ctx, a.points, LINE_WIDTH);
        break;
      case "box":
      case "ellipse": {
        const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = a.points;
        ctx.strokeStyle = colours[a.color];
        ctx.lineWidth = LINE_WIDTH;
        if (a.kind === "box") {
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else {
          ctx.beginPath();
          ctx.ellipse(
            (x0 + x1) / 2,
            (y0 + y1) / 2,
            (x1 - x0) / 2,
            (y1 - y0) / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        break;
      }
    }
  }
}
