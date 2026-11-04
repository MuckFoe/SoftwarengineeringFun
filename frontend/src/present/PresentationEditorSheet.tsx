import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";
import styles from "./PresentationEditorSheet.module.css";
import type { EditRequest } from "./PresentWindow";
import {
  addPresentation,
  analyze,
  isPresentError,
  removePresentation,
  replaceHtml,
} from "./presentApi";
import type { Analysis, PresentationSummary, PresentError } from "./presentTypes";

const TITLE_MAX = 100;
const TOPIC_MAX = 60;
const MB = 1024 * 1024;

type Source = "file" | "paste";

interface Props {
  request: EditRequest;
  /** The presentation being replaced or removed; absent when adding. */
  presentation?: PresentationSummary;
  onClose(): void;
  /** Added (201) or replaced (200): the server's summary of the presentation. */
  onSaved(saved: PresentationSummary): void;
  onRemoved(id: string): void;
}

/** Why the server refused the HTML or the request, in words (FR-3, FR-7). */
function refusal(err: PresentError, source: Source): string {
  switch (err.error) {
    case "too_large":
      return `That HTML is larger than the ${Math.round((err.limit_bytes ?? 5 * MB) / MB)} MB limit.`;
    case "not_html":
      return source === "file" ? "That file isn't HTML." : "That text isn't HTML.";
    case "empty":
      return "There is no HTML to check.";
    case "invalid_title":
      return `Enter a title of at most ${TITLE_MAX} characters.`;
    case "invalid_topic":
      return `Enter a topic of at most ${TOPIC_MAX} characters.`;
    case "missing_role":
      return "Only editors can change presentations.";
    case "unauthorized":
      return "Sign in as an editor to change presentations.";
    case "not_found":
      return "This presentation no longer exists.";
    default:
      return "Something went wrong. Try again.";
  }
}

const analysisText = (a: Analysis) =>
  a.kind === "page"
    ? "Single page: no slide marks, shown as one page"
    : `Presentation of ${a.slide_count} ${a.slide_count === 1 ? "slide" : "slides"}`;

/**
 * Add, replace or remove a presentation (spec 013 FR-1–FR-5, FR-7). The HTML comes from a
 * file or pasted text; *Check* asks the server what it is (FR-2) and only then can it be
 * saved. Refusals (5 MB, not HTML, bad fields) are shown beside the form and save nothing.
 */
