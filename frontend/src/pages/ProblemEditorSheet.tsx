import { useEffect, useId, useRef, useState } from "react";
import {
  ApiError,
  createProblem,
  deleteProblem,
  getProblemForEdit,
  updateProblem,
} from "../api/client";
import type { FieldError, ProblemTest } from "../api/types";
import { DescriptionEditor } from "../description/DescriptionEditor";
import { ShortcutScope, useShortcut } from "../shortcuts/useShortcut";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";
import styles from "./ProblemEditorSheet.module.css";

interface TestRow {
  key: string;
  args: string;
  expected: string;
}

function emptyRow(): TestRow {
  return { key: crypto.randomUUID(), args: "", expected: "" };
}

function rowsFromTests(tests: ProblemTest[]): TestRow[] {
  return tests.map((t) => ({
    key: crypto.randomUUID(),
    args: JSON.stringify(t.args),
    expected: JSON.stringify(t.expected),
  }));
}

/** Parses the test rows into `ProblemTest[]`, or the row indices whose JSON didn't parse. */
function parseRows(rows: TestRow[]): { tests: ProblemTest[] } | { badRows: number[] } {
  const tests: ProblemTest[] = [];
  const badRows: number[] = [];
  rows.forEach((row, i) => {
    try {
      tests.push({ args: JSON.parse(row.args), expected: JSON.parse(row.expected) });
    } catch {
      badRows.push(i);
    }
  });
  return badRows.length > 0 ? { badRows } : { tests };
}

function messageFor(errors: FieldError[], field: string): string | undefined {
  return errors.find((e) => e.field === field && e.test_index === undefined)?.message;
}

function messageForRow(errors: FieldError[], index: number): string | undefined {
  return errors.find((e) => e.field === "tests" && e.test_index === index)?.message;
}

interface Props {
  open: boolean;
  /** Edit this problem; without it the sheet creates one. */
  problemId?: string;
  onClose(): void;
  onSaved(): void;
  onDeleted(): void;
}

/**
 * Create, edit and delete a problem (FR-3, FR-4, FR-7, FR-8) in a sheet over the problem
 * list (spec 003 FR-2). Return or ⌘S saves; a rejected save explains itself beside the
 * field and keeps everything typed (FR-3, AC-4). Delete asks first.
 */
export function ProblemEditorSheet({ open, problemId, onClose, onSaved, onDeleted }: Props) {
  // The fields own the form state; the sheet's default action (Return, Save) calls their save.
  const save = useRef<() => void>(() => undefined);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={problemId === undefined ? "New problem" : "Edit problem"}
      defaultAction={() => save.current()}
    >
      <ShortcutScope scope="sheet" />
      <EditorFields
        saveRef={save}
        problemId={problemId}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </Sheet>
  );
}

