/**
 * The shortcut runtime (FR-17): one capture-phase `keydown` listener on `window`, set up
 * by <ShortcutsProvider>. Windows and open sheets mount <ShortcutScope> to activate their
 * scope; `useShortcut` registers a handler for a registry id. On a match the event is
 * consumed (preventDefault + stopPropagation) before the focused element, such as the
 * editor, sees it.
 */
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isMac, matches } from "./keys";
import { type Scope, SHORTCUTS, type ShortcutId } from "./registry";

interface Registration {
  run(): void;
}

class ShortcutRuntime {
  private scopes = new Map<Scope, number>();
  private handlers = new Map<ShortcutId, Registration[]>();

  constructor(private mac: boolean) {}

  enterScope(scope: Scope): () => void {
    this.scopes.set(scope, (this.scopes.get(scope) ?? 0) + 1);
    return () => this.scopes.set(scope, (this.scopes.get(scope) ?? 1) - 1);
  }

  register(id: ShortcutId, registration: Registration): () => void {
    const list = this.handlers.get(id) ?? [];
    this.handlers.set(id, [...list, registration]);
    return () =>
      this.handlers.set(
        id,
        (this.handlers.get(id) ?? []).filter((r) => r !== registration),
      );
  }

  /** A sheet is modal: while one is open only sheet and global shortcuts apply. */
  private active(scope: Scope): boolean {
    if (scope === "global") return true;
    const sheetOpen = (this.scopes.get("sheet") ?? 0) > 0;
    if (sheetOpen) return scope === "sheet";
    return (this.scopes.get(scope) ?? 0) > 0;
  }

  onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && handlesOwnReturn(e.target)) {
      return;
    }
    for (const s of SHORTCUTS) {
      if (!this.active(s.scope) || !matches(e, this.mac ? s.mac : s.other, this.mac)) continue;
      const latest = this.handlers.get(s.id)?.at(-1);
      if (!latest) continue;
      e.preventDefault();
      e.stopPropagation();
      latest.run();
      return;
    }
  };
}

/** Return on these does its own thing (new line, press the button, follow the link). */
function handlesOwnReturn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest("textarea, button, a[href], select"))
  );
}

const RuntimeContext = createContext<ShortcutRuntime | null>(null);

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => new ShortcutRuntime(isMac()));
  useEffect(() => {
    window.addEventListener("keydown", runtime.onKeyDown, true);
    return () => window.removeEventListener("keydown", runtime.onKeyDown, true);
  }, [runtime]);
  return createElement(RuntimeContext.Provider, { value: runtime }, children);
}

/**
 * The app root mounts <ShortcutsProvider>. Without one (a page rendered on its own, as in
 * a component test) shortcuts are simply inactive.
 */
function useRuntime(): ShortcutRuntime | null {
  return useContext(RuntimeContext);
}

/** Activates `scope` while mounted. */
export function ShortcutScope({ scope, children }: { scope: Scope; children?: ReactNode }) {
  const runtime = useRuntime();
  useEffect(() => runtime?.enterScope(scope), [runtime, scope]);
  return children ?? null;
}

export function useShortcut(
  id: ShortcutId,
  handler: () => void,
  opts: { enabled?: boolean } = {},
): void {
  const runtime = useRuntime();
  const latest = useRef(handler);
  latest.current = handler;
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled || !runtime) return;
    return runtime.register(id, { run: () => latest.current() });
  }, [runtime, id, enabled]);
}
