import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { loginUrl, logout, registerUrl } from "../api/client";
import type { Me } from "../api/types";
import { useMe } from "../auth/useMe";
import { useChatVisible } from "../components/chatVisibility";
import type { Choice } from "../theme/appearance";
import type { TextSize } from "../theme/textSize";
import { useAppearance } from "../theme/useAppearance";
import { useTextSize } from "../theme/useTextSize";
import { AppHeader } from "../ui/AppHeader";
import { AreaTitle } from "../ui/AreaTitle";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Icon } from "../ui/Icon";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Window } from "../ui/Window";
import { ProfileSessions } from "./ProfileSessions";
import styles from "./ProfileWindow.module.css";

interface Props {
  /** After signing out; reloads the page by default so every screen sees it. */
  onSignedOut?: () => void;
}

/** Where Back goes: the in-app path the profile was opened from, else the library. */
function backTarget(from: string | null): string {
  return from?.startsWith("/") && !from.startsWith("//") ? from : "/";
}

/** The appearance the page shows now, set on <html> by the pre-paint script. */
function currentAppearance(): "light" | "dark" {
  return document.documentElement.getAttribute("data-appearance") === "dark" ? "dark" : "light";
}

/**
 * The profile (spec 012, plan "Frontend"), reachable from every screen (FR-9). Visitors get
 * only Sign in and Register (FR-10); a signed-in user sees their username and roles,
 * read-only, and Sign out (FR-11), their preferences (FR-18), then their sessions.
 */
export function ProfileWindow({ onSignedOut = () => window.location.reload() }: Props) {
  const me = useMe();
  const location = useLocation();
  const [params] = useSearchParams();
  // Signing in or registering comes back to this profile, `from` and all.
  const next = `${location.pathname}${location.search}`;

  let content = null;
  if (me.status === "ready" && me.me.signed_in) {
    content = (
      <>
        <AccountSection me={me.me} onSignedOut={onSignedOut} />
        <PreferencesSection />
        <ProfileSessions />
      </>
    );
  } else if (me.status !== "loading") {
    content = (
      <section
        className={`${styles.card} ${styles.signedOut}`}
        aria-labelledby="profile-signed-out"
      >
        <span className={styles.avatar} aria-hidden="true">
          <Icon name="person" size={28} />
        </span>
        <h2 id="profile-signed-out" className={styles.headline}>
          You're not signed in
        </h2>
        <p className={styles.text}>Sign in or register to keep your sessions and preferences.</p>
        <div className={styles.actions}>
          <a
            className={styles.action}
            href={`${loginUrl(next)}&${new URLSearchParams({ appearance: currentAppearance() })}`}
          >
            Sign in
          </a>
          <a className={styles.action} href={registerUrl(next)}>
            Register
          </a>
        </div>
      </section>
    );
  }

  return (
    <Window
      toolbar={
        <AppHeader label="Profile">
          <Link className={styles.back} to={backTarget(params.get("from"))}>
            <Icon name="chevronLeft" />
            Back
          </Link>
          <AreaTitle title="Profile" />
          <span className={styles.spacer} />
        </AppHeader>
      }
    >
      <div className={styles.content}>{content}</div>
    </Window>
  );
}

type SignedIn = Extract<Me, { signed_in: true }>;

/** Username and roles in this app, as text only, and Sign out (FR-11). */
function AccountSection({ me, onSignedOut }: { me: SignedIn; onSignedOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);

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
    <section className={`${styles.card} ${styles.account}`} aria-labelledby="profile-account">
      <span className={styles.avatar} aria-hidden="true">
        {me.name.slice(0, 1).toUpperCase()}
      </span>
      <div className={styles.identity}>
        <h2 id="profile-account" className={styles.eyebrow}>
          Account
        </h2>
        <dl className={styles.fields}>
          <dt className={styles.visuallyHidden}>Username</dt>
          <dd className={styles.name}>{me.name}</dd>
          <dt className={styles.visuallyHidden}>Roles</dt>
          <dd className={styles.roles}>
            {me.roles.length > 0
              ? me.roles.map((role) => (
                  <span key={role} className={styles.role}>
                    {role}
                  </span>
                ))
              : "none"}
          </dd>
        </dl>
      </div>
      <Button
        className={styles.signOut}
        variant="bordered"
        size="xs"
        busy={signingOut}
        onClick={signOut}
      >
        Sign out
      </Button>
    </section>
  );
}

const APPEARANCE_OPTIONS: { value: Choice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

/**
 * Appearance, text size and chat visibility (FR-18), through the one preference store like the
 * toolbar's controls: applied at once here and everywhere, and saved to the account.
 */
function PreferencesSection() {
  const { choice, setChoice } = useAppearance();
  const [chatVisible, setChatVisible] = useChatVisible();
  const [textSize, setTextSize] = useTextSize();

  return (
    <section className={styles.card} aria-labelledby="profile-preferences">
      <h2 id="profile-preferences" className={styles.cardTitle}>
        Preferences
      </h2>
      <div className={styles.prefs}>
        <div className={styles.prefRow}>
          <div className={styles.prefText} aria-hidden="true">
            <span className={styles.prefLabel}>Appearance</span>
            <span className={styles.prefHint}>Light, dark, or follow your system</span>
          </div>
          <SegmentedControl
            label="Appearance"
            value={choice}
            onChange={setChoice}
            options={APPEARANCE_OPTIONS}
          />
        </div>
        <div className={styles.prefRow}>
          <div className={styles.prefText} aria-hidden="true">
            <span className={styles.prefLabel}>Text size</span>
            <span className={styles.prefHint}>Every text grows or shrinks together</span>
          </div>
          <SegmentedControl
            label="Text size"
            value={textSize}
            onChange={setTextSize}
            options={TEXT_SIZE_OPTIONS}
          />
        </div>
        <div className={styles.prefRow}>
          <Checkbox
            label="Show chat beside the description"
            checked={chatVisible}
            onChange={setChatVisible}
          />
        </div>
      </div>
    </section>
  );
}
