import type { HTMLAttributes } from "react";
import "./card.css";

export function Divider({ className, ...rest }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...rest} className={["divider", className].filter(Boolean).join(" ")} />;
}
