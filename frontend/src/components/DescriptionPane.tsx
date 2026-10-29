import { DescriptionView } from "../description/DescriptionView";

/**
 * The session's problem description in the inspector (spec 003 FR-14): spec 002's
 * server-rendered HTML in its prose styles, where a wide image is scaled to the 320 px
 * column instead of scrolling.
 */
export function DescriptionPane({ html }: { html: string }) {
  return <DescriptionView html={html} />;
}
