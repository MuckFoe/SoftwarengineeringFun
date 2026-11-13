import { type CSSProperties, type ReactNode, type Ref, useRef } from "react";
import type { IconName } from "./Icon";
import styles from "./PinnableColumn.module.css";
import { type PinEdge, PinnablePanel, type PinnablePanelHandle } from "./PinnablePanel";
import { ResizeHandle } from "./ResizeHandle";
import { SplitPane, type SplitPaneProps } from "./SplitPane";

/** One of the column's two panels. */
export interface PinnableColumnPanel {
  title: string;
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  children: ReactNode;
  pinLabel?: string;
  icon?: IconName;
  actions?: ReactNode;
  handle?: Ref<PinnablePanelHandle>;
}

export interface PinnableColumnProps {
  /** The column's landmark name, e.g. "Inspector". */
  label: string;
  top: PinnableColumnPanel;
  bottom: PinnableColumnPanel;
  /** The column's width while a panel is pinned, and each peek's width when both are not. */
  width?: string;
  /** How far a panel's peek reaches into the column from its strip; default 70%. */
  peekSize?: string;
  /**
   * Makes the column's width resizable while a panel is pinned: a divider on its left edge
   * reports the new width in px. `width` should then be that width in px.
   */
  onWidthChange?(px: number): void;
  /** The smallest width the divider allows, px; default 240. */
  minWidth?: number;
  /** How much of the viewport the divider always leaves to the rest, px; default 480. */
  keepFree?: number;
  /** The divider while both are pinned (see SplitPane). */
  split: Pick<
    SplitPaneProps,
    "minTop" | "minBottom" | "defaultTopFraction" | "fitTop" | "fixBottom" | "dividerLabel"
  >;
}

/**
 * Two pinnable panels stacked in a right-hand column (description above chat):
 * - both pinned: split by a resizable divider, as before;
 * - one unpinned: it becomes a horizontal strip at its end of the column and the other fills;
 *   its peek opens from the strip over the other panel;
 * - both unpinned: the column narrows to a vertical strip with one labelled section per panel,
 *   each peeking out to the left over the main area, full height.
 * Both panels stay mounted in the same place throughout, so switching keeps their state.
 */
export function PinnableColumn({
  label,
  top,
  bottom,
  width = "320px",
  peekSize = "70%",
  onWidthChange,
  minWidth = 240,
  keepFree = 480,
  split,
}: PinnableColumnProps) {
  const both = !top.pinned && !bottom.pinned;
  const stack = both ? "both" : !top.pinned ? "top" : !bottom.pinned ? "bottom" : undefined;
  const style = { "--column-width": width } as CSSProperties;
  const columnRef = useRef<HTMLElement>(null);

  function panel(p: PinnableColumnPanel, edge: PinEdge) {
    return (
      <PinnablePanel
        ref={p.handle}
        title={p.title}
        edge={both ? "right" : edge}
        pinned={p.pinned}
        onPinnedChange={p.onPinnedChange}
        pinLabel={p.pinLabel}
        icon={p.icon}
        actions={p.actions}
        size={both ? width : peekSize}
        anchor="parent"
      >
        {p.children}
      </PinnablePanel>
    );
  }

  return (
    <aside
      ref={columnRef}
      aria-label={label}
      className={styles.column}
      data-collapsed={both}
      style={style}
    >
      <SplitPane
        {...split}
        top={panel(top, "top")}
        bottom={panel(bottom, "bottom")}
        bottomOpen
        stack={stack}
      />
      {onWidthChange && !both && (
        <ResizeHandle
          edge="right"
          target={columnRef}
          size={Number.parseFloat(width)}
          onResize={onWidthChange}
          minSize={minWidth}
          keepFree={keepFree}
          label={`Resize ${label.toLowerCase()}`}
        />
      )}
    </aside>
  );
}
