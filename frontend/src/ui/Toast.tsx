import type { ReactNode } from "react";
import "./overlay.css";

type Tone = "info" | "success" | "notice" | "negative";

interface Props {
  tone: Tone;
  children: ReactNode;
  /** Shows a close button when given. */
  onClose?: () => void;
}

/**
 * Audi notification toast (spec 015 FR-4). A polite `status`; negative uses `alert` so
 * assistive tech announces it at once. Text is black on the signal fills (recorded deviation).
 */
export function Toast({ tone, children, onClose }: Props) {
  return (
    <div
      role={tone === "negative" ? "alert" : "status"}
      data-tone={tone}
      className="toast anim-popover-in"
    >
      <div className="toast-body">{children}</div>
      {onClose && (
        <button type="button" className="toast-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
