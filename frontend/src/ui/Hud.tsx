import { useEffect, useRef, useState } from "react";
import styles from "./Hud.module.css";

interface Props {
  message: string;
  /** How long it stays, in ms. */
  timeout?: number;
  onDone?: () => void;
}

/**
 * A transient, non-blocking confirmation ("Invite link copied", FR-3). It is a polite
 * status, holds nothing focusable and never moves focus. Render a new one (new `key`) to
 * show it again.
 */
export function Hud({ message, timeout = 1500, onDone }: Props) {
  const [visible, setVisible] = useState(true);
  const latestOnDone = useRef(onDone);
  latestOnDone.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      latestOnDone.current?.();
    }, timeout);
    return () => clearTimeout(timer);
  }, [timeout]);

  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" className={`${styles.hud} anim-popover-in`}>
      {message}
    </div>
  );
}
