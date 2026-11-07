/**
 * The raw rejoin token a guest or chess invitee already holds for the websocket (spec 017 FR-11).
 * Chess keeps it as `chess:<invite>`; presentations keep `{name, rejoin_token}` as
 * `present:<invite>`. Coding and learning guests keep none, so they get null.
 */
export function findRejoinToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const raw = key ? localStorage.getItem(key) : null;
      if (!key || raw === null) continue;
      if (key.startsWith("chess:") && raw) return raw;
      if (key.startsWith("present:")) {
        const token = (JSON.parse(raw) as { rejoin_token?: unknown } | null)?.rejoin_token;
        if (typeof token === "string" && token) return token;
      }
    }
  } catch {
    // Storage blocked or unreadable: no token.
  }
  return null;
}
