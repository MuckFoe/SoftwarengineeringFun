import { useState } from "react";
import { useLocation } from "react-router";
import { loginUrl, logout } from "../api/client";
import { useMe } from "../auth/useMe";
import { Button } from "../ui/Button";
import { Popover } from "../ui/Popover";
import styles from "./AccountControl.module.css";

interface Props {
  /** After signing out; reloads the page by default so every screen sees it. */
  onSignedOut?: () => void;
}

/** The appearance the page shows now, set on <html> by the pre-paint script. */
function currentAppearance(): "light" | "dark" {
  return document.documentElement.getAttribute("data-appearance") === "dark" ? "dark" : "light";
}

/**
 * The toolbar's account entry (FR-9): "Sign in" for visitors, which returns them to this
 * screen and styles the sign-in page in the app's appearance (FR-18); the user's name with
 * a Sign out popover once signed in.
 */
export function AccountControl({ onSignedOut = () => window.location.reload() }: Props) {
  const me = useMe();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  if (me.status === "loading") return null;

  if (me.status === "error" || !me.me.signed_in) {
    // The router's location is already relative to the base path, so `next` never carries it.
    const next = `${location.pathname}${location.search}`;
    const appearance = new URLSearchParams({ appearance: currentAppearance() });
    return (
      <a className={styles.signIn} href={`${loginUrl(next)}&${appearance}`}>
        Sign in
      </a>
    );
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
      onSignedOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Popover label="Account" icon="person" text={me.me.name ?? "Account"}>
      <div className={styles.menu}>
        <p className={styles.name}>{me.me.name}</p>
        <Button variant="bordered" busy={signingOut} onClick={signOut}>
          Sign out
        </Button>
      </div>
    </Popover>
  );
}
