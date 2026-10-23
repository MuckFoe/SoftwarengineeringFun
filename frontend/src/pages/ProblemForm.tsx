import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ApiError,
  createProblem,
  deleteProblem,
  getProblemForEdit,
  updateProblem,
} from "../api/client";
import type { FieldError, ProblemTest } from "../api/types";
import { RequireRole } from "../auth/RequireRole";

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

function errorsFor(errors: FieldError[], field: string): FieldError[] {
  return errors.filter((e) => e.field === field && e.test_index === undefined);
}

function errorForRow(errors: FieldError[], index: number): FieldError | undefined {
  return errors.find((e) => e.field === "tests" && e.test_index === index);
}

function ProblemFormFields() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [signature, setSignature] = useState("");
  const [rows, setRows] = useState<TestRow[]>([emptyRow()]);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [badRows, setBadRows] = useState<number[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let current = true;
    getProblemForEdit(id).then(
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
  }, [id]);

  function updateRow(index: number, patch: Partial<TestRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors([]);

    const parsed = parseRows(rows);
    if ("badRows" in parsed) {
      setBadRows(parsed.badRows);
      return;
    }
    setBadRows([]);

    const input = { title, description, signature, tests: parsed.tests };
    try {
      if (id !== undefined) {
        await updateProblem(id, input);
      } else {
        await createProblem(input);
      }
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.error.kind === "validation") {
        setFieldErrors(err.error.errors);
      } else {
        setGeneralError("Could not save this problem.");
      }
    }
  }

  async function handleDelete() {
    if (id === undefined) return;
    try {
      await deleteProblem(id);
      navigate("/");
    } catch {
      setGeneralError("Could not delete this problem.");
    }
  }

  const testsError = errorsFor(fieldErrors, "tests")[0];

  return (
    <section>
      <h2>{isEdit ? "Edit problem" : "New problem"}</h2>
      {generalError && <p role="alert">{generalError}</p>}
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {errorsFor(fieldErrors, "title").map((e) => (
          <p role="alert" key={e.message}>
            {e.message}
          </p>
        ))}

        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {errorsFor(fieldErrors, "description").map((e) => (
          <p role="alert" key={e.message}>
            {e.message}
          </p>
        ))}

        <label>
          Signature
          <input value={signature} onChange={(e) => setSignature(e.target.value)} />
        </label>
        {errorsFor(fieldErrors, "signature").map((e) => (
          <p role="alert" key={e.message}>
            {e.message}
          </p>
        ))}

        <fieldset>
          <legend>Tests</legend>
          {testsError && <p role="alert">{testsError.message}</p>}
          {rows.map((row, i) => {
            const rowError = errorForRow(fieldErrors, i);
            return (
              <div key={row.key}>
                <label>
                  {`Test ${i + 1} args`}
                  <input
                    value={row.args}
                    onChange={(e) => updateRow(i, { args: e.target.value })}
                  />
                </label>
                <label>
                  {`Test ${i + 1} expected`}
                  <input
                    value={row.expected}
                    onChange={(e) => updateRow(i, { expected: e.target.value })}
                  />
                </label>
                <button type="button" onClick={() => removeRow(i)}>
                  Remove test {i + 1}
                </button>
                {badRows.includes(i) && (
                  <p role="alert">Test {i + 1}: args and expected must be valid JSON</p>
                )}
                {rowError && <p role="alert">{rowError.message}</p>}
              </div>
            );
          })}
          <button type="button" onClick={addRow}>
            Add test
          </button>
        </fieldset>

        <button type="submit">{isEdit ? "Save" : "Create"}</button>
      </form>
      {isEdit && (
        <button type="button" onClick={() => void handleDelete()}>
          Delete
        </button>
      )}
    </section>
  );
}

/** Create, edit and delete a problem (FR-3, FR-4, FR-7, FR-8), editors only (FR-2a). */
export function ProblemForm() {
  return (
    // biome-ignore lint/a11y/useValidAriaRole: `role` is RequireRole's prop, not an ARIA role
    <RequireRole role="editor">
      <ProblemFormFields />
    </RequireRole>
  );
}
