import type { ReactNode, Ref } from "react";
import { PinnableColumn } from "../ui/PinnableColumn";
import { PinnablePanel, type PinnablePanelHandle } from "../ui/PinnablePanel";
import { SplitPane } from "../ui/SplitPane";
import { ChatPane, type ChatPaneProps } from "./ChatPane";
import { DescriptionPane } from "./DescriptionPane";
import styles from "./SessionInspector.module.css";

export type { ChatPaneProps };

/** A pinned panel's header row (PinnablePanel.module.css: min-height var(--space-32)). */
const PANEL_HEADER_PX = 32;

/** One pinnable panel's state, from `usePinned` (or `useChatVisible` for the chat). */
export interface PanelPin {
  pinned: boolean;
  onPinnedChange(pinned: boolean): void;
  /** To open its peek from outside, such as a shortcut while it is unpinned. */
  handle?: Ref<PinnablePanelHandle>;
}

export interface SessionInspectorProps {
  /** Sanitised description HTML; undefined while unknown → the Chat region fills the area alone. */
  descriptionHtml?: string;
  chatVisible: boolean;
  /** Passed through to ChatPane (readOnly true in a stale session). */
  chat: ChatPaneProps;
  /** Model hints for the current problem (spec 020), below the description in its section. */
  hints?: ReactNode;
  /**
   * Pinnable panels instead of the collapsible chat: the description (with hints) and the chat
   * are each pinned or a strip that peeks on hover or focus (`PinnableColumn`). Given, it
   * renders its own Inspector landmark (do not wrap it in `Inspector`), and `chatVisible`
   * only tells the chat whether it is on screen.
   */
  pins?: { description: PanelPin; chat: PanelPin };
  /**
   * With pins: the column's width in px, and where its left-edge divider reports a new one.
   * Both pinned panels share the width.
   */
  width?: number;
  onWidthChange?(px: number): void;
}

/**
 * The session's side area (spec 008 FR-1, FR-2, FR-8, FR-9): the description above the
 * chat, each its own region, split by a resizable divider. A hidden chat stays mounted,
 * collapsed, aria-hidden and inert, and the description fills the area. Model hints sit
 * below the description, beside the current problem (spec 020 FR-1).
 */
export function SessionInspector({
  descriptionHtml,
  chatVisible,
  chat,
  hints,
  pins,
  width,
  onWidthChange,
}: SessionInspectorProps) {
  const chatRegion = (
    <section aria-label="Chat" className={styles.chat}>
      <ChatPane {...chat} visible={chatVisible} />
    </section>
  );
  const descriptionRegion = (
    <section
      aria-label="Description"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
      tabIndex={0}
      className={styles.description}
      data-fit-content=""
    >
      {descriptionHtml !== undefined && <DescriptionPane html={descriptionHtml} />}
      {hints}
    </section>
  );
  // Hints already given stay visible even when the description can't be loaded (spec 020 FR-15).
  const chatOnly = descriptionHtml === undefined && !hints;
  // The description takes the height it needs, so a usual problem reads without scrolling.
  // The chat keeps its input, and room for a few messages once there are any. Moving the
  // divider takes over.
  // Pinned, each panel has a header row above its region; the minimums stay the regions' own.
  const header = pins ? PANEL_HEADER_PX : 0;
  const split = {
    minTop: 120 + header,
    minBottom: 160 + header,
    fitTop: (chat.messages.length > 0 ? 280 : 160) + header,
    dividerLabel: "Resize description and chat",
  };

  if (pins) {
    const chatPanel = {
      title: "Chat",
      icon: "chat" as const,
      pinned: pins.chat.pinned,
      onPinnedChange: pins.chat.onPinnedChange,
      handle: pins.chat.handle,
      children: chatRegion,
    };
    if (chatOnly) {
      return (
        <aside aria-label="Inspector" className={styles.single}>
          <PinnablePanel
            ref={chatPanel.handle}
            edge="right"
            size={width === undefined ? undefined : `${width}px`}
            onResize={onWidthChange}
            minSize={240}
            keepFree={480}
            resizeLabel="Resize inspector"
            {...chatPanel}
          />
        </aside>
      );
    }
    return (
      <PinnableColumn
        label="Inspector"
        top={{
          title: "Description",
          icon: "doc",
          pinned: pins.description.pinned,
          onPinnedChange: pins.description.onPinnedChange,
          handle: pins.description.handle,
          children: descriptionRegion,
        }}
        bottom={chatPanel}
        split={split}
        width={width === undefined ? undefined : `${width}px`}
        onWidthChange={onWidthChange}
      />
    );
  }

  if (chatOnly) return chatRegion;
  return (
    <SplitPane {...split} top={descriptionRegion} bottom={chatRegion} bottomOpen={chatVisible} />
  );
}
