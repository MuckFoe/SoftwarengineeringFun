import { Link, useLocation } from "react-router";
import { useMe } from "../auth/useMe";
import { Icon } from "../ui/Icon";
import styles from "./AccountControl.module.css";

/**
 * The toolbar's profile entry on every screen (spec 012 FR-9): *Profile* for visitors (and
 * while /api/me loads), the username once signed in. It opens `/profile`, which returns here
 * through `from`; signing in, registering and signing out live on the profile.
 */
export function AccountControl() {
  const me = useMe();
  const location = useLocation();
  // The router's location is already relative to the base path, so `from` never carries it.
  const from = new URLSearchParams({ from: `${location.pathname}${location.search}` });
  const text = me.status === "ready" && me.me.signed_in ? me.me.name : "Profile";

  return (
    <Link className={styles.entry} to={`/profile?${from}`}>
      <Icon name="person" />
      {text}
    </Link>
  );
}
