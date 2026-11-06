import { type KeyboardEvent, useEffect, useRef } from "react";
import { Button } from "../../ui/Button";
import type { PromotionPiece } from "./chessTypes";

const CHOICES: { letter: PromotionPiece; name: string }[] = [
  { letter: "q", name: "Queen" },
  { letter: "r", name: "Rook" },
  { letter: "b", name: "Bishop" },
  { letter: "n", name: "Knight" },
];

interface Props {
  onChoose: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

/** Asks which piece a pawn becomes (spec 014 FR-17); keyboard reachable, Escape cancels. */
export function PromotionPicker({ onChoose, onCancel }: Props) {
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    group.current?.querySelector("button")?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const buttons = Array.from(group.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a fieldset
    <div
      ref={group}
      role="group"
      aria-label="Promote pawn to"
      onKeyDown={onKeyDown}
      style={{ display: "flex", gap: 8 }}
    >
      {CHOICES.map(({ letter, name }) => (
        <Button key={letter} onClick={() => onChoose(letter)}>
          {name}
        </Button>
      ))}
    </div>
  );
}
