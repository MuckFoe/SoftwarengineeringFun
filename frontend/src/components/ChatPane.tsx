import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import type { ChatMessage } from "../api/types";
import { charCount, MAX_CHAT_CHARS } from "../chat/chatRules";
import type { SendResult } from "../chat/useChat";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import styles from "./ChatPane.module.css";

/** Consecutive messages from one sender within this long of the previous share a header. */
const GROUP_GAP_MS = 5 * 60 * 1000;

const REFUSALS: Record<Exclude<SendResult, "ok">, string | null> = {
  chat_empty: null,
  chat_too_long: `Messages can be at most ${MAX_CHAT_CHARS} characters.`,
  session_stale: "Messages can't be sent in a stale session.",
};

interface Group {
  sender: string;
  sentAt: string;
  messages: ChatMessage[];
}

function groupMessages(messages: ChatMessage[]): Group[] {
  const groups: Group[] = [];
  let previous: ChatMessage | undefined;
  for (const m of messages) {
    const last = groups.at(-1);
    const gap = previous ? Date.parse(m.sent_at) - Date.parse(previous.sent_at) : Infinity;
    if (last && previous?.sender_name === m.sender_name && gap <= GROUP_GAP_MS) {
      last.messages.push(m);
    } else {
      groups.push({ sender: m.sender_name, sentAt: m.sent_at, messages: [m] });
    }
    previous = m;
  }
  return groups;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  messages: ChatMessage[];
  /** A stale session: the history is shown and nothing can be sent (spec 002 FR16). */
  readOnly: boolean;
  send(text: string): Promise<SendResult>;
  /** An admin's: each message gets a Remove action (spec 002 FR19). */
  canRemove?: boolean;
  remove?(id: number): Promise<void>;
}

/**
 * A session's chat in the inspector (spec 003 FR-15): messages grouped by sender, the
 * character count against the limit while typing, and in a stale session a disabled input
 * with the reason beside it. Return sends; Shift+Return starts a new line. A message's body
 * is a text node, so markup in it is shown as typed and never rendered (spec 002 FR15).
 */
export function ChatPane({ messages, readOnly, send, canRemove = false, remove }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const messageId = `${id}-message`;
  const counterId = `${id}-counter`;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (readOnly || sending) return;
    setMessage(null);
    setSending(true);
    try {
      const result = await send(text);
      if (result === "ok") setText("");
      else setMessage(REFUSALS[result]);
    } catch {
      setMessage("Your message couldn't be sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(id: number) {
    setRemoveError(null);
    try {
      await remove?.(id);
    } catch {
      setRemoveError("The message couldn't be removed. Try again.");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  const shown = readOnly ? REFUSALS.session_stale : message;
  const count = charCount(text);

  return (
    <div className={styles.pane}>
      <ol aria-label="Messages" className={styles.list}>
        {groupMessages(messages).map((group) => (
          <li key={group.messages[0]?.id} className={styles.group}>
            <h3 className={styles.header}>
              <span className={styles.sender}>{group.sender}</span>{" "}
              <time dateTime={group.sentAt} className={styles.time}>
                {timeLabel(group.sentAt)}
              </time>
            </h3>
            {group.messages.map((m) => (
              <div key={m.id} className={styles.message}>
                <p className={styles.text}>{m.text}</p>
                {canRemove && (
                  <Button
                    variant="plain"
                    icon="trash"
                    label={`Remove message from ${m.sender_name} at ${timeLabel(m.sent_at)}`}
                    onClick={() => void removeMessage(m.id)}
                  />
                )}
              </div>
            ))}
          </li>
        ))}
      </ol>
      {removeError && <InlineMessage id={`${id}-remove-error`}>{removeError}</InlineMessage>}
      <form className={styles.compose} onSubmit={(e) => void submit(e)}>
        <label htmlFor={`${id}-input`} className={styles.label}>
          Message
        </label>
        <textarea
          id={`${id}-input`}
          className={styles.input}
          rows={3}
          value={text}
          disabled={readOnly}
          aria-invalid={count > MAX_CHAT_CHARS || undefined}
          aria-describedby={[counterId, shown ? messageId : ""].filter(Boolean).join(" ")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.footer}>
          <span
            id={counterId}
            className={count > MAX_CHAT_CHARS ? styles.over : styles.counter}
          >{`${count}/${MAX_CHAT_CHARS}`}</span>
          <Button variant="bordered" type="submit" disabled={readOnly} busy={sending}>
            Send
          </Button>
        </div>
        {shown && <InlineMessage id={messageId}>{shown}</InlineMessage>}
      </form>
    </div>
  );
}
