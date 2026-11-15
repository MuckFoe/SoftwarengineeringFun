// Spec 021 FR-2, FR-6, FR-13, FR-19, FR-20, FR-23: the Rock Paper Siege session window, as the
// chess session window (spec 014): pre-join check, name prompt, then board, setup bar or duel
// picker, seats, controls, result and chat.
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router";
import { reactivateSession } from "../../api/client";
import type { ChatSendMessage } from "../../api/types";
import { useMe } from "../../auth/useMe";
import { apiPath, BASE } from "../../base";
import { type ChatTransport, useChat } from "../../chat/useChat";
import { ChatPane } from "../../components/ChatPane";
import { AppHeader } from "../../ui/AppHeader";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Dialog } from "../../ui/Dialog";
import { InlineMessage } from "../../ui/InlineMessage";
import { CopyInviteButton, InviteLink } from "../../ui/InviteLink";
import { TextField } from "../../ui/TextField";
import { Window } from "../../ui/Window";
import controlStyles from "../chess/GameControls.module.css";
import { getRpsSession } from "../gamesApi";
import { DuelPicker } from "./DuelPicker";
import { RpsBoard } from "./RpsBoard";
import { RpsClosedSheet, RpsResultBanner } from "./RpsResult";
import { RpsSeatsPanel } from "./RpsSeatsPanel";
import styles from "./RpsSessionWindow.module.css";
import { RpsSocket, type SocketFactory, storedRejoin } from "./rpsSocket";
import {
  announcementOf,
  bottomSide,
  initialRpsClientState,
  opposite,
  type RpsClientState,
  roleOf,
  rpsReducer,
} from "./rpsState";
import type { RpsClientMessage, RpsEvent, RpsGame, RpsServerMessage } from "./rpsTypes";
import { type Placing, SetupBar, setupPlaceFrame } from "./SetupBar";

type Page =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "full" }
  | { kind: "error" }
  | { kind: "ready"; stale: boolean };

/** Before the first game the board is empty and inert. */
const NO_GAME: RpsGame = {
  status: "ended",
  ready: { a: false, b: false },
  first: "a",
  turn: null,
  ply: 0,
  pieces: [],
  legal: {},
  duel: null,
  draw_offer_by: null,
  claim_available_to: null,
  result: null,
  reason: null,
};

const NO_LONGER_EXISTS = "This session no longer exists";
const TITLE = "Rock Paper Siege";

function nameProblem(raw: string): string | null {
  const n = raw.trim().length;
  return n < 1 || n > 30 ? "Enter a name from 1 to 30 characters." : null;
}

interface Props {
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: SocketFactory;
}

type Listener = (payload: never) => void;

