import { useEffect, useState } from "react";
import { IconButton } from "./IconButton";
import styles from "./InviteLink.module.css";
import { Toast } from "./Toast";

interface Props {
  link: string;
}

/**
 * An invite link with its copy button, always visible next to it (spec 015 FR-12). Copying
 * confirms with a Toast; if the clipboard is refused the toast says so (the link stays
 * selectable in the field).
 */
export function InviteLink({ link }: Props) {
  const [toast, setToast] = useState<{ key: number; ok: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function copy() {
    let ok = true;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      ok = false;
    }
    setToast({ key: Date.now(), ok });
  }

  return (
    <div className={styles.invite}>
      <label className={styles.field}>
        <span className={styles.label}>Invite link</span>
        <input className={styles.input} readOnly value={link} aria-label="Invite link" />
      </label>
      <IconButton icon="link" label="Copy invite link" onClick={() => void copy()} />
      {toast && (
        <div className={styles.toast}>
          <Toast key={toast.key} tone={toast.ok ? "success" : "negative"}>
            {toast.ok ? "Invite link copied" : "Could not copy; select the link and copy it"}
          </Toast>
        </div>
      )}
    </div>
  );
}
