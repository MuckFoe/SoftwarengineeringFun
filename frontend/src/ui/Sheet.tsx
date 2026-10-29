import { type FormEvent, type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./Sheet.module.css";

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  /** Return in the sheet submits its form; this runs then (FR-17 default button). */
  defaultAction?: () => void;
}

/**
 * A modal sheet on a native <dialog> (FR-2): `showModal()` gives the focus trap, the
 * backdrop and Esc (as `cancel`, handed to `onClose`). It never navigates, so whatever
 * opened it stays mounted underneath.
 */
export function Sheet({ open, onClose, title, children, defaultAction }: Props) {
  if (!open) return null;
  return (
    <OpenSheet onClose={onClose} title={title} defaultAction={defaultAction}>
      {children}
    </OpenSheet>
  );
}

function OpenSheet({ onClose, title, children, defaultAction }: Omit<Props, "open">) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const latestOnClose = useRef(onClose);
  latestOnClose.current = onClose;

  // Opened once per mount: showModal() on an already-open dialog throws.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Every supported browser has showModal(); the attribute is for environments that don't.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const onCancel = (e: Event) => {
      e.preventDefault();
      latestOnClose.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    defaultAction?.();
  }

  return (
    <dialog ref={ref} aria-labelledby={titleId} className={`${styles.sheet} anim-sheet-in`}>
      <form className={styles.form} onSubmit={onSubmit}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
      </form>
    </dialog>
  );
}
