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
}

/**
 * The session's side area (spec 008 FR-1, FR-2, FR-8, FR-9): the description above the
 * chat, each its own region, split by a resizable divider. A hidden chat stays mounted,
 * collapsed, aria-hidden and inert, and the description fills the area.
 */
export function SessionInspector({ descriptionHtml, chatVisible, chat }: SessionInspectorProps) {
  const chatRegion = (
    <section aria-label="Chat" className={styles.chat}>
      <ChatPane {...chat} visible={chatVisible} />
    </section>
  );
  if (descriptionHtml === undefined) return chatRegion;
  return (
    <SplitPane
      top={
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
        <section aria-label="Description" tabIndex={0} className={styles.description}>
          <DescriptionPane html={descriptionHtml} />
        </section>
      }
      bottom={chatRegion}
      bottomOpen={chatVisible}
      minTop={120}
      minBottom={160}
      dividerLabel="Resize description and chat"
    />
  );
}
