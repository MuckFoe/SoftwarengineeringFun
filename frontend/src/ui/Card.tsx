import type { AnchorHTMLAttributes, HTMLAttributes } from "react";
import "./card.css";

type DivProps = HTMLAttributes<HTMLDivElement> & { href?: undefined };
type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** Kit card. Passing `href` makes the whole card the single link (the only case with a hover effect). */
export function Card(props: DivProps | LinkProps) {
  if (props.href !== undefined) {
    const { className, ...rest } = props as LinkProps;
    return <a {...rest} className={["card", "card-link", className].filter(Boolean).join(" ")} />;
  }
  const { className, ...rest } = props as DivProps;
  return <div {...rest} className={["card", className].filter(Boolean).join(" ")} />;
}
