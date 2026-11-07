import type { ReactNode } from "react";
import "./chat.css";

interface Props {
  author: string;
  time: string;
  own: boolean;
  children?: ReactNode;
}

/** Audi-styled chat bubble (spec 016 FR-8): rounded with one pointed corner; own is accent. Children render unchanged. */
export function ChatBubble({ author, time, own, children }: Props) {
  return (
    <div className="chat-bubble" data-own={own ? "true" : "false"}>
      <div>
        <span className="chat-bubble__author">{author}</span>{" "}
        <span className="chat-bubble__time">{time}</span>
      </div>
      <div className="chat-bubble__body">{children}</div>
    </div>
  );
}
