import type { HTMLAttributes } from "react";
import "./chat.css";

/** Audi-styled list row (spec 015 FR-4): 1 px divider, neutral hover, square. */
export function ListItem({ className, ...rest }: HTMLAttributes<HTMLLIElement>) {
  return <li {...rest} className={className ? `list-item ${className}` : "list-item"} />;
}
