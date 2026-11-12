import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./appHeader.css";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: IconName;
  /** Accessible name; required when there is no visible text. */
  label?: string;
  children?: ReactNode;
}

/**
 * A button in the header line, in the header's one control style (the quiet outlined pill the
 * jump bar, appearance toggle and account entry use). Without text it is a round icon button.
 */
export function HeaderButton({
  icon,
  label,
  children,
  className,
  type = "button",
  ...rest
}: Props) {
  const text = children != null && children !== false;
  const classes = ["app-header-pill", !text && "app-header-pill-icon", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} type={type} className={classes} aria-label={label}>
      {icon && <Icon name={icon} />}
      {text && <span className="app-header-pill-text">{children}</span>}
    </button>
  );
}
