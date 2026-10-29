import { type KeyboardEvent, useRef } from "react";
import styles from "./SegmentedControl.module.css";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  onChange(value: T): void;
  options: readonly Option<T>[];
}

/** A radiogroup with one tab stop; arrow keys move selection and focus (FR-21). */
export function SegmentedControl<T extends string>({ label, value, onChange, options }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={styles.group}>
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: the WAI-ARIA radio-group pattern on buttons (roving tabindex, explicit arrow handling) styles as a segment; native radios can't.
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.segment}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
