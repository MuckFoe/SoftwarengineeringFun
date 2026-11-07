import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

/** primary / secondary / tertiary are the Audi kinds; bordered, plain and destructive are the
 * spec-003 names kept so existing call sites compile (bordered = secondary, plain = tertiary). */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "bordered"
  | "plain"
  | "destructive";
export type ButtonSize = "xs" | "sm" | "md";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Accessible name for an icon-only button. */
  label?: string;
  /** Work in progress: the Spinner replaces the icon slot and the button stays focusable. */
  loading?: boolean;
  /** Alias of `loading` (spec 003 name). */
  busy?: boolean;
  busyLabel?: string;
  children?: ReactNode;
}

const KIND: Record<ButtonVariant, string> = {
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  bordered: "secondary",
  plain: "tertiary",
  destructive: "secondary",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "bordered",
    size = "sm",
    icon,
    label,
    loading = false,
    busy = false,
    busyLabel = "In progress",
    type = "button",
    className,
    children,
    ...rest
  },
  ref,
) {
  const isBusy = loading || busy;
  const kind = KIND[variant];
  const classes = [
    styles.button,
    styles[kind],
    styles[variant],
    variant === "destructive" && styles.destructive,
    styles[size],
    children != null && children !== false && styles.labelled,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      aria-label={label}
      aria-busy={isBusy || undefined}
    >
      {isBusy ? (
        <Spinner label={busyLabel} size={size === "xs" ? 16 : 24} />
      ) : (
        icon && <Icon name={icon} />
      )}
      {children}
    </button>
  );
});
