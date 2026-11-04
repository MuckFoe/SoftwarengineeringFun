// A presentation session (spec 013 plan, "Following", "Hosting", "Drawing", "Session lifetime",
// "Chat"): the name prompt (none when signed in, spec 012 FR-1), then the presentation with its overlay, the slide and drawing
// controls, who is connected (host marked) and the chat. A stale session shows the frame at
// its last place with the chat read-only and Reactivate for admins, as other sessions do.
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";
import type { ChatMessage } from "../api/types";
import { useMe } from "../auth/useMe";
import { type SendResult, useChat } from "../chat/useChat";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { AreaNav } from "../components/AreaNav";
import { ChatPane } from "../components/ChatPane";
import { NotFound } from "../pages/NotFound";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Hud } from "../ui/Hud";
import { SignedInMark } from "../ui/Icon";
import { InlineMessage } from "../ui/InlineMessage";
import { Inspector } from "../ui/Panels";
import { Popover } from "../ui/Popover";
import { Sidebar } from "../ui/Sidebar";
import { TextField } from "../ui/TextField";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import type { FrameLink } from "./frameLink";
import { PresentationFrame, type StrokeStart } from "./PresentationFrame";
import styles from "./PresentSessionWindow.module.css";
import {
  frameUrl,
  getChat,
  getSession,
  isPresentError,
  reactivate as reactivateSession,
  removeChatMessage,
} from "./presentApi";
import {
  type PresentCloseError,
  type PresentEvents,
  PresentSocket,
  type SocketFactory,
  storedIdentity,
} from "./presentSocket";
import {
  canLead,
  hostAway,
  initialPresentState,
  type PresentAction,
  type PresentState,
  presentReducer,
} from "./presentState";
import {
  type Anchor,
  type Place,
  type PresentHost,
  type PresentParticipant,
  type PresentServerMessage,
  type PresentSessionState,
  strokeColor,
} from "./presentTypes";

type PageState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error" }
  | { kind: "ready"; info: PresentSessionState }
  | { kind: "stale"; info: PresentSessionState };

const CLOSE_MESSAGES: Record<PresentCloseError, string> = {
  full: "This session is full (5 participants max).",
  invalid_name: "That name was refused by the server.",
  not_found: "Session not found.",
  stale: "This session has gone stale.",
  replaced: "This session was opened in another tab or window.",
  disconnected: "Disconnected from the session.",
};

/** The server messages that change the presentation state (chat is useChat's). */
const PRESENT_MESSAGES = [
  "welcome",
  "presence",
  "host",
  "place",
  "pointer",
  "stroke_start",
  "stroke_points",
  "drawings_cleared",
  "presentation_removed",
  "error",
] as const satisfies readonly PresentServerMessage["type"][];

/** Keys that step slides, for the host only (plan.md "Following and not leading"). */
const STEP_KEYS: Record<string, "prev" | "next" | "first" | "last"> = {
  ArrowLeft: "prev",
  PageUp: "prev",
  ArrowRight: "next",
  PageDown: "next",
  Home: "first",
  End: "last",
};

/** The host's scroll reaches the server at most this often (plan.md "Following"). */
const PLACE_THROTTLE_MS = 50;

type Action = PresentAction | { type: "reset" };

function reducer(state: PresentState, action: Action): PresentState {
  return action.type === "reset" ? initialPresentState : presentReducer(state, action);
}

/** Same rule as joining a coding session (FR-9). */
function nameProblem(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 30) return "Enter a name from 1 to 30 characters.";
  return null;
}

/** Where a key press is someone typing or moving between controls, not stepping slides. */
function keyBelongsToTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest('input, textarea, select, [role="toolbar"], [role="dialog"], [popover]'))
  );
}

function targetSlide(step: string, slide: number | null, count: number): number | null {
  if (slide === null || count === 0) return null;
  const to =
    step === "first" ? 0 : step === "last" ? count - 1 : slide + (step === "next" ? 1 : -1);
  return Math.min(Math.max(to, 0), count - 1);
}

