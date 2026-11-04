// Spec 013 bridge: the frame side of the bridge protocol (plan "Bridge protocol").
// frame.py injects this as the first script of the presentation, prefixed with
// `window.__SDD = {kind, slide}`. It shows one slide at a time, locks scrolling while the
// viewer follows, turns viewport points into content anchors and back, and reports the
// pointer, scrolling and keys to the session page. It only obeys window.parent.
(() => {
  "use strict";

  const config = window.__SDD || {};
  const parentWin = window.parent;
  const hasParent = parentWin && parentWin !== window;
  const post = (msg) => {
    if (hasParent) parentWin.postMessage(msg, "*");
  };

  // NFR-2 / plan Isolation 4: WebRTC isn't governed by CSP; take it away.
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) {
    try {
      delete window[name];
    } catch (_) {
      // fall through to the define below
    }
    if (typeof window[name] !== "undefined") {
      try {
        Object.defineProperty(window, name, { value: undefined, configurable: false });
      } catch (_) {
        // nothing more can be done from here
      }
    }
  }

  // ---- Slides (plan "Slides vs. single page") --------------------------------------------

  const CURRENT = "data-sdd-current";

  /** The slide marks: top-level [data-slide], else body > section. */
  function marks() {
    const top = [];
    for (const el of document.querySelectorAll("[data-slide]")) {
      if (!el.parentElement?.closest("[data-slide]")) top.push(el);
    }
    if (top.length) return top;
    return Array.from(document.querySelectorAll("body > section"));
  }

  function initialSlide() {
    const m = /(?:^#|&)slide=(\d+)/.exec(location.hash);
    if (m) return Number(m[1]);
    return typeof config.slide === "number" ? config.slide : 0;
  }

  let slide = initialSlide();
  let kind = config.kind === "slides" ? "slides" : "page";

  /** Puts CURRENT on mark `slide` (clamped) and nowhere else. */
  function applySlide() {
    const list = marks();
    if (!list.length) return;
    const index = Math.max(0, Math.min(slide, list.length - 1));
    for (const el of document.querySelectorAll(`[${CURRENT}]`)) {
      if (el !== list[index]) el.removeAttribute(CURRENT);
    }
    if (!list[index].hasAttribute(CURRENT)) list[index].setAttribute(CURRENT, "");
  }

  // Mark the current slide as the parser creates it, before anything is painted: mutation
  // callbacks run as microtasks, ahead of the next rendering step and of inline scripts.
  const observer = new MutationObserver(applySlide);
  observer.observe(document, { childList: true, subtree: true });

  // ---- Anchors (plan "Content-relative place") -------------------------------------------

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /** Anchor {path, fx, fy} of the viewport point (x, y), with the element's rect. */
  function anchorAt(x, y) {
    const body = document.body;
    if (!body) return { anchor: null, rect: null };
    let el = document.elementFromPoint(x, y);
    if (!el || !body.contains(el)) el = body;
    const path = [];
    for (let node = el; node !== body; node = node.parentElement) {
      path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
    }
    const rect = rectOf(el);
    const fx = rect.w > 0 ? (x - rect.x) / rect.w : 0.5;
    const fy = rect.h > 0 ? (y - rect.y) / rect.h : 0.5;
    return { anchor: { path, fx, fy }, rect };
  }

  /** The element an anchor names, or its nearest existing ancestor. */
  function elementOf(anchor) {
    let el = document.body;
    if (!el) return null;
    for (const index of anchor.path || []) {
      const child = el.children[index];
      if (!child) break;
      el = child;
    }
    return el;
  }

  function resolve(anchor) {
    if (!anchor) return null;
    const el = elementOf(anchor);
    return el ? rectOf(el) : null;
  }

  function centreAnchor() {
    return anchorAt(window.innerWidth / 2, window.innerHeight / 2).anchor;
  }

  /** Scrolls so the anchor's point is at the viewport's centre (the browser clamps). */
  function scrollToAnchor(anchor) {
    const rect = resolve(anchor);
    if (!rect) return;
    const x = rect.x + anchor.fx * rect.w;
    const y = rect.y + anchor.fy * rect.h;
    window.scrollTo({
      left: window.scrollX + x - window.innerWidth / 2,
      top: window.scrollY + y - window.innerHeight / 2,
      behavior: "instant",
    });
  }

  // ---- Following (plan "Following and not leading") --------------------------------------

  let following = false;
  const NAV_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " ",
    "Spacebar",
  ]);
  const SLIDE_KEYS = new Set(["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);

  function setFollow(on) {
    following = !!on;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      if (following) el.style.setProperty("overflow", "hidden", "important");
      else el.style.removeProperty("overflow");
    }
  }

  // ---- Reports to the page ---------------------------------------------------------------

  let layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      post({ sdd: "layout" });
    });
  }

  let scrollQueued = false;
  function onScroll() {
    queueLayout();
    if (following || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      post({ sdd: "scrolled", anchor: centreAnchor() });
    });
  }

  let pointerAt = null;
  let pointerQueued = false;
  function onPointerMove(event) {
    pointerAt = { x: event.clientX, y: event.clientY };
    if (pointerQueued) return;
    pointerQueued = true;
    requestAnimationFrame(() => {
      pointerQueued = false;
      if (!pointerAt) return;
      const { x, y } = pointerAt;
      post({ sdd: "pointer", x, y, anchor: anchorAt(x, y).anchor });
    });
  }

  function onPointerOut(event) {
    if (event.relatedTarget) return;
    pointerAt = null;
    post({ sdd: "pointer", anchor: null });
  }

  function onKey(event) {
    if (SLIDE_KEYS.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      post({ sdd: "key", key: event.key });
      if (kind === "slides") event.preventDefault();
    }
    if (following && NAV_KEYS.has(event.key)) event.preventDefault();
  }

  function onWheel(event) {
    if (following) event.preventDefault();
  }

  // ---- Messages from the page ------------------------------------------------------------

  function onMessage(event) {
    if (!hasParent || event.source !== parentWin) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object" || typeof msg.sdd !== "string") return;
    switch (msg.sdd) {
      case "show": {
        let changed = false;
        if (typeof msg.slide === "number" && msg.slide !== slide) {
          slide = msg.slide;
          applySlide();
          changed = true;
        }
        if (msg.anchor) scrollToAnchor(msg.anchor);
        else if (changed) window.scrollTo({ left: 0, top: 0, behavior: "instant" });
        if (changed) queueLayout();
        break;
      }
      case "follow":
        setFollow(msg.on);
        break;
      case "resolve":
        post({
          sdd: "resolved",
          req: msg.req,
          rects: (Array.isArray(msg.anchors) ? msg.anchors : []).map(resolve),
        });
        break;
      case "anchorAt": {
        const found = anchorAt(Number(msg.x), Number(msg.y));
        post({ sdd: "anchorAt", req: msg.req, anchor: found.anchor, rect: found.rect });
        break;
      }
      default:
        break;
    }
  }

  window.addEventListener("message", onMessage);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", queueLayout);
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("mousemove", onPointerMove, true);
  document.addEventListener("mouseout", onPointerOut, true);

  document.addEventListener("DOMContentLoaded", () => {
    applySlide();
    const count = marks().length;
    kind = count ? "slides" : "page";
    if (following) setFollow(true); // body now exists
    post({ sdd: "ready", kind, slideCount: count });
    window.addEventListener("load", () => observer.disconnect(), { once: true });
  });
})();
