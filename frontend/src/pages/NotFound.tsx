import type { ReactNode } from "react";
import { Link } from "react-router";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { EmptyState } from "../ui/EmptyState";
import type { IconName } from "../ui/Icon";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import styles from "./NotFound.module.css";

interface WindowProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
}

/** A window with only appearance and account in its toolbar and an empty state (FR-13). */
export function EmptyStateWindow({ icon, title, children }: WindowProps) {
  return (
    <Window
      toolbar={
        <Toolbar label="Window">
          <span className={styles.spacer} />
          <AppearanceControl />
          <AccountControl />
        </Toolbar>
      }
    >
      <EmptyState
        icon={icon}
        title={title}
        action={
          <Link className={styles.link} to="/">
            Back to problems
          </Link>
        }
      >
        {children}
      </EmptyState>
    </Window>
  );
}

interface Props {
  message?: string;
}

/** Shown wherever nothing matches: an unknown URL (AC-14) or an unknown session (FR-14). */
export function NotFound({ message = "Page not found" }: Props) {
  return (
    <EmptyStateWindow icon="exclamation" title={message}>
      There is nothing at this address.
    </EmptyStateWindow>
  );
}