function EditorFields({
  saveRef,
  problemId,
  onClose,
  onSaved,
  onDeleted,
}: Omit<Props, "open"> & { saveRef: { current: () => void } }) {
  const isEdit = problemId !== undefined;
  const ids = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [signature, setSignature] = useState("");
  const [rows, setRows] = useState<TestRow[]>([emptyRow()]);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [badRows, setBadRows] = useState<number[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (problemId === undefined) return;
    let current = true;
    getProblemForEdit(problemId).then(
      (problem) => {
        if (!current) return;
        setTitle(problem.title);
        setDescription(problem.description);
        setSignature(problem.signature);
        setRows(problem.tests.length > 0 ? rowsFromTests(problem.tests) : [emptyRow()]);
      },
      () => {
        if (current) setGeneralError("Could not load this problem.");
      },
    );
    return () => {
      current = false;
    };
  }, [problemId]);

  saveRef.current = () => void save();
  useShortcut("saveProblem", () => void save());

  function updateRow(index: number, patch: Partial<TestRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setGeneralError(null);
    setFieldErrors([]);
    const parsed = parseRows(rows);
    if ("badRows" in parsed) {
      setBadRows(parsed.badRows);
      return;
    }
    setBadRows([]);
    const input = { title, description, signature, tests: parsed.tests };
    setSaving(true);
    try {
      if (problemId !== undefined) await updateProblem(problemId, input);
      else await createProblem(input);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.error.kind === "validation") {
        setFieldErrors(err.error.errors);
      } else {
        setGeneralError("Could not save this problem.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (problemId === undefined) return;
    setConfirmingDelete(false);
    try {
      await deleteProblem(problemId);
      onDeleted();
    } catch {
      setGeneralError("Could not delete this problem.");
    }
  }

  /** A field with its server message beside it (AC-4). */
  function field(
    label: string,
    value: string,
    onChange: (v: string) => void,
    message: string | undefined,
    extra: { monospace?: boolean } = {},
  ) {
    const messageId = `${ids}-${label.replace(/\s+/g, "-").toLowerCase()}-message`;
    return (
      <div className={styles.field}>
        <TextField
          label={label}
          value={value}
          onChange={onChange}
          invalid={message !== undefined}
          describedBy={message ? messageId : undefined}
          {...extra}
        />
        {message && <InlineMessage id={messageId}>{message}</InlineMessage>}
      </div>
    );
  }

  const testsMessage = messageFor(fieldErrors, "tests");
  const descriptionMessage = messageFor(fieldErrors, "description");
  const descriptionMessageId = `${ids}-description-message`;

  return (
    <>
      {field("Title", title, setTitle, messageFor(fieldErrors, "title"))}
      {/* Spec 002's formatting and image controls, inside the sheet (FR-16). */}
      <div className={styles.field}>
        <DescriptionEditor
          value={description}
          onChange={setDescription}
          invalid={descriptionMessage !== undefined}
          describedBy={descriptionMessage ? descriptionMessageId : undefined}
        />
        {descriptionMessage && (
          <InlineMessage id={descriptionMessageId}>{descriptionMessage}</InlineMessage>
        )}
      </div>
      {field("Signature", signature, setSignature, messageFor(fieldErrors, "signature"), {
        monospace: true,
      })}

      <fieldset className={styles.tests}>
        <legend className={styles.legend}>Tests</legend>
        {testsMessage && <InlineMessage id={`${ids}-tests-message`}>{testsMessage}</InlineMessage>}
        {rows.map((row, i) => {
          const message = badRows.includes(i)
            ? `Test ${i + 1}: args and expected must be valid JSON`
            : messageForRow(fieldErrors, i);
          const messageId = `${ids}-row-${row.key}-message`;
          const describedBy = message ? messageId : undefined;
          return (
            <div key={row.key} className={styles.row}>
              <TextField
                label={`Test ${i + 1} args`}
                value={row.args}
                onChange={(v) => updateRow(i, { args: v })}
                invalid={message !== undefined}
                describedBy={describedBy}
                monospace
              />
              <TextField
                label={`Test ${i + 1} expected`}
                value={row.expected}
                onChange={(v) => updateRow(i, { expected: v })}
                invalid={message !== undefined}
                describedBy={describedBy}
                monospace
              />
              <Button
                variant="plain"
                icon="xmark"
                label={`Remove test ${i + 1}`}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              />
              {message && (
                <div className={styles.rowMessage}>
                  <InlineMessage id={messageId}>{message}</InlineMessage>
                </div>
              )}
            </div>
          );
        })}
        <div>
          <Button
            variant="plain"
            icon="plus"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
          >
            Add test
          </Button>
        </div>
      </fieldset>

      {generalError && <InlineMessage id={`${ids}-general`}>{generalError}</InlineMessage>}

      <div className={styles.actions}>
        {isEdit && (
          <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
            Delete…
          </Button>
        )}
        <span className={styles.spacer} />
        <Button variant="bordered" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" busy={saving}>
          {isEdit ? "Save" : "Create"}
        </Button>
      </div>

      {confirmingDelete && (
        <DeleteAlert title={title} onCancel={() => setConfirmingDelete(false)} onDelete={remove} />
      )}
    </>
  );
}

/** The one alert in the app: a destructive confirmation (FR-3). */
function DeleteAlert({
  title,
  onCancel,
  onDelete,
}: {
  title: string;
  onCancel(): void;
  onDelete(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const latestOnCancel = useRef(onCancel);
  latestOnCancel.current = onCancel;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const cancel = (e: Event) => {
      e.preventDefault();
      latestOnCancel.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, []);

  return (
    <dialog ref={ref} role="alertdialog" aria-labelledby={headingId} className={styles.alert}>
      <h3 id={headingId} className={styles.alertTitle}>
        Delete “{title}”?
      </h3>
      <p className={styles.alertText}>It will no longer be listed or available for new sessions.</p>
      <div className={styles.actions}>
        <span className={styles.spacer} />
        <Button variant="bordered" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </dialog>
  );
}
