import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

type Variant = "primary" | "bordered" | "plain" | "destructive";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: Variant;
  icon?: IconName;
  /** Accessible name for an icon-only button. */
  label?: string;
  /** Work in progress: shows an inline spinner at once (FR-3) and keeps the button focusable. */
  busy?: boolean;
  busyLabel?: string;
  children?: ReactNode;
}

export function Button({
  variant = "bordered",
  icon,
  label,
  busy = false,
  busyLabel = "In progress",
  type = "button",
  className,
  children,
  ...rest
}: Props) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      aria-label={label}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner label={busyLabel} size={12} /> : icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
