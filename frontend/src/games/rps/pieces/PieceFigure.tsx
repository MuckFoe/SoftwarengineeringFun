// One figure for every piece (spec 021 FR-27, plan.md "Figures and playing field" Contract):
// board cells, the home preview and, with `weaponOnly`, the duel picker glyphs.
import type { Kind, Side } from "../rpsTypes";
import {
  BODY,
  EMBLEM,
  FLAG_ARMS,
  FLAG_BEARER,
  FLAG_POLE,
  HIDDEN_ARMS,
  HOLD_ARMS,
  KIND_PARTS,
  type Part,
  PLATE_EMBLEM,
} from "./figureParts";
import styles from "./PieceFigure.module.css";

/** The 48-unit grid, cropped to the art plus its contour so the figure fills its cell. */
const VIEW_BOX = "0 -1.5 48 50";

export type PieceFigureProps = {
  /** `null` = hidden: the output then depends on `side` alone (FR-21). */
  kind: Kind | null;
  side: Side;
  /** Omitted when the cell itself carries the accessible name. */
  title?: string;
  /** Duel picker glyph: only the kind's own parts, no soldier. */
  weaponOnly?: boolean;
};

/** Layers of a figure: each is drawn contour first, then its parts, so the contour only shows
 * outside the layer's silhouette. The flag bearer is the one layer with a transform. */
type Layer = { parts: Part[]; transform?: string };

function layersOf(kind: Kind | null, side: Side, weaponOnly: boolean): Layer[] {
  if (kind === null) return [{ parts: [...HIDDEN_ARMS, ...BODY, ...EMBLEM[side]] }];
  if (weaponOnly) return [{ parts: KIND_PARTS[kind] }];
  if (kind === "trap") return [{ parts: [...KIND_PARTS.trap, ...PLATE_EMBLEM[side]] }];
  if (kind === "flag")
    return [
      { parts: FLAG_POLE },
      { parts: [...BODY, ...EMBLEM[side], ...FLAG_ARMS], transform: FLAG_BEARER },
    ];
  return [{ parts: [...BODY, ...EMBLEM[side], ...HOLD_ARMS, ...KIND_PARTS[kind]] }];
}

function LayerPaths({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts
        .filter((p) => p.role !== "detail")
        .map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered drawing
          <path key={`c${i}`} data-layer="contour" className={styles.contour} d={p.d} />
        ))}
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered drawing
        <path key={i} className={styles[p.role]} d={p.d} />
      ))}
    </>
  );
}

export function PieceFigure({ kind, side, title, weaponOnly = false }: PieceFigureProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden unless a title is given, then titled
    <svg
      className={styles.figure}
      viewBox={VIEW_BOX}
      data-side={side}
      aria-hidden={!title}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      {layersOf(kind, side, weaponOnly).map((layer, i) =>
        layer.transform ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered drawing
          <g key={i} transform={layer.transform}>
            <LayerPaths parts={layer.parts} />
          </g>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered drawing
          <LayerPaths key={i} parts={layer.parts} />
        ),
      )}
    </svg>
  );
}
