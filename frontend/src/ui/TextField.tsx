import { useId } from "react";
import styles from "./TextField.module.css";

interface Props {
  label: string;
  value: string;
  onChange(value: string): void;
  /** Shown under the field and tied to it with aria-describedby (FR-3, AC-4). */
  error?: string;
  /** Extra ids the field is described by, such as an InlineMessage beside it. */
  describedBy?: string;
  /** Marks the field invalid when its message is shown elsewhere (an InlineMessage). */
  invalid?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  /** Shows "n/maxLength" under the field. */
  counter?: boolean;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  monospace?: boolean;
  id?: string;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  describedBy,
  invalid = false,
  multiline = false,
  rows = 4,
  maxLength,
  counter = false,
  placeholder,
  disabled,
  required,
  monospace = false,
  id,
}: Props) {
  const ownId = useId();
  const inputId = id ?? `${ownId}-input`;
  const errorId = `${ownId}-error`;
  const describedByIds = [error ? errorId : "", describedBy ?? ""].filter(Boolean).join(" ");
  const common = {
    id: inputId,
    value,
    placeholder,
    disabled,
    required,
    maxLength,
    className: [styles.input, monospace ? styles.mono : ""].filter(Boolean).join(" "),
    "aria-invalid": error || invalid ? true : undefined,
    "aria-describedby": describedByIds || undefined,
  };
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
      )}
      {(error || (counter && maxLength !== undefined)) && (
        <div className={styles.footer}>
          {error && (
            <span id={errorId} className={styles.error}>
              {error}
            </span>
          )}
          {counter && maxLength !== undefined && (
            <span className={styles.counter}>
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
