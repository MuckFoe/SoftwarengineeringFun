/**
 * Whether this browser has seen GIF search's third-party notice for an invite (FR-5).
 * Pure apart from storage. Any storage failure (private mode, blocked storage) counts
 * as not seen, so the notice is shown again rather than skipped.
 */
const PREFIX = "gif-notice-seen:";

export function noticeSeen(invite: string, storage?: Storage): boolean {
  try {
    return (storage ?? localStorage).getItem(PREFIX + invite) !== null;
  } catch {
    return false;
  }
}

export function markNoticeSeen(invite: string, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(PREFIX + invite, "1");
  } catch {
    // Storage unavailable: the notice will simply show again next time.
  }
}
