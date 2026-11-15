import { type KeyboardEvent, useEffect, useRef } from "react";
import { Button } from "../../ui/Button";
import styles from "./DuelPicker.module.css";
import type { Recipient, RpsDuel, Side, Weapon } from "./rpsTypes";

const WEAPONS: { weapon: Weapon; name: string }[] = [
  { weapon: "rock", name: "Rock" },
  { weapon: "paper", name: "Paper" },
  { weapon: "scissors", name: "Scissors" },
];

const SIDE_NAME: Record<Side, string> = { a: "Side A", b: "Side B" };

interface Props {
  duel: RpsDuel;
  you: Recipient;
  onPick: (weapon: Weapon) => void;
}

function lastRoundText(last: { a: Weapon; b: Weapon }, you: Recipient): string {
  if (you !== "viewer" && last.a === last.b) return `Tie: you both picked ${last.a}. Pick again.`;
  return `Last round: Side A picked ${last.a}, Side B picked ${last.b}.`;
}

/**
 * The duel's secret pick (spec 021 FR-13): players choose rock, paper or scissors and wait for
 * the other; viewers see only who has picked and the last tied round (FR-21). Focus moves to the
 * first weapon when a duel or a new round starts (NFR-5).
 */
export function DuelPicker({ duel, you, onPick }: Props) {
  const group = useRef<HTMLDivElement>(null);
  const isPlayer = you !== "viewer";
  const canPick = isPlayer && duel.your_pick === null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus on each new round
  useEffect(() => {
    if (canPick) group.current?.querySelector("button")?.focus();
  }, [canPick, duel.round]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const buttons = Array.from(group.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }

  const opponent: Side | null = you === "a" ? "b" : you === "b" ? "a" : null;

  return (
    <section className={styles.picker} aria-label="Duel">
      <p className={styles.title}>Duel, round {duel.round}</p>
      {duel.last_round && <p className={styles.note}>{lastRoundText(duel.last_round, you)}</p>}
      {isPlayer ? (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a fieldset */}
          <div
            ref={group}
            role="group"
            aria-label="Pick a weapon"
            onKeyDown={onKeyDown}
            className={styles.choices}
          >
            {WEAPONS.map(({ weapon, name }) => (
              <Button key={weapon} disabled={!canPick} onClick={() => onPick(weapon)}>
                {name}
              </Button>
            ))}
          </div>
          {duel.your_pick && (
            <p className={styles.note}>
              You picked {duel.your_pick}.{" "}
              {opponent && duel.picked[opponent]
                ? "Revealing the picks."
                : "Waiting for your opponent to pick."}
            </p>
          )}
        </>
      ) : (
        <ul className={styles.status}>
          {(["a", "b"] as const).map((side) => (
            <li key={side}>
              {duel.picked[side]
                ? `${SIDE_NAME[side]} has picked`
                : `${SIDE_NAME[side]} is picking`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
