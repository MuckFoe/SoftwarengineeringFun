import { forwardRef, useImperativeHandle, useRef } from "react";
import { Icon } from "./Icon";
import styles from "./SearchField.module.css";

interface Props {
  label: string;
  value: string;
  /** Called on every keystroke (FR-11). */
  onChange(value: string): void;
  placeholder?: string;
}

/** A search field with a leading magnifier and a Clear button once it holds text. */
export const SearchField = forwardRef<HTMLInputElement, Props>(function SearchField(
  { label, value, onChange, placeholder = "Search" },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);
  return (
    <div className={styles.search}>
      <span className={styles.icon}>
        <Icon name="search" size={14} />
      </span>
      <input
        ref={input}
        type="search"
        className={styles.input}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <Icon name="xmark" size={10} />
        </button>
      )}
    </div>
  );
});
