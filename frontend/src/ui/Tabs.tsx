import { type KeyboardEvent, useRef } from "react";
import { Icon, type IconName } from "./Icon";
import "./tabs.css";

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
}

interface Props {
  tabs: readonly TabItem[];
  value: string;
  onChange(id: string): void;
  /** Accessible name of the tab list. */
  label?: string;
}

/** Audi navigation tabs: a tablist with roving tabindex; arrows move selection and focus. */
export function Tabs({ tabs, value, onChange, label }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next: number;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="ui-tabs">
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ui-tab"
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.icon && <Icon name={tab.icon} />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
