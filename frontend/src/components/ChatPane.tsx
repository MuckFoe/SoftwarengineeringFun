import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { charCount, MAX_CHAT_CHARS } from "../chat/chatRules";
import { GifImage } from "../chat/gifs/GifImage";
import { GifPicker } from "../chat/gifs/GifPicker";
import type { GifSearchTransport } from "../chat/gifs/useGifSearch";
import type { SendGifResult, SendResult, ShownChatMessage } from "../chat/useChat";
import { Button } from "../ui/Button";
import { SignedInMark } from "../ui/Icon";
import { InlineMessage } from "../ui/InlineMessage";
import styles from "./ChatPane.module.css";

/** Consecutive messages from one sender within this long of the previous share a header. */
const GROUP_GAP_MS = 5 * 60 * 1000;

/** Scrolled to within this many pixels of the end counts as reading the newest messages. */
const AT_END_PX = 24;

const REFUSALS: Record<Exclude<SendResult, "ok">, string | null> = {
  chat_empty: null,
  chat_too_long: `Messages can be at most ${MAX_CHAT_CHARS} characters.`,
  session_stale: "Messages can't be sent in a stale session.",
};

/** What a refused GIF post tells its sender (spec 007 FR-9, NFR-3). */
const GIF_REFUSALS: Record<Exclude<SendGifResult, "ok">, string> = {
  gif_unavailable: "GIF search unavailable.",
  gif_rate_limited: "Too many GIFs — wait a moment and try again.",
  gif_not_allowed: "That GIF can't be posted.",
  session_stale: REFUSALS.session_stale as string,
};

/** GIF search in this chat (spec 007): given only by the coding-session page. */
export interface ChatGifs {
  invite: string;
  provider: GifSearchTransport | null;
  sendGif(gifId: string): Promise<SendGifResult>;
}

interface Group {
  sender: string;
  sentAt: string;
  own: boolean;
  signedIn: boolean;
  messages: ShownChatMessage[];
}

/** Same sender = same name and same participant: a same-named other person starts a new group (spec 012). */
function sameSender(a: ShownChatMessage, b: ShownChatMessage): boolean {
  return (
    a.sender_name === b.sender_name &&
    a.participant_id === b.participant_id &&
    a.signed_in === b.signed_in
  );
}

function groupMessages(messages: ShownChatMessage[]): Group[] {
  const groups: Group[] = [];
  let previous: ShownChatMessage | undefined;
  for (const m of messages) {
    const last = groups.at(-1);
    const gap = previous ? Date.parse(m.sent_at) - Date.parse(previous.sent_at) : Infinity;
    if (last && previous && sameSender(previous, m) && gap <= GROUP_GAP_MS) {
      last.messages.push(m);
    } else {
      groups.push({
        sender: m.sender_name,
        sentAt: m.sent_at,
        own: m.own === true,
        signedIn: m.signed_in === true,
        messages: [m],
      });
    }
    previous = m;
  }
  return groups;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface ChatPaneProps {
  /** `own` (from useChat, spec 012 FR-3) shows a message as yours, its sender "You". */
  messages: ShownChatMessage[];
  /** A stale session: the history is shown and nothing can be sent (spec 002 FR16). */
  readOnly: boolean;
  send(text: string): Promise<SendResult>;
  /** An admin's: each message gets a Remove action (spec 002 FR19). */
  canRemove?: boolean;
  remove?(id: number): Promise<void>;
  /** Offers a *GIF* button unless `readOnly`; without it (Learn chat, 006) there is none. */
  gifs?: ChatGifs;
  /** Default true. On false → true the message list scrolls to its newest message (spec 008 FR-3). */
  visible?: boolean;
}

/**
 * A session's chat in the inspector (spec 003 FR-15): messages grouped by sender, the
 * character count against the limit while typing, and in a stale session a disabled input
 * with the reason beside it. Return sends; Shift+Return starts a new line. A message's body
 * is a text node, so markup in it is shown as typed and never rendered (spec 002 FR15).
 * The pane fills its panel: messages scroll above an input that stays at the bottom, and a
 * new message scrolls into view unless you have scrolled back to read older ones (F3).
 * A GIF message shows its image and "via GIPHY" in the same row (spec 007 FR-11).
 * Shown again after being hidden (`visible` false → true), it is at the newest message
 * (spec 008 FR-3); it stays mounted while hidden, so drafts and arrivals are kept.
 * Your own messages are styled as yours with "You" as their sender (spec 012 FR-3), and a
 * signed-in sender carries the *signed in* mark beside their name (spec 012 FR-8).
 */
export function ChatPane({
  messages,
  readOnly,
  send,
  canRemove = false,
  remove,
  gifs,
  visible = true,
}: ChatPaneProps) {
  const id = useId();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const messageId = `${id}-message`;
  const counterId = `${id}-counter`;
  const listRef = useRef<HTMLOListElement>(null);
  const atEndRef = useRef(true);
  const [picking, setPicking] = useState(false);
  const gifButtonId = `${id}-gif`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each new message list.
  useEffect(() => {
    const list = listRef.current;
    if (list && atEndRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const wasVisibleRef = useRef(visible);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (visible && !wasVisibleRef.current && list) {
      list.scrollTop = list.scrollHeight;
      atEndRef.current = true;
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  function onScroll() {
    const list = listRef.current;
    if (list)
      atEndRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= AT_END_PX;
  }

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

  function closePicker() {
    setPicking(false);
    document.getElementById(gifButtonId)?.focus();
  }

  async function pickGif(gifId: string) {
    closePicker();
    if (!gifs) return;
    setMessage(null);
    try {
      const result = await gifs.sendGif(gifId);
      if (result !== "ok") setMessage(GIF_REFUSALS[result]);
    } catch {
      setMessage("Your GIF couldn't be sent. Check your connection and try again.");
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
      <ol aria-label="Messages" className={styles.list} ref={listRef} onScroll={onScroll}>
        {groupMessages(messages).map((group) => (
          <li
            key={group.messages[0]?.id}
            className={group.own ? `${styles.group} ${styles.own}` : styles.group}
            data-own={group.own || undefined}
          >
            <h3 className={styles.header}>
              <span className={styles.sender} data-sender>
                {group.own ? "You" : group.sender}
              </span>
              {group.signedIn && (
                <>
                  {" "}
                  <SignedInMark size={12} />
                </>
              )}{" "}
              <time dateTime={group.sentAt} className={styles.time}>
                {timeLabel(group.sentAt)}
              </time>
            </h3>
            {group.messages.map((m) => (
              <div key={m.id} className={styles.message}>
                {m.kind === "gif" ? (
                  <div className={styles.gif}>
                    <GifImage gif={m.gif} />
                    <span className={styles.credit}>via GIPHY</span>
                  </div>
                ) : (
                  <p className={styles.text}>{m.text}</p>
                )}
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
          <div className={styles.actions}>
            {gifs && !readOnly && (
              <Button
                id={gifButtonId}
                variant="bordered"
                aria-expanded={picking}
                onClick={() => (picking ? closePicker() : setPicking(true))}
              >
                GIF
              </Button>
            )}
            <Button variant="bordered" type="submit" disabled={readOnly} busy={sending}>
              Send
            </Button>
          </div>
        </div>
        {gifs && !readOnly && picking && (
          <div className={styles.picker}>
            <GifPicker
              invite={gifs.invite}
              provider={gifs.provider}
              onPick={(gifId) => void pickGif(gifId)}
              onClose={closePicker}
            />
          </div>
        )}
        {shown && <InlineMessage id={messageId}>{shown}</InlineMessage>}
      </form>
    </div>
  );
}
