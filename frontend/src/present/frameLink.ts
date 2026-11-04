// Parent side of the bridge protocol (plan.md "Bridge protocol"): talks to the presentation
// frame over postMessage. Only messages whose source is this iframe's window are accepted
// (NFR-2); requests that the frame doesn't answer in time resolve to null (FR-18).
import type { Anchor, FrameToPageMessage, PageToFrameMessage, Place, Rect } from "./presentTypes";

export const REQUEST_TIMEOUT_MS = 150;

/** Frame → page messages that are events rather than answers to a request. */
export type FrameEventType = Exclude<FrameToPageMessage["sdd"], "resolved" | "anchorAt">;
export type FrameEvent<T extends FrameEventType> = Extract<FrameToPageMessage, { sdd: T }>;

export interface AnchorHit {
  anchor: Anchor | null;
  rect: Rect | null;
}

export interface FrameLink {
  show(place: Place): void;
  follow(on: boolean): void;
  /** Viewport rects (frame coordinates) for each anchor; null if the frame doesn't answer. */
  resolve(anchors: (Anchor | null)[]): Promise<(Rect | null)[] | null>;
  /** The anchor under a frame-viewport point; null if the frame doesn't answer. */
  anchorAt(x: number, y: number): Promise<AnchorHit | null>;
  /** Subscribe to a frame event; returns the unsubscribe. */
  on<T extends FrameEventType>(type: T, handler: (msg: FrameEvent<T>) => void): () => void;
  destroy(): void;
}

type Pending = { settle: (msg: FrameToPageMessage | null) => void };

export function createFrameLink(iframe: HTMLIFrameElement): FrameLink {
  const handlers = new Map<FrameEventType, Set<(msg: FrameToPageMessage) => void>>();
  const pending = new Map<number, Pending>();
  let nextReq = 1;
  let destroyed = false;

  function post(msg: PageToFrameMessage) {
    // The frame's origin is opaque, so "*" is the only target that reaches it; nothing secret travels.
    iframe.contentWindow?.postMessage(msg, "*");
  }

  function request(build: (req: number) => PageToFrameMessage): Promise<FrameToPageMessage | null> {
    if (destroyed) return Promise.resolve(null);
    const req = nextReq++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(null), REQUEST_TIMEOUT_MS);
      function settle(msg: FrameToPageMessage | null) {
        clearTimeout(timer);
        pending.delete(req);
        resolve(msg);
      }
      pending.set(req, { settle });
      post(build(req));
    });
  }

  function onMessage(event: MessageEvent) {
    if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
    const msg = event.data as FrameToPageMessage | null;
    if (!msg || typeof msg !== "object" || typeof msg.sdd !== "string") return;
    if (msg.sdd === "resolved" || msg.sdd === "anchorAt") {
      pending.get(msg.req)?.settle(msg);
      return;
    }
    for (const handler of handlers.get(msg.sdd) ?? []) handler(msg);
  }

  window.addEventListener("message", onMessage);

  return {
    show(place) {
      post({ sdd: "show", slide: place.slide, anchor: place.anchor });
    },
    follow(on) {
      post({ sdd: "follow", on });
    },
    async resolve(anchors) {
      const msg = await request((req) => ({ sdd: "resolve", req, anchors }));
      return msg?.sdd === "resolved" ? msg.rects : null;
    },
    async anchorAt(x, y) {
      const msg = await request((req) => ({ sdd: "anchorAt", req, x, y }));
      return msg?.sdd === "anchorAt" ? { anchor: msg.anchor, rect: msg.rect } : null;
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      handlers.set(type, set);
      const h = handler as (msg: FrameToPageMessage) => void;
      set.add(h);
      return () => {
        set.delete(h);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("message", onMessage);
      handlers.clear();
      for (const p of [...pending.values()]) p.settle(null);
    },
  };
}
