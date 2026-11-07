import "./icons-fallback.css";
import type { BrandIconName } from "./iconMap";

export type { BrandIconName } from "./iconMap";

/**
 * A masked glyph (FR-2): the shape comes from CSS (`icons-fallback.css`, overridden by the
 * Audi icons in `brand.css` when supplied), the colour is the surrounding text colour. A
 * missing asset can never show as a broken image.
 */
export function Icon({
  name,
  size = 24,
  label,
}: {
  name: BrandIconName;
  /** Pixels; the Audi grid sizes are 16, 24 and 48. */
  size?: number;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
}) {
  return (
    <span
      className="icon"
      data-icon={name}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" as const })}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}