export function RpsSessionWindow({ createSocket }: Props) {
  const { invite = "" } = useParams();
  const inviteLink = new URL(
    `${BASE}games/rps/s/${encodeURIComponent(invite)}`,
    window.location.origin,
  ).toString();
  const me = useMe();
  const signedIn = me.status === "ready" && me.me.signed_in;
  const isAdmin = me.status === "ready" && me.me.signed_in && me.me.roles.includes("admin");
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState<string | null | undefined>(undefined);
  const [state, dispatch] = useReducer(rpsReducer, initialRpsClientState);
  const [socket, setSocket] = useState<RpsSocket | null>(null);
  const [gone, setGone] = useState<
    "deleted" | "full" | "not_found" | "replaced" | "invalid_name" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [placing, setPlacing] = useState<Placing>("flag");
  // The latest event, for the board's fight/trap effect; events are transient (plan decision 4).
  const [lastEvent, setLastEvent] = useState<RpsEvent | null>(null);
  const listeners = useRef(new Map<string, Set<Listener>>());
  const socketRef = useRef<RpsSocket | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLFieldSetElement>(null);

  // The chat's view of the socket: useChat subscribes to frames by type.
  const transport = useMemo<ChatTransport & { emit(type: string, payload: unknown): void }>(
    () => ({
      send: (m: ChatSendMessage) => socketRef.current?.send(m as unknown as RpsClientMessage),
      on: (type, handler) => {
        const set = listeners.current.get(type) ?? new Set<Listener>();
        set.add(handler as Listener);
        listeners.current.set(type, set);
        return () => set.delete(handler as Listener);
      },
      emit: (type, payload) => {
        for (const h of listeners.current.get(type) ?? []) h(payload as never);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!invite) return;
    let current = true;
    getRpsSession(invite).then(
      (found) => {
        if (!current) return;
        if ("error" in found) setPage({ kind: "not_found" });
        else if (found.full) setPage({ kind: "full" });
        else setPage({ kind: "ready", stale: found.stale });
      },
      () => current && setPage({ kind: "error" }),
    );
    return () => {
      current = false;
    };
  }, [invite]);

  // Signed in: no name prompt. A guest holding a rejoin token is the same participant as before.
  useEffect(() => {
    if (page.kind !== "ready" || joinName !== undefined) return;
    if (signedIn || storedRejoin(invite)) setJoinName(null);
  }, [page.kind, signedIn, joinName, invite]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connects once the name is known.
  useEffect(() => {
    if (page.kind !== "ready" || joinName === undefined) return;
    const s = new RpsSocket({
      invite,
      name: joinName,
      createSocket,
      dispatch: (m: RpsServerMessage) => {
        dispatch(m);
        if (m.type === "state") setLastEvent(m.event ?? null);
        else if (m.type === "welcome") setLastEvent(null);
        transport.emit(m.type, m);
      },
      onClosed: (ev) => {
        transport.emit("closed", ev);
        setGone(ev.error);
      },
    });
    socketRef.current = s;
    setSocket(s);
    return () => {
      s.destroy();
      socketRef.current = null;
    };
  }, [page.kind, joinName, invite, epoch]);

  const snap = state.state;
  const game = snap?.game ?? null;
  const role = roleOf(state);
  const duel = game?.status === "play" ? (game.duel ?? null) : null;
  const inSetup = game?.status === "setup";

  // Plan UI notes: focus moves back to the board when a duel ends, unless the reader has since
  // moved it somewhere else (for example into the chat).
  const hadDuel = useRef(false);
  useEffect(() => {
    const had = hadDuel.current;
    hadDuel.current = duel !== null;
    if (!had || duel !== null) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    boardRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
  }, [duel]);

  // The board's height cap (RpsBoard.module.css): everything above it (header, banner) plus the
  // setup/duel bar below it and the dock's reach at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the bar changes.
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const measure = () => {
      const top = Math.max(0, layout.getBoundingClientRect().top);
      const bar = barRef.current?.getBoundingClientRect().height ?? 0;
      const px = Math.round(top + bar);
      layout.style.setProperty(
        "--rps-board-reserve",
        `calc(${px}px + var(--dock-height) / 2 + var(--space-8) * 2 + var(--space-16) * 2)`,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (barRef.current) ro?.observe(barRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [snap !== null, inSetup, duel !== null]);

  const stale = snap?.stale ?? (page.kind === "ready" && page.stale);
  const chat = useChat({ invite, provider: socket ? transport : null, stale: false });

  const send = (msg: RpsClientMessage) => socket?.send(msg);

  function join(e: FormEvent) {
    e.preventDefault();
    const problem = nameProblem(name);
    setNameError(problem);
    if (!problem) setJoinName(name.trim());
  }

  async function reactivate() {
    try {
      await reactivateSession(invite, "/games/rps/sessions");
      setPage({ kind: "ready", stale: false });
      setNotice(null);
      setEpoch((n) => n + 1); // reconnect for a fresh, non-stale snapshot
    } catch {
      setNotice("Could not reactivate the session.");
    }
  }

  async function adminDelete() {
    try {
      const res = await fetch(apiPath(`/games/rps/sessions/${encodeURIComponent(invite)}`), {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setNotice("Could not delete the session.");
    }
  }

  function setupSquare(square: number) {
    if (!game || stale) return;
    const frame = setupPlaceFrame(game, role, placing, square);
    if (frame) send(frame);
  }

  const shell = (body: React.ReactNode, banner?: React.ReactNode, header = true) => (
    <Window
      toolbar={
        <AppHeader
          label={TITLE}
          actions={header ? <CopyInviteButton link={inviteLink} /> : undefined}
        >
          <h1 className={styles.title}>{TITLE}</h1>
        </AppHeader>
      }
      banner={banner}
    >
      {body}
    </Window>
  );

  // A closed-by-result sheet outlives the deletion that follows it.
  const deletedNow = page.kind === "not_found" || gone === "not_found" || gone === "deleted";
  if (deletedNow && !state.closed) {
    return shell(<DeletedNotice />);
  }
  if (page.kind === "full" || gone === "full") {
    return shell(<div className={styles.center}>This session is full.</div>);
  }
  if (gone === "replaced") {
    return shell(
      <div className={styles.center}>This session was opened in another tab or window.</div>,
    );
  }
  if (page.kind === "error") {
    return shell(<div className={styles.center}>Could not load this session.</div>);
  }

  if (page.kind === "loading" || me.status === "loading") return shell(null);

  if (joinName === undefined || gone === "invalid_name") {
    return shell(
      <div className={styles.center}>
        <Card className={styles.joinCard}>
          <h2 className={styles.joinTitle}>Join this game</h2>
          <InviteLink link={inviteLink} />
          <form className={styles.joinForm} onSubmit={join}>
            <TextField
              label="Your name"
              value={name}
              onChange={setName}
              invalid={nameError !== null || gone === "invalid_name"}
            />
            {(nameError || gone === "invalid_name") && (
              <InlineMessage id="join-name-error">
                {nameError ?? "That name was refused by the server."}
              </InlineMessage>
            )}
            <Button
              variant="primary"
              type="submit"
              onClick={() => {
                if (gone === "invalid_name") setGone(null);
              }}
            >
              Join
            </Button>
          </form>
        </Card>
      </div>,
      undefined,
      false,
    );
  }

  const banner = stale ? (
    <Banner
      tone="warning"
      actions={
        isAdmin ? (
          <Button variant="bordered" onClick={() => void reactivate()}>
            Reactivate
          </Button>
        ) : undefined
      }
    >
      This session is stale and read-only.
    </Banner>
  ) : undefined;

  const announcement = announcementOf(state);
  const ended = game?.status === "ended" && game.result && game.reason ? game : null;

  return shell(
    <div className={styles.layout} ref={layoutRef} data-rps-layout="">
      <div className={styles.boardCol}>
        {snap && (
          <fieldset
            ref={boardRef}
            className={`${styles.frozen} ${styles.boardBox}`}
            disabled={stale}
            aria-label="Board"
          >
            <RpsBoard
              game={game ?? NO_GAME}
              you={stale || !game ? "viewer" : role}
              bottom={bottomSide(state)}
              selected={state.selected}
              onSelect={(square) => dispatch({ type: "square_selected", square })}
              onMove={(from, to) => send({ type: "move", from, to })}
              onSetupSquare={inSetup && !stale ? setupSquare : undefined}
              event={lastEvent}
            />
          </fieldset>
        )}
        <div ref={barRef} className={styles.bar}>
          {snap && game && inSetup && (
            <fieldset className={styles.frozen} disabled={stale} aria-label="Setup controls">
              <SetupBar
                game={game}
                you={role}
                placing={placing}
                onPlacingChange={setPlacing}
                send={send}
              />
            </fieldset>
          )}
          {snap && duel && (
            <fieldset className={styles.frozen} disabled={stale} aria-label="Duel controls">
              <DuelPicker
                duel={duel}
                you={role}
                onPick={(weapon) => send({ type: "duel_pick", weapon })}
              />
            </fieldset>
          )}
        </div>
      </div>
      <div className={styles.side}>
        {state.closed ? <RpsClosedSheet closed={state.closed} you={role} /> : null}
        {state.error && !state.error.startsWith("chat_") && !state.error.startsWith("gif_") && (
          <InlineMessage id="rps-error">{errorText(state.error)}</InlineMessage>
        )}
        {notice && <InlineMessage id="rps-notice">{notice}</InlineMessage>}
        {/* The one polite live region (plan UI notes): new events, then how the game ended. */}
        <div role="status" aria-live="polite" aria-label="Game events" className={styles.events}>
          {announcement && <p className={styles.event}>{announcement.text}</p>}
          {ended?.result && ended.reason && (
            <RpsResultBanner result={ended.result} reason={ended.reason} you={role} live={false} />
          )}
        </div>
        {snap && (
          <>
            {role === "viewer" && <p className={styles.watching}>You are watching.</p>}
            <fieldset className={styles.frozen} disabled={stale} aria-label="Seats and controls">
              <RpsSeatsPanel state={snap} send={send} />
              <RpsControls
                state={state}
                send={send}
                isAdmin={isAdmin}
                onAdminDelete={() => void adminDelete()}
              />
            </fieldset>
          </>
        )}
      </div>
      <aside className={styles.chat} aria-label="Chat">
        <ChatPane
          messages={chat.messages}
          readOnly={stale}
          send={chat.send}
          canRemove={chat.canRemove}
          remove={chat.remove}
        />
      </aside>
    </div>,
    banner,
  );
}

type Pending = "resign" | "claim" | "delete" | null;

const CONFIRM: Record<Exclude<Pending, null>, { title: string; text: string }> = {
  resign: { title: "Resign?", text: "You lose this game." },
  claim: { title: "Claim win?", text: "Your opponent has been away. The game ends in your win." },
  delete: { title: "Delete session?", text: "This closes the session for everyone." },
};

/** Start, Offer draw, Accept/Decline, Resign, Claim win, Delete: chess's GameControls for sides. */
function RpsControls({
  state,
  send,
  isAdmin,
  onAdminDelete,
}: {
  state: RpsClientState;
  send(msg: RpsClientMessage): void;
  isAdmin: boolean;
  onAdminDelete(): void;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const snap = state.state;
  if (!snap) return null;

  const role = roleOf(state);
  const game = snap.game;
  const inProgress = game !== null && game.status !== "ended";
  const bothSeated = snap.seats.a !== null && snap.seats.b !== null;
  const isPlayer = role !== "viewer";
  const canDelete = (state.you?.is_starter ?? false) || isAdmin;

  let startReason: string | null = null;
  if (!bothSeated) startReason = "Waiting for a second player";
  else if (!isPlayer) startReason = "Only players can start";

  function run() {
    const what = pending;
    setPending(null);
    if (what === "resign") send({ type: "resign" });
    else if (what === "claim") send({ type: "claim_win" });
    else if (what === "delete") {
      if (state.you?.is_starter) send({ type: "delete_session" });
      else onAdminDelete();
    }
  }

  const offerBy = game?.draw_offer_by ?? null;
  const offerToMe = role !== "viewer" && offerBy === opposite(role);
  const offeredByMe = isPlayer && offerBy === role;
  const playing = game?.status === "play";

  return (
    <div className={controlStyles.controls}>
      {!inProgress && (
        <div className={controlStyles.row}>
          <Button
            variant="primary"
            disabled={startReason !== null}
            onClick={() => send({ type: "start" })}
          >
            Start
          </Button>
          {startReason && <p className={controlStyles.hint}>{startReason}</p>}
        </div>
      )}
      {inProgress && isPlayer && (
        <div className={controlStyles.row}>
          <Button variant="destructive" onClick={() => setPending("resign")}>
            Resign
          </Button>
          {playing && (
            <Button disabled={offeredByMe} onClick={() => send({ type: "offer_draw" })}>
              Offer draw
            </Button>
          )}
          {playing && offeredByMe && <p className={controlStyles.hint}>Draw offered</p>}
          {playing && offerToMe && (
            <>
              <Button onClick={() => send({ type: "answer_draw", accept: true })}>Accept</Button>
              <Button onClick={() => send({ type: "answer_draw", accept: false })}>Decline</Button>
            </>
          )}
          <Button disabled={game?.claim_available_to !== role} onClick={() => setPending("claim")}>
            Claim win
          </Button>
        </div>
      )}
      {canDelete && (
        <Button variant="destructive" onClick={() => setPending("delete")}>
          Delete session
        </Button>
      )}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? CONFIRM[pending].title : ""}
        defaultAction={run}
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={run}>
              Confirm
            </Button>
          </>
        }
      >
        {pending && <p className={controlStyles.confirm}>{CONFIRM[pending].text}</p>}
      </Dialog>
    </div>
  );
}

function DeletedNotice() {
  return (
    <div className={styles.center}>
      <p>{NO_LONGER_EXISTS}</p>
      <Link to="/games">Back to Games</Link>
    </div>
  );
}

function errorText(code: string): string {
  return `The server refused that (${code.replace(/_/g, " ")}).`;
}
