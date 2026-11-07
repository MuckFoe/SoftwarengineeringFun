import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { isMac, label } from "../shortcuts/keys";
import { SHORTCUTS } from "../shortcuts/registry";
import { useShortcut } from "../shortcuts/useShortcut";
import { Icon } from "../ui/Icon";
import styles from "./JumpBar.module.css";
import { filterJump, type JumpItem } from "./jump";
import { useJumpIndex } from "./useJumpIndex";

const KIND_LABEL: Record<JumpItem["kind"], string> = {
  area: "Area",
  session: "Session",
  problem: "Problem",
};

/**
 * "Jump to anything" (spec 016 FR-15): a header trigger and a command-palette dialog opened by
 * ⌘K / Ctrl+K (registry id `jump`). Matching is local, over lists the app already fetched.
 */
export function JumpBar() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const show = () => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    const el = opener.current;
    if (el?.isConnected) el.focus();
    else trigger.current?.focus();
  };

  useShortcut("jump", () => (open ? hide() : show()));

  const shortcut = SHORTCUTS.find((s) => s.id === "jump");
  const mac = isMac();
  const keys = shortcut ? label(mac ? shortcut.mac : shortcut.other, mac) : "";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="app-header-pill app-header-search"
        onClick={show}
      >
        <Icon name="search" />
        <span>Jump to anything</span>
        {keys ? <kbd className={styles.keys}>{keys}</kbd> : null}
      </button>
      {open ? <JumpDialog onClose={hide} /> : null}
    </>
  );
}

function JumpDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { items } = useJumpIndex(true);
  const matches = filterJump(items, query);
  const current = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (i: number) => `${listId}-${i}`;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    input.current?.focus();
  }, []);

  function go(item: JumpItem | undefined) {
    if (!item) return;
    navigate(item.to);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(matches[current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Jump to anything"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <input
        ref={input}
        className={styles.input}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={matches.length ? optionId(current) : undefined}
        aria-label="Jump to"
        placeholder="Jump to anything"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div id={listId} role="listbox" aria-label="Matches" className={styles.list}>
        {matches.map((m, i) => (
          // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: focus stays on the combobox input, which handles the keys
          <div
            key={`${m.kind}:${m.id}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === current}
            className={styles.option}
            onMouseMove={() => setActive(i)}
            onClick={() => go(m)}
          >
            <span>{m.label}</span>
            <span className={styles.kind}>{KIND_LABEL[m.kind]}</span>
          </div>
        ))}
      </div>
      {matches.length === 0 ? <p className={styles.empty}>No matches</p> : null}
    </dialog>
  );
}
