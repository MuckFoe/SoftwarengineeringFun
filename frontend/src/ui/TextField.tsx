import { useId } from "react";
import { Icon } from "./Icon";
import { TextArea } from "./TextArea";
import "./field.css";

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
  readOnly?: boolean;
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
  readOnly,
  required,
  monospace = false,
  id,
}: Props) {
  const ownId = useId();
  if (multiline) {
    return (
      <TextArea
        label={label}
        value={value}
        onChange={onChange}
        error={error}
        describedBy={describedBy}
        invalid={invalid}
        rows={rows}
        maxLength={maxLength}
        counter={counter}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        monospace={monospace}
        id={id}
      />
    );
  }
  const inputId = id ?? `${ownId}-input`;
  const errorId = `${ownId}-error`;
  const describedByIds = [error ? errorId : "", describedBy ?? ""].filter(Boolean).join(" ");
  const bad = Boolean(error) || invalid;
  return (
    <div className={bad ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        className={monospace ? "field__control field__mono" : "field__control"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        maxLength={maxLength}
        aria-invalid={bad ? true : undefined}
        aria-describedby={describedByIds || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {(error || (counter && maxLength !== undefined)) && (
        <div className="field__footer">
          {error && (
            <span className="field__error">
              <Icon name="exclamation" size={16} />
              <span id={errorId}>{error}</span>
            </span>
          )}
          {counter && maxLength !== undefined && (
            <span className="field__counter">
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
