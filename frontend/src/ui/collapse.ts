/**
 * Props for a panel that collapses but stays mounted (so it can animate): while closed it
 * is out of the accessibility tree and inert, so nothing inside takes focus.
 */
export function collapsedProps(open: boolean) {
  return open ? {} : { "aria-hidden": true, inert: "" };
}
