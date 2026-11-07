import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import styles from "./InviteLink.module.css";

interface Props {
  link: string;
  /** One header-sized row: no visible label, small field and button. */
  compact?: boolean;
}

/** Copy via a hidden textarea and `document.execCommand("copy")` (no async clipboard API). */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.className = styles.hidden ?? "";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * An invite link with its primary "Copy link" pill, always visible next to it (spec 016 FR-14).
 * Copying confirms with a polite "Copied" status for about 2 s; if neither the clipboard API nor
 * the execCommand fallback works the status says so (the link stays selectable in the field).
 */
export function InviteLink({ link, compact = false }: Props) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let ok: boolean;
    try {
      if (!navigator.clipboard) throw new Error("no clipboard api");
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      ok = legacyCopy(link);
    }
    setState(ok ? "ok" : "fail");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 2000 : 4000);
  }

  return (
    <div className={compact ? `${styles.invite} ${styles.compact}` : styles.invite}>
      <label className={styles.field}>
        <span className={styles.label}>Invite link</span>
        <input className={styles.input} readOnly value={link} aria-label="Invite link" />
      </label>
      <Button variant="primary" size={compact ? "sm" : "md"} onClick={() => void copy()}>
        Copy link
      </Button>
      <div className={styles.status} role="status" aria-live="polite">
        {state === "ok" ? "Copied" : ""}
      </div>
      {state === "fail" && (
        <div className={styles.status} role="alert">
          Could not copy; select the link and copy it
        </div>
      )}
    </div>
  );
}
