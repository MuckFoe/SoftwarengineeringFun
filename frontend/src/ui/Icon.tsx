import type { CSSProperties } from "react";
import { Icon as BrandIcon } from "../brand/Icon";
import { type BrandIconName, iconMap } from "../brand/iconMap";

/**
 * The app's icon (FR-2): a masked glyph from `brand/Icon`, so the supplied Audi icons show
 * everywhere and the committed Lucide fallbacks show when they are absent. Semantic names map
 * to Audi/Lucide names in `brand/iconMap.ts`; the colour is the surrounding text colour.
 */
export type IconName = BrandIconName;

export const ICON_NAMES = Object.keys(iconMap) as IconName[];

interface Props {
  name: IconName;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
  size?: number;
}

export function Icon({ name, label, size = 16 }: Props) {
  return <BrandIcon name={name} label={label} size={size} />;
}

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

/**
 * The *signed in* mark shown beside a signed-in participant's name (012 FR-8): the
 * person-with-checkmark glyph, decorative, plus visually hidden "signed in" text. It sets no
 * colour of its own, so it takes the colour of the name it sits next to.
 */
export function SignedInMark({ size = 14 }: { size?: number }) {
  return (
    <span data-signed-in style={{ display: "inline-flex", flex: "none" }}>
      <Icon name="personCheck" size={size} />
      <span style={VISUALLY_HIDDEN}>signed in</span>
    </span>
  );
}
