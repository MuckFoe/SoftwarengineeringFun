import { type FormEvent, useId, useState } from "react";
import { DescriptionView } from "../description/DescriptionView";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { TextField } from "../ui/TextField";
import type { Answer, Attempt, LearnClientMessage, StepView as StepViewData } from "./learnTypes";
import styles from "./StepView.module.css";
import { Terminal } from "./Terminal";

/** Server-side guard on submitted text (plan, `too_long`). */
const MAX_TEXT = 1000;

interface Props {
  step: StepViewData;
  /** A looked-back (passed) step or a finished session: everything shows, nothing submits (FR-15). */
  readOnly?: boolean;
  /** Learner actions as socket messages, already addressed to this step. */
  onSend(message: LearnClientMessage): void;
}

/**
 * One lesson step (spec 006 FR-12–FR-18): its content, its check (Continue, quiz or
 * terminal), the group's attempts with their results, the hint and *Show answer*. Only
 * `body_html` and `hint_html` are HTML, from the server's renderer; everything a
 * participant submitted is rendered as text (NFR-4).
 */
export function StepView({ step, readOnly = false, onSend }: Props) {
  const position = step.position;
  const check = step.check;
  const options = check?.type === "choice" ? check.options : [];
  return (
    <article className={styles.step} aria-labelledby={`step-${position}-title`}>
      <h2 id={`step-${position}-title`} className={styles.title}>
        {step.title}
      </h2>
      <DescriptionView html={step.body_html} />

      {check === null && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={readOnly}
            onClick={() => onSend({ type: "continue", step: position })}
          >
            Continue
          </Button>
        </div>
      )}
      {check?.type === "choice" && (
        <ChoiceCheck
          // A fresh selection for each step.
          key={position}
          options={check.options}
          multiple={check.multiple}
          disabled={readOnly}
          onSubmit={(selected) => onSend({ type: "submit_choice", step: position, selected })}
        />
      )}
      {check?.type === "text" && (
        <TextCheck
          key={position}
          disabled={readOnly}
          onSubmit={(text) => onSend({ type: "submit_text", step: position, text })}
        />
      )}
      {check?.type === "terminal" && (
        <Terminal
          key={position}
          prompt={check.prompt}
          history={step.attempts.filter((a) => a.kind === "command")}
          disabled={readOnly}
          onSubmit={(command) => onSend({ type: "submit_command", step: position, command })}
        />
      )}

      {(step.has_hint || step.show_answer_available) && (
        <div className={styles.actions}>
          {step.has_hint && step.hint_html === null && (
            <Button
              disabled={readOnly}
              onClick={() => onSend({ type: "reveal_hint", step: position })}
            >
              Hint
            </Button>
          )}
          {step.show_answer_available && (
            <Button
              disabled={readOnly}
              onClick={() => onSend({ type: "show_answer", step: position })}
            >
              Show answer
            </Button>
          )}
        </div>
      )}

      {step.hint_html !== null && (
        <section className={styles.box} aria-label="Hint">
          <h3 className={styles.boxTitle}>Hint</h3>
          <DescriptionView html={step.hint_html} />
        </section>
      )}

      {step.answer && <AnswerView answer={step.answer} options={options} />}

      {step.attempts.length > 0 && <Attempts attempts={step.attempts} options={options} />}

      {step.passed && (
        <p className={styles.passed}>
          <Icon name="checkmark" />
          {`Passed by ${step.passed.by}`}
          {step.passed.after_reveal && <span className={styles.revealed}>after answer shown</span>}
        </p>
      )}
    </article>
  );
}

function ChoiceCheck({
  options,
  multiple,
  disabled,
  onSubmit,
}: {
  options: string[];
  multiple: boolean;
  disabled: boolean;
  onSubmit(selected: number[]): void;
}) {
  const name = useId();
  const [selected, setSelected] = useState<number[]>([]);

  function toggle(index: number, checked: boolean) {
    if (!multiple) setSelected([index]);
    else if (checked) setSelected([...selected, index].sort((a, b) => a - b));
    else setSelected(selected.filter((i) => i !== index));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || selected.length === 0) return;
    onSubmit(selected);
  }

  return (
    <form className={styles.check} onSubmit={submit}>
      <fieldset className={styles.options} disabled={disabled}>
        <legend className={styles.legend}>
          {multiple ? "Choose all that apply" : "Choose one"}
        </legend>
        {options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: options are a fixed list, addressed by index on the wire.
          <label key={index} className={styles.option}>
            <input
              type={multiple ? "checkbox" : "radio"}
              name={name}
              checked={selected.includes(index)}
              disabled={disabled}
              onChange={(e) => toggle(index, e.target.checked)}
            />
            {option}
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={disabled || selected.length === 0}>
          Submit
        </Button>
      </div>
    </form>
  );
}

function TextCheck({ disabled, onSubmit }: { disabled: boolean; onSubmit(text: string): void }) {
  const [text, setText] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || text.trim() === "") return;
    onSubmit(text);
    setText("");
  }

  return (
    <form className={styles.check} onSubmit={submit}>
      <TextField
        label="Answer"
        value={text}
        onChange={setText}
        maxLength={MAX_TEXT}
        disabled={disabled}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={disabled || text.trim() === ""}>
          Submit
        </Button>
      </div>
    </form>
  );
}

function AnswerView({ answer, options }: { answer: Answer; options: string[] }) {
  return (
    <section className={styles.box} aria-label="Answer">
      <h3 className={styles.boxTitle}>Answer</h3>
      {answer.type === "choice" && (
        <ul className={styles.answerList}>
          {answer.correct.map((i) => (
            <li key={i}>{options[i] ?? `Option ${i + 1}`}</li>
          ))}
        </ul>
      )}
      {/* The first accepted answer is the one Show answer reveals (plan, FR-14a). */}
      {answer.type === "text" && <p className={styles.answerText}>{answer.accept[0] ?? ""}</p>}
      {answer.type === "terminal" && (
        <pre className={styles.code}>
          {`$ ${answer.command}`}
          {answer.output ? `\n${answer.output}` : ""}
        </pre>
      )}
    </section>
  );
}

function submission(attempt: Attempt, options: string[]): string {
  if (Array.isArray(attempt.submitted)) {
    return attempt.submitted.map((i) => options[i] ?? `Option ${i + 1}`).join(", ");
  }
  return attempt.submitted;
}

function Attempts({ attempts, options }: { attempts: Attempt[]; options: string[] }) {
  return (
    <section className={styles.attempts}>
      <h3 className={styles.boxTitle}>Attempts</h3>
      <ul className={styles.attemptList} aria-label="Attempts">
        {attempts.map((a) => (
          <li key={a.id} className={styles.attempt} data-correct={a.correct}>
            <Icon name={a.correct ? "checkmark" : "xmark"} />
            <span className={styles.by}>{a.by}</span>
            <span className={styles.submitted}>{submission(a, options)}</span>
            <span className={styles.result}>{a.correct ? "correct" : "not correct"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
