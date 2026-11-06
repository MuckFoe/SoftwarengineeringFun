// Spec 014 FR-3, FR-4, FR-17, FR-21, FR-29, FR-30, FR-32, FR-34, FR-35: the chess session
// window. Pre-join check, name prompt, then board, seats, controls, moves and chat.
import { type FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { reactivateSession } from "../../api/client";
import type { ChatSendMessage } from "../../api/types";
import { useMe } from "../../auth/useMe";
import { apiPath } from "../../base";
import { type ChatTransport, useChat } from "../../chat/useChat";
import { AccountControl } from "../../components/AccountControl";
import { AppearanceControl } from "../../components/AppearanceControl";
import { AreaNav } from "../../components/AreaNav";
import { ChatPane } from "../../components/ChatPane";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { InlineMessage } from "../../ui/InlineMessage";
import { Sidebar } from "../../ui/Sidebar";
import { TextField } from "../../ui/TextField";
import { Toolbar } from "../../ui/Toolbar";
import { Window } from "../../ui/Window";
import { getChessSession } from "../gamesApi";
import { Board } from "./Board";
import styles from "./ChessSessionWindow.module.css";
import { ChessSocket, type SocketFactory } from "./chessSocket";
import {
  bottomColor,
  type ChessLocalAction,
  chessReducer,
  initialChessState,
  roleOf,
} from "./chessState";
import type { ChessClientMessage, ChessServerMessage, PromotionPiece } from "./chessTypes";
import { GameControls } from "./GameControls";
import { MoveList } from "./MoveList";
import { PromotionPicker } from "./PromotionPicker";
import { ClosedSheet, ResultBanner } from "./ResultBanner";
import { SeatsPanel } from "./SeatsPanel";

type Page =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "full" }
  | { kind: "error" }
  | { kind: "ready"; stale: boolean };

const NO_LONGER_EXISTS = "This session no longer exists";

function nameProblem(raw: string): string | null {
  const n = raw.trim().length;
  return n < 1 || n > 30 ? "Enter a name from 1 to 30 characters." : null;
}

interface Props {
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: SocketFactory;
}

type Listener = (payload: never) => void;

export function ChessSessionWindow({ createSocket }: Props) {
  const { invite = "" } = useParams();
  const me = useMe();
  const signedIn = me.status === "ready" && me.me.signed_in;
  const isAdmin = me.status === "ready" && me.me.signed_in && me.me.roles.includes("admin");
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState<string | null | undefined>(undefined);
  const [state, dispatch] = useReducer(chessReducer, initialChessState);
  const [socket, setSocket] = useState<ChessSocket | null>(null);
  const [gone, setGone] = useState<
    "deleted" | "full" | "not_found" | "replaced" | "invalid_name" | null
  >(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const listeners = useRef(new Map<string, Set<Listener>>());

  // The chat's view of the socket: useChat subscribes to frames by type.
  const transport = useMemo<ChatTransport & { emit(type: string, payload: unknown): void }>(
    () => ({
      send: (m: ChatSendMessage) => socketRef.current?.send(m as unknown as ChessClientMessage),
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
  const socketRef = useRef<ChessSocket | null>(null);

  useEffect(() => {
    if (!invite) return;
    let current = true;
    getChessSession(invite).then(
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

  // Signed in: no name prompt (the server names us after the account).
  useEffect(() => {
    if (page.kind === "ready" && signedIn && joinName === undefined) setJoinName(null);
  }, [page.kind, signedIn, joinName]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connects once the name is known.
  useEffect(() => {
    if (page.kind !== "ready" || joinName === undefined) return;
    const s = new ChessSocket({
      invite,
      name: joinName,
      createSocket,
      dispatch: (m: ChessServerMessage) => {
        dispatch(m);
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

  const stale = state.state?.stale ?? (page.kind === "ready" && page.stale);
  const chat = useChat({ invite, provider: socket ? transport : null, stale: false });

  const send = (msg: ChessClientMessage) => socket?.send(msg);
  const dispatchLocal = (a: ChessLocalAction) => dispatch(a);

  function join(e: FormEvent) {
    e.preventDefault();
    const problem = nameProblem(name);
    setNameError(problem);
    if (!problem) setJoinName(name.trim());
  }

  async function reactivate() {
    try {
      await reactivateSession(invite, "/games/chess/sessions");
      setPage({ kind: "ready", stale: false });
      setNotice(null);
      setEpoch((n) => n + 1); // reconnect for a fresh, non-stale snapshot
    } catch {
      setNotice("Could not reactivate the session.");
    }
  }

  async function adminDelete() {
    try {
      const res = await fetch(apiPath(`/games/chess/sessions/${encodeURIComponent(invite)}`), {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setNotice("Could not delete the session.");
    }
  }

  function tryMove(from: string, to: string) {
    const game = state.state?.game;
    if (!game || stale) return;
    const lastRank = to.endsWith("8") || to.endsWith("1");
    if (game.promotions.includes(from) && lastRank) {
      setPromotion({ from, to });
      return;
    }
    socket?.move(from, to, game.ply);
  }

  function choose(piece: PromotionPiece) {
    if (promotion && state.state?.game) {
      socket?.move(promotion.from, promotion.to, state.state.game.ply, piece);
    }
    setPromotion(null);
  }

  const shell = (body: React.ReactNode, banner?: React.ReactNode) => (
    <Window
      sidebarOpen
      sidebar={
        <Sidebar label="Sidebar">
          <AreaNav />
        </Sidebar>
      }
      toolbar={
        <Toolbar label="Chess">
          <h1 className={styles.title}>Chess</h1>
          <span className={styles.spacer} />
          <AppearanceControl />
          <AccountControl />
        </Toolbar>
      }
      banner={banner}
    >
      {body}
    </Window>
  );

  if (page.kind === "not_found" || gone === "not_found" || gone === "deleted") {
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
        <h2>Join this game</h2>
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
      </div>,
    );
  }

  const snap = state.state;
  const game = snap?.game ?? null;
  const youId = state.you?.participant_id ?? "";
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

  return shell(
    <div className={styles.layout}>
      <div className={styles.main}>
        {state.closed ? <ClosedSheet closed={state.closed} /> : null}
        {state.error && !state.error.startsWith("chat_") && !state.error.startsWith("gif_") && (
          <InlineMessage id="chess-error">{errorText(state.error)}</InlineMessage>
        )}
        {notice && <InlineMessage id="chess-notice">{notice}</InlineMessage>}
        {game?.status === "ended" && game.result && game.reason && (
          <ResultBanner result={game.result} reason={game.reason} />
        )}
        {snap && (
          <>
            <fieldset className={styles.frozen} disabled={stale} aria-label="Board">
              {game && (
                <Board
                  game={game}
                  seat={stale ? "viewer" : roleOf(state)}
                  bottom={bottomColor(state)}
                  selected={state.selected}
                  onSelect={(square) => dispatchLocal({ type: "square_selected", square })}
                  onMove={tryMove}
                />
              )}
            </fieldset>
            <Button variant="plain" onClick={() => dispatchLocal({ type: "flip_toggled" })}>
              Flip board
            </Button>
            {promotion && <PromotionPicker onChoose={choose} onCancel={() => setPromotion(null)} />}
            <fieldset className={styles.frozen} disabled={stale} aria-label="Seats and controls">
              <SeatsPanel snapshot={snap} youId={youId} send={send} />
              <GameControls
                state={state}
                send={send}
                isAdmin={isAdmin}
                onAdminDelete={() => void adminDelete()}
              />
            </fieldset>
            {game && <MoveList moves={game.moves} />}
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
