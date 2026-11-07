import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import "./dialog.css";
import { IconButton } from "./IconButton";

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Return in the dialog submits its form; this runs then (FR-17 default button). */
  defaultAction?: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Audi dialog on a native <dialog> (showModal gives backdrop and Esc as `cancel`). It never
 * navigates, so whatever opened it stays mounted underneath. Tab is trapped explicitly and
 * focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, children, footer, defaultAction }: Props) {
  if (!open) return null;
  return (
    <OpenDialog onClose={onClose} title={title} footer={footer} defaultAction={defaultAction}>
      {children}
    </OpenDialog>
  );
}

function OpenDialog({ onClose, title, children, footer, defaultAction }: Omit<Props, "open">) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const latestOnClose = useRef(onClose);
  latestOnClose.current = onClose;

  // Opened once per mount: showModal() on an already-open dialog throws.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    // The close button comes first in the DOM and would take the initial focus; a dialog with a
    // form starts on its first field, as the spec-003 sheet did.
    dialog.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")?.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      latestOnClose.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (opener && typeof opener.focus === "function" && opener.isConnected) opener.focus();
    };
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    defaultAction?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "Tab") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="ui-dialog anim-sheet-in"
      onKeyDown={onKeyDown}
    >
      <IconButton icon="xmark" label="Close" className="ui-dialog__close" onClick={onClose} />
      <form className="ui-dialog__form" onSubmit={onSubmit}>
        <h2 id={titleId} className="ui-dialog__title">
          {title}
        </h2>
        {children}
        {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
      </form>
    </dialog>
  );
}