interface Props {
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: SocketFactory;
  /** Injectable for tests; defaults to the real postMessage bridge. */
  createLink?(iframe: HTMLIFrameElement): FrameLink;
}

export function PresentSessionWindow({ createSocket, createLink }: Props) {
  const { invite = "" } = useParams();
  const me = useMe();
  const meKnown = me.status !== "loading";
  // Signed in: the account is the participant, so there is no name to ask for (spec 012 FR-1).
  const signedIn = me.status === "ready" && me.me.signed_in;
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);
  const [state, dispatch] = useReducer(reducer, initialPresentState);
  const socketRef = useRef<PresentSocket | null>(null);
  // State as well as the ref, so useChat subscribes before the welcome (and its history) arrives.
  const [socket, setSocket] = useState<PresentSocket | null>(null);
  const [staleChat, setStaleChat] = useState<ChatMessage[]>([]);
  // A stale session has no socket; its read-only history comes from this feature's REST.
  const chat = useChat({ invite, provider: socket, stale: false });
  const autoJoined = useRef(false);

  const load = useCallback(async () => {
    const res = await getSession(invite).catch(() => null);
    if (res === null) setPage({ kind: "error" });
    else if (isPresentError(res)) {
      setPage(res.error === "not_found" ? { kind: "not_found" } : { kind: "error" });
    } else setPage(res.stale ? { kind: "stale", info: res } : { kind: "ready", info: res });
  }, [invite]);

  useEffect(() => {
    if (invite) void load();
  }, [invite, load]);

  const stale = page.kind === "stale";
  useEffect(() => {
    if (!stale) return;
    let current = true;
    getChat(invite).then(
      (history) => {
        if (current && !isPresentError(history)) setStaleChat(history.messages);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [stale, invite]);

  useEffect(() => () => socketRef.current?.destroy(), []);

  const connect = useCallback(
    (joinName: string | null) => {
      // A signed-in join sends neither name nor token: the server matches the account first.
      const next = new PresentSocket({
        invite,
        name: joinName,
        ...(joinName === null ? { rejoin: null } : {}),
        createSocket,
      });
      socketRef.current = next;
      setSocket(next);
      for (const type of PRESENT_MESSAGES) {
        next.on(type, (msg: PresentEvents[typeof type]) => dispatch(msg as PresentAction));
      }
      next.on("closed", (ev) => {
        if (socketRef.current !== next) return;
        socketRef.current = null;
        setSocket(null);
        dispatch({ type: "reset" });
        setName((current) => current || (joinName ?? ""));
        if (ev.error === "stale") void load();
        else if (ev.error === "not_found") setPage({ kind: "not_found" });
        else setNameError(CLOSE_MESSAGES[ev.error]);
      });
    },
    [invite, createSocket, load],
  );

  // Someone who was here before rejoins as themselves, without the prompt (FR-16, FR-28);
  // a signed-in user always joins as their account (spec 012 FR-1, FR-5).
  const ready = page.kind === "ready";
  useEffect(() => {
    if (!ready || !meKnown || autoJoined.current || socketRef.current) return;
    autoJoined.current = true;
    if (signedIn) {
      connect(null);
      return;
    }
    const stored = storedIdentity(invite);
    if (stored) connect(stored.name);
  }, [ready, meKnown, signedIn, invite, connect]);

  function join(e: FormEvent) {
    e.preventDefault();
    if (signedIn) {
      setNameError(null);
      connect(null);
      return;
    }
    const problem = nameProblem(name);
    if (problem) {
      setNameError(problem);
      return;
    }
    setNameError(null);
    connect(name.trim());
  }

  async function reactivate() {
    setReactivateError(null);
    const res = await reactivateSession(invite).catch(() => null);
    // not_stale: it isn't stale any more, which is what reactivating was for.
    if (res === null || (isPresentError(res) && res.error !== "not_stale")) {
      setReactivateError("Could not reactivate this session.");
      return;
    }
    setStaleChat([]);
    autoJoined.current = false;
    setHud({ key: Date.now(), message: "Session reactivated" });
    await load();
  }

  const removeMessage = useCallback(
    async (id: number) => {
      const res = await removeChatMessage(invite, id);
      if (isPresentError(res) && res.error !== "not_found") throw new Error(res.error);
      // Live sessions also get `chat_removed` over the socket.
      setStaleChat((messages) => messages.filter((m) => m.id !== id));
    },
    [invite],
  );

  if (page.kind === "not_found") return <NotFound message="Session not found" />;

  const toolbarEnd = (
    <>
      <span className={styles.spacer} />
      <AppearanceControl />
      <AccountControl />
    </>
  );

  if (socket && state.you && page.kind !== "loading" && page.kind !== "error") {
    return (
      <>
        <LiveSession
          invite={invite}
          title={page.info.title}
          state={state}
          socket={socket}
          dispatch={dispatch}
          createLink={createLink}
          toolbarEnd={toolbarEnd}
          chat={
            <ChatPane
              messages={chat.messages}
              readOnly={false}
              send={chat.send}
              canRemove={chat.canRemove}
              remove={removeMessage}
              gifs={{ invite, provider: socket, sendGif: chat.sendGif }}
            />
          }
        />
        {hud && <Hud key={hud.key} message={hud.message} />}
      </>
    );
  }

  if (page.kind === "stale") {
    const { info } = page;
    return (
      <SessionView
        invite={invite}
        title={info.title}
        kind={info.kind}
        slideCount={info.slide_count}
        place={info.place}
        available={info.available}
        participants={[]}
        host={
          info.host_name === null
            ? null
            : { id: "", name: info.host_name, away: false, signed_in: info.host_signed_in }
        }
        youId={null}
        lead={false}
        stale
        drawing={false}
        strokes={[]}
        cursor={null}
        createLink={createLink}
        toolbarEnd={toolbarEnd}
        banner={
          <Banner
            tone="warning"
            actions={
              info.can_reactivate && (
                <Button variant="bordered" onClick={() => void reactivate()}>
                  Reactivate
                </Button>
              )
            }
          >
            This session has gone stale, so nobody can change slides, draw or chat.
            {reactivateError && (
              <InlineMessage id="reactivate-error">{reactivateError}</InlineMessage>
            )}
          </Banner>
        }
        chat={
          <ChatPane
            messages={staleChat}
            readOnly
            send={() => Promise.resolve<SendResult>("session_stale")}
            canRemove={chat.canRemove}
            remove={removeMessage}
          />
        }
      />
    );
  }

  let body: ReactNode;
  if (page.kind === "loading" || !meKnown || (socket && !state.you)) {
    body = <p className={styles.loading}>Loading…</p>;
  } else if (page.kind === "error") {
    body = (
      <EmptyState icon="exclamation" title="Could not load this session">
        <span role="alert">Could not load this session.</span>
      </EmptyState>
    );
  } else {
    body = (
      <div className={styles.joinCard}>
        <h1 className={styles.joinTitle}>Join this presentation</h1>
        <p className={styles.joinSubtitle}>{page.info.title}</p>
        <form className={styles.joinForm} onSubmit={join}>
          {!signedIn && (
            <TextField
              label="Your name"
              value={name}
              onChange={setName}
              invalid={nameError !== null}
              describedBy={nameError ? "join-name-error" : undefined}
            />
          )}
          {nameError && <InlineMessage id="join-name-error">{nameError}</InlineMessage>}
          <div className={styles.joinActions}>
            <Button variant="primary" type="submit">
              Join
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <>
      <Window
        sidebar={
          <Sidebar label="Sidebar">
            <AreaNav />
          </Sidebar>
        }
        toolbar={<Toolbar label="Presentation session">{toolbarEnd}</Toolbar>}
      >
        {body}
      </Window>
      {hud && <Hud key={hud.key} message={hud.message} />}
    </>
  );
}

interface LiveSessionProps {
  invite: string;
  title: string;
  state: PresentState;
  socket: PresentSocket;
  dispatch(action: Action): void;
  createLink?(iframe: HTMLIFrameElement): FrameLink;
  toolbarEnd: ReactNode;
  chat: ReactNode;
}

/** A joined session: wires the controls, keys and frame reports to the socket. */
function LiveSession({
  invite,
  title,
  state,
  socket,
  dispatch,
  createLink,
  toolbarEnd,
  chat,
}: LiveSessionProps) {
  const lead = canLead(state);
  const slides = state.kind === "slides";

  const step = useCallback(
    (key: string) => {
      const dir = STEP_KEYS[key];
      if (!dir || !lead || !slides) return;
      const to = targetSlide(dir, state.place.slide, state.slideCount);
      if (to !== null && to !== state.place.slide) socket.place(to, null);
    },
    [lead, slides, state.place.slide, state.slideCount, socket],
  );

  // Arrow keys / PageUp / PageDown step slides for the host only (AC-13: followers send nothing).
  useEffect(() => {
    if (!lead || !slides) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!(e.key in STEP_KEYS) || keyBelongsToTarget(e.target)) return;
      e.preventDefault();
      step(e.key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lead, slides, step]);

  // The host's scroll: at most one place per PLACE_THROTTLE_MS, the latest one always sent.
  const pendingPlace = useRef<Place | null>(null);
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (placeTimer.current) clearTimeout(placeTimer.current);
    },
    [],
  );
  const onPlace = useCallback(
    (place: Place) => {
      pendingPlace.current = place;
      if (placeTimer.current) return;
      const flush = () => {
        const p = pendingPlace.current;
        pendingPlace.current = null;
        if (!p) {
          placeTimer.current = null;
          return;
        }
        socket.place(p.slide, p.anchor);
        placeTimer.current = setTimeout(flush, PLACE_THROTTLE_MS);
      };
      flush();
    },
    [socket],
  );

  const onPointer = useCallback((anchor: Anchor | null) => socket.pointer(anchor), [socket]);

  const onStrokeStart = useCallback(
    ({ id, anchor, points }: StrokeStart) => {
      dispatch({ type: "local_stroke_start", id, anchor, points });
      socket.strokeStart(id, anchor, points);
    },
    [socket, dispatch],
  );

  const onStrokePoints = useCallback(
    (id: string, points: [number, number][]) => {
      dispatch({ type: "local_stroke_points", id, points });
      socket.strokePoints(id, points);
    },
    [socket, dispatch],
  );

  const banner =
    state.host && hostAway(state) ? (
      <Banner tone="warning">
        {state.host.name}
        {state.host.signed_in && <SignedInMark />}
        {" (host) is away. Everyone stays on the last place shown."}
      </Banner>
    ) : undefined;

  return (
    <SessionView
      invite={invite}
      title={title}
      kind={state.kind}
      slideCount={state.slideCount}
      place={state.place}
      available={state.available}
      participants={state.participants}
      host={state.host}
      youId={state.you?.participant_id ?? null}
      lead={lead}
      stale={false}
      drawing={state.drawing}
      strokes={state.strokes}
      cursor={state.cursor}
      createLink={createLink}
      toolbarEnd={toolbarEnd}
      banner={banner}
      chat={chat}
      onStep={step}
      onToggleDrawing={() => dispatch({ type: "drawing_toggled" })}
      onClear={() => socket.clearDrawings()}
      onHandOver={(id) => socket.handOver(id)}
      onPlace={onPlace}
      onPointer={onPointer}
      onStrokeStart={onStrokeStart}
      onStrokePoints={onStrokePoints}
    />
  );
}

interface SessionViewProps {
  invite: string;
  title: string;
  kind: PresentState["kind"];
  slideCount: number;
  place: Place;
  available: boolean;
  participants: PresentParticipant[];
  host: PresentHost | null;
  youId: string | null;
  /** This participant is host of a live, available session. */
  lead: boolean;
  /** Stale: nothing can be changed (FR-31). */
  stale: boolean;
  drawing: boolean;
  strokes: PresentState["strokes"];
  cursor: Anchor | null;
  createLink?(iframe: HTMLIFrameElement): FrameLink;
  toolbarEnd: ReactNode;
  banner?: ReactNode;
  chat: ReactNode;
  onStep?(key: string): void;
  onToggleDrawing?(): void;
  onClear?(): void;
  onHandOver?(participantId: string): void;
  onPlace?(place: Place): void;
  onPointer?(anchor: Anchor | null): void;
  onStrokeStart?(stroke: StrokeStart): void;
  onStrokePoints?(id: string, points: [number, number][]): void;
}

const noop = () => {};

/** The session window: frame in the main area, controls in the toolbar, people and chat on the right. */
function SessionView(props: SessionViewProps) {
  const { invite, title, kind, slideCount, place, available, participants, host, youId } = props;
  const { lead, stale, drawing, onStep = noop, onHandOver = noop } = props;
  // The frame loads once at the place shown when it first appears; later places go over the bridge.
  const [src] = useState(() => frameUrl(invite, place.slide));
  const [menuOpen, setMenuOpen] = useState(false);
  const live = !stale && available;
  const others = participants.filter((p) => p.id !== youId);

  return (
    <Window
      sidebar={
        <Sidebar label="Sidebar">
          <AreaNav />
        </Sidebar>
      }
      toolbar={
        <Toolbar label="Presentation session">
          <h1 className={styles.title}>{title}</h1>
          {kind === "slides" && (
            <div className={styles.stepper}>
              <Button
                variant="plain"
                label="Previous slide"
                disabled={!lead}
                onClick={() => onStep("ArrowLeft")}
              >
                ◀
              </Button>
              <span className={styles.position}>{`${(place.slide ?? 0) + 1} / ${slideCount}`}</span>
              <Button
                variant="plain"
                label="Next slide"
                disabled={!lead}
                onClick={() => onStep("ArrowRight")}
              >
                ▶
              </Button>
            </div>
          )}
          <Button
            variant="bordered"
            aria-pressed={drawing}
            disabled={!live}
            onClick={props.onToggleDrawing}
          >
            Draw
          </Button>
          <Button variant="bordered" disabled={!live} onClick={props.onClear}>
            Clear drawings
          </Button>
          {lead && others.length > 0 && (
            <Popover
              label="Hand over…"
              text="Hand over…"
              open={menuOpen}
              onOpenChange={setMenuOpen}
            >
              <ul className={styles.menu}>
                {others.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenuOpen(false);
                        onHandOver(p.id);
                      }}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            </Popover>
          )}
          {props.toolbarEnd}
        </Toolbar>
      }
      banner={props.banner}
      inspector={
        <Inspector open label="Participants and chat">
          <div className={styles.inspector}>
            <section className={styles.people} aria-labelledby="present-people-title">
              <h2 id="present-people-title" className={styles.sectionTitle}>
                Participants
              </h2>
              <ul aria-label="Participants" className={styles.presence}>
                {participants.map((p) => (
                  <li key={p.id} className={styles.person}>
                    <span
                      data-swatch
                      className={styles.swatch}
                      style={{ background: strokeColor(p.color) }}
                      aria-hidden="true"
                    />
                    {p.name}
                    {(p.signed_in || (host?.id === p.id && host.signed_in)) && <SignedInMark />}
                    {host?.id === p.id && <span className={styles.tag}> (host)</span>}
                    {youId === p.id && <span className={styles.tag}> (you)</span>}
                  </li>
                ))}
              </ul>
            </section>
            <div className={styles.chat}>{props.chat}</div>
          </div>
        </Inspector>
      }
    >
      <div className={styles.main}>
        {available ? (
          <PresentationFrame
            frameUrl={src}
            title={title}
            isHost={lead}
            place={place}
            cursor={props.cursor}
            hostName={host?.name ?? null}
            strokes={props.strokes}
            drawing={live && drawing}
            onPlace={props.onPlace ?? noop}
            onPointer={props.onPointer ?? noop}
            onStrokeStart={props.onStrokeStart ?? noop}
            onStrokePoints={props.onStrokePoints ?? noop}
            onKey={onStep}
            createLink={props.createLink}
          />
        ) : (
          <EmptyState icon="exclamation" title="This presentation is no longer available" />
        )}
      </div>
    </Window>
  );
}