export function PresentationEditorSheet({
  request,
  presentation,
  onClose,
  onSaved,
  onRemoved,
}: Props) {
  if (request.mode === "remove") {
    return (
      <RemoveSheet
        id={request.id}
        title={presentation?.title ?? "this presentation"}
        onClose={onClose}
        onRemoved={onRemoved}
      />
    );
  }
  return (
    <HtmlSheet
      replaceId={request.mode === "replace" ? request.id : undefined}
      replaceTitle={presentation?.title}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function HtmlSheet({
  replaceId,
  replaceTitle,
  onClose,
  onSaved,
}: {
  replaceId?: string;
  replaceTitle?: string;
  onClose(): void;
  onSaved(saved: PresentationSummary): void;
}) {
  const ids = useId();
  const isReplace = replaceId !== undefined;
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState<Source>("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Answers for HTML that has since been changed are ignored.
  const generation = useRef(0);

  const body: Blob | string | null = source === "file" ? file : pasted.trim() ? pasted : null;

  function htmlChanged() {
    generation.current += 1;
    setAnalysis(null);
    setHtmlError(null);
  }

  async function check() {
    if (body === null) {
      setHtmlError(source === "file" ? "Choose an HTML file." : "Paste the HTML.");
      return;
    }
    const mine = ++generation.current;
    setHtmlError(null);
    setBusy(true);
    try {
      const answer = await analyze(body);
      if (mine !== generation.current) return;
      if (isPresentError(answer)) setHtmlError(refusal(answer, source));
      else setAnalysis(answer);
    } catch {
      if (mine === generation.current) setHtmlError("Could not check this HTML. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function fieldsValid(): boolean {
    const t = title.trim();
    const p = topic.trim();
    const tErr = !t
      ? "Enter a title."
      : t.length > TITLE_MAX
        ? `The title can be at most ${TITLE_MAX} characters.`
        : null;
    const pErr = !p
      ? "Enter a topic."
      : p.length > TOPIC_MAX
        ? `The topic can be at most ${TOPIC_MAX} characters.`
        : null;
    setTitleError(tErr);
    setTopicError(pErr);
    return tErr === null && pErr === null;
  }

  async function save() {
    if (analysis === null || body === null) return;
    if (!isReplace && !fieldsValid()) return;
    setBusy(true);
    try {
      const answer = isReplace
        ? await replaceHtml(replaceId, body)
        : await addPresentation(title.trim(), topic.trim(), body);
      if (!isPresentError(answer)) {
        onSaved(answer);
        return;
      }
      if (answer.error === "invalid_title") setTitleError(refusal(answer, source));
      else if (answer.error === "invalid_topic") setTopicError(refusal(answer, source));
      else setHtmlError(refusal(answer, source));
    } catch {
      setHtmlError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const htmlMessageId = `${ids}-html-message`;
  const analysisId = `${ids}-analysis`;

  return (
    <Sheet
      open
      onClose={onClose}
      title={isReplace ? `Replace HTML: ${replaceTitle ?? ""}` : "Add presentation"}
      defaultAction={() => void (analysis ? save() : check())}
    >
      {!isReplace && (
        <>
          <TextField
            label="Title"
            value={title}
            onChange={setTitle}
            error={titleError ?? undefined}
          />
          <TextField
            label="Topic"
            value={topic}
            onChange={setTopic}
            error={topicError ?? undefined}
          />
        </>
      )}
      <SegmentedControl
        label="HTML source"
        value={source}
        onChange={(v) => {
          setSource(v);
          htmlChanged();
        }}
        options={[
          { value: "file", label: "File" },
          { value: "paste", label: "Paste" },
        ]}
      />
      {source === "file" ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-file`}>
            HTML file
          </label>
          <input
            id={`${ids}-file`}
            type="file"
            accept=".html,.htm"
            aria-invalid={htmlError ? true : undefined}
            aria-describedby={htmlError ? htmlMessageId : undefined}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              htmlChanged();
            }}
          />
        </div>
      ) : (
        <TextField
          label="HTML"
          value={pasted}
          onChange={(v) => {
            setPasted(v);
            htmlChanged();
          }}
          multiline
          rows={8}
          monospace
          invalid={htmlError !== null}
          describedBy={htmlError ? htmlMessageId : undefined}
        />
      )}
      {htmlError && <InlineMessage id={htmlMessageId}>{htmlError}</InlineMessage>}
      {analysis && (
        <InlineMessage id={analysisId} tone="info">
          {analysisText(analysis)}
        </InlineMessage>
      )}
      <div className={styles.actions}>
        <Button variant="bordered" onClick={() => void check()} busy={busy && !analysis}>
          Check
        </Button>
        <span className={styles.spacer} />
        <Button variant="bordered" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={analysis === null}
          busy={busy && analysis !== null}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}

function RemoveSheet({
  id,
  title,
  onClose,
  onRemoved,
}: {
  id: string;
  title: string;
  onClose(): void;
  onRemoved(id: string): void;
}) {
  const messageId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const answer = await removePresentation(id);
      if (isPresentError(answer)) setError(refusal(answer, "file"));
      else onRemoved(id);
    } catch {
      setError("Could not remove. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // No default action: Return must not remove (destructive).
  return (
    <Sheet open onClose={onClose} title={`Remove “${title}”?`}>
      <p className={styles.text}>
        It leaves the library. Sessions already started show that it is no longer available.
      </p>
      {error && <InlineMessage id={messageId}>{error}</InlineMessage>}
      <div className={styles.actions}>
        <span className={styles.spacer} />
        <Button variant="bordered" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" busy={busy} onClick={() => void remove()}>
          Remove
        </Button>
      </div>
    </Sheet>
  );
}
