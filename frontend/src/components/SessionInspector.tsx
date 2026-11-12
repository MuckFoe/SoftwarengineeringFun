import type { ReactNode } from "react";
import { SplitPane } from "../ui/SplitPane";
import { ChatPane, type ChatPaneProps } from "./ChatPane";
import { DescriptionPane } from "./DescriptionPane";
import styles from "./SessionInspector.module.css";

export type { ChatPaneProps };

export interface SessionInspectorProps {
  /** Sanitised description HTML; undefined while unknown → the Chat region fills the area alone. */
  descriptionHtml?: string;
  chatVisible: boolean;
  /** Passed through to ChatPane (readOnly true in a stale session). */
  chat: ChatPaneProps;
  /** Model hints for the current problem (spec 020), below the description in its section. */
  hints?: ReactNode;
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
}: SessionInspectorProps) {
  const chatRegion = (
    <section aria-label="Chat" className={styles.chat}>
      <ChatPane {...chat} visible={chatVisible} />
    </section>
  );
  // Hints already given stay visible even when the description can't be loaded (spec 020 FR-15).
  if (descriptionHtml === undefined && !hints) return chatRegion;
  return (
    <SplitPane
      top={
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
        <section aria-label="Description" tabIndex={0} className={styles.description}>
          {descriptionHtml !== undefined && <DescriptionPane html={descriptionHtml} />}
          {hints}
        </section>
      }
      bottom={chatRegion}
      bottomOpen={chatVisible}
      minTop={120}
      minBottom={160}
      // The description takes the height it needs, so a usual problem reads without scrolling.
      // The chat keeps its input, and room for a few messages once there are any. Moving the
      // divider takes over.
      fitTop={chat.messages.length > 0 ? 280 : 160}
      dividerLabel="Resize description and chat"
    />
  );
}
