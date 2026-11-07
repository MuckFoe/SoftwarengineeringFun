import { type KeyboardEvent, useId } from "react";
import { Icon } from "./Icon";
import "./field.css";

export interface TextAreaProps {
  label: string;
  value: string;
  onChange(value: string): void;
  /** Shown under the field and tied to it with aria-describedby. */
  error?: string;
  /** Extra ids the field is described by, such as an InlineMessage beside it. */
  describedBy?: string;
  /** Marks the field invalid when its message is shown elsewhere. */
  invalid?: boolean;
  rows?: number;
  maxLength?: number;
  /** Shows "n/maxLength" under the field; on whenever maxLength is set unless false. */
  counter?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  monospace?: boolean;
  id?: string;
  onKeyDown?(e: KeyboardEvent<HTMLTextAreaElement>): void;
}

/** Audi boxed text area: 1 px box, 12 px padding, optional character counter. */
export function TextArea({
  label,
  value,
  onChange,
  error,
  describedBy,
  invalid = false,
  rows = 4,
  maxLength,
  counter,
  placeholder,
  disabled,
  readOnly,
  required,
  monospace = false,
  id,
  onKeyDown,
}: TextAreaProps) {
  const ownId = useId();
  const inputId = id ?? `${ownId}-input`;
  const errorId = `${ownId}-error`;
  const describedByIds = [error ? errorId : "", describedBy ?? ""].filter(Boolean).join(" ");
  const showCounter = (counter ?? true) && maxLength !== undefined;
  const bad = Boolean(error) || invalid;
  return (
    <div className={bad ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <textarea
        id={inputId}
        className={monospace ? "field__area field__mono" : "field__area"}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        maxLength={maxLength}
        aria-invalid={bad ? true : undefined}
        aria-describedby={describedByIds || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {(error || showCounter) && (
        <div className="field__footer">
          {error && (
            <span className="field__error">
              <Icon name="exclamation" size={16} />
              <span id={errorId}>{error}</span>
            </span>
          )}
          {showCounter && (
            <span className="field__counter">
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
