// The session's sketch board (spec 022 plan, Frontend — `useSketch.ts`). Subscribes to the
// session socket's messages as useChat does, owns the reducer, and sends drawing actions.
// It lives with the session window, not the board, so it keeps applying messages while the
// board is closed and opening it shows the current board without a fetch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialSketchState,
  type SketchEvent,
  sketchReducer,
  undoTarget,
  visible,
} from "./sketchState";
import type {
  SketchAction,
  SketchAddedMessage,
  SketchAddMessage,
  SketchClientMessage,
  SketchRefusedMessage,
  SketchRemovedMessage,
  SketchSnapshot,
} from "./sketchTypes";

/** The messages useSketch listens to, with only the fields it reads. */
export type SketchEvents = {
  welcome: { sketch?: SketchSnapshot };
  sketch_added: Pick<SketchAddedMessage, "action">;
  sketch_removed: Pick<SketchRemovedMessage, "seq">;
  sketch_refused: Omit<SketchRefusedMessage, "type">;
  closed: unknown;
};

/** What useSketch needs from a session connection: send a JSON message, subscribe to JSON messages. */
export interface SketchTransport {
  send(message: SketchClientMessage): void;
  on<K extends keyof SketchEvents>(
    type: K,
    handler: (payload: SketchEvents[K]) => void,
  ): () => void;
}

/** A board change made by another participant, for the live region. */
export type OthersChange =
  | { type: "added"; action: SketchAction }
  | { type: "removed"; seq: number };

export function useSketch({
  provider,
  onOthersChange,
}: {
  provider: SketchTransport | null;
  onOthersChange?: (change: OthersChange) => void;
}) {
  // The state is held in a ref and applied synchronously, so whether an event is new and
  // whose it is are judged against every event before it, even within one render.
  const stateRef = useRef(initialSketchState());
  const [state, setState] = useState(stateRef.current);
  const onOthers = useRef(onOthersChange);
  onOthers.current = onOthersChange;

  const apply = useCallback((e: SketchEvent) => {
    stateRef.current = sketchReducer(stateRef.current, e);
    setState(stateRef.current);
  }, []);

  useEffect(() => {
    if (!provider) return;
    const offs = [
      provider.on("welcome", (m) => {
        if (m.sketch) apply({ type: "snapshot", snapshot: m.sketch });
      }),
      provider.on("sketch_added", ({ action }) => {
        const s = stateRef.current;
        const known =
          action.seq <= s.floor ||
          s.removed.has(action.seq) ||
          s.confirmed.some((a) => a.seq === action.seq);
        apply({ type: "added", action });
        if (!known && !s.ownClientIds.has(action.client_id))
          onOthers.current?.({ type: "added", action });
      }),
      provider.on("sketch_removed", ({ seq }) => {
        const s = stateRef.current;
        const fresh = !s.removed.has(seq) && !s.ownSeqs.includes(seq);
        apply({ type: "removed", seq });
        if (fresh) onOthers.current?.({ type: "removed", seq });
      }),
      provider.on("sketch_refused", ({ client_id, seq, reason }) =>
        apply({ type: "refused", client_id, seq, reason }),
      ),
      // An own action never answered: if the server took it, the next welcome brings it back.
      provider.on("closed", () => {
        for (const p of stateRef.current.pending)
          apply({ type: "refused", client_id: p.client_id, reason: "invalid" });
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [provider, apply]);

  const add = useCallback(
    (action: SketchAddMessage["action"]) => {
      if (!provider) return;
      const client_id = crypto.randomUUID();
      apply({ type: "local", action: { client_id, ...action } });
      provider.send({ type: "sketch_add", client_id, action });
    },
    [provider, apply],
  );

  const clear = useCallback(() => {
    if (!provider) return;
    const client_id = crypto.randomUUID();
    apply({ type: "local", action: { client_id, kind: "clear" } });
    provider.send({ type: "sketch_clear", client_id });
  }, [provider, apply]);

  const undo = useCallback(() => {
    const seq = undoTarget(stateRef.current);
    if (!provider || seq === undefined) return;
    provider.send({ type: "sketch_undo", seq });
  }, [provider]);

  const shown = useMemo(() => visible(state), [state]);

  return {
    visible: shown,
    full: state.full,
    canUndo: undoTarget(state) !== undefined,
    add,
    clear,
    undo,
  };
}
