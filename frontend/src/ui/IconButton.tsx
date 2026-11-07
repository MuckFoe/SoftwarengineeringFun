import type { ButtonHTMLAttributes } from "react";
import styles from "./chips.module.css";
import { Icon, type IconName } from "./Icon";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  icon: IconName;
  /** Accessible name; required because the button has no visible text. */
  label: string;
  /** When defined the button is a toggle and exposes `aria-pressed`. */
  toggled?: boolean;
}

export function IconButton({ icon, label, toggled, type = "button", className, ...rest }: Props) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={toggled}
      className={[styles.iconButton, className].filter(Boolean).join(" ")}
    >
      <Icon name={icon} />
    </button>
  );
}
