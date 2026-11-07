import { forwardRef, type InputHTMLAttributes, useId } from "react";
import "./toggles.css";

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked"> {
  label: string;
  caption?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, caption, checked, onChange, disabled, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const labelId = `${inputId}-label`;
  const captionId = caption ? `${inputId}-caption` : undefined;
  return (
    <label className="ui-toggle" htmlFor={inputId}>
      <input
        {...rest}
        ref={ref}
        id={inputId}
        type="radio"
        className={["ui-toggle__input", "ui-radio__input", className].filter(Boolean).join(" ")}
        checked={checked}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={captionId ?? rest["aria-describedby"]}
        onChange={(e) => {
          if (!disabled) onChange(e.target.checked);
        }}
      />
      <span className="ui-toggle__text">
        <span id={labelId} className="ui-toggle__label">
          {label}
        </span>
        {caption && (
          <span id={captionId} className="ui-toggle__caption">
            {caption}
          </span>
        )}
      </span>
    </label>
  );
});
