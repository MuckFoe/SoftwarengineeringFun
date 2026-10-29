import { type ChangeEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { ApiError, previewDescription, uploadImage } from "../api/client";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Spinner } from "../ui/Spinner";
import { Toolbar } from "../ui/Toolbar";
import styles from "./DescriptionEditor.module.css";
import { DescriptionView } from "./DescriptionView";
import { ACCEPTED_IMAGE_TYPES, imageRefusal, MAX_IMAGE_BYTES } from "./imageChecks";
import { applyCommand, insertImage, type MarkdownCommand, type TextEdit } from "./markdownCommands";

type Mode = "write" | "preview";

const MODES = [
  { value: "write", label: "Write" },
  { value: "preview", label: "Preview" },
] as const;

const COMMANDS: { command: MarkdownCommand; label: string; glyph: string; className?: string }[] = [
  { command: "heading", label: "Heading", glyph: "H", className: styles.bold },
  { command: "bold", label: "Bold", glyph: "B", className: styles.bold },
  { command: "italic", label: "Italic", glyph: "I", className: styles.italic },
  { command: "bulletedList", label: "Bulleted list", glyph: "•" },
  { command: "numberedList", label: "Numbered list", glyph: "1." },
  { command: "inlineCode", label: "Inline code", glyph: "`c`", className: styles.mono },
  { command: "codeBlock", label: "Code block", glyph: "{ }", className: styles.mono },
  { command: "link", label: "Link", glyph: "Link" },
];

const MB = 1024 * 1024;

function uploadFailure(e: unknown): string {
  if (e instanceof ApiError && e.error.kind === "image_too_large") {
    return `This image is too large. The limit is ${(e.error.limitBytes || MAX_IMAGE_BYTES) / MB} MB.`;
  }
  if (e instanceof ApiError && e.error.kind === "image_format") {
    return "This file can't be added. Use a PNG, JPEG, GIF or WebP image.";
  }
  return "The image couldn't be uploaded. Try again.";
}

/** The file name without its extension, as the image's alt text. */
function altText(name: string): string {
  return name.replace(/\.[^.]*$/, "") || "image";
}

/**
 * Markdown description editing (spec 002 FR2–FR5): a textarea, a formatting toolbar, image
 * upload with instant pre-checks, and a preview rendered by the server, so it matches what
 * participants see. Saving is the caller's.
 */
export function DescriptionEditor({
  value,
  onChange,
  invalid = false,
  describedBy,
}: {
  value: string;
  onChange(v: string): void;
  /** Set by a host that shows its own message for the field, such as a refused save. */
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const pendingSelection = useRef<TextEdit | null>(null);
  const previewRequest = useRef(0);

  const [mode, setMode] = useState<Mode>("write");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ html: string } | { error: true } | null>(null);

  // Restore the selection a command or an insertion produced once the new value is in.
  useLayoutEffect(() => {
    const edit = pendingSelection.current;
    const textarea = textareaRef.current;
    if (!edit || !textarea || textarea.value !== edit.value) return;
    pendingSelection.current = null;
    textarea.focus();
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  });

  function commit(edit: TextEdit) {
    pendingSelection.current = edit;
    onChange(edit.value);
  }

  function run(command: MarkdownCommand) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setMessage(null);
    commit(applyCommand(command, value, textarea.selectionStart, textarea.selectionEnd));
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const textarea = textareaRef.current;
    if (!file || !textarea) return;
    const refusal = imageRefusal(file, value);
    if (refusal) {
      setMessage(refusal.message);
      return;
    }
    const [start, end] = [textarea.selectionStart, textarea.selectionEnd];
    setMessage(null);
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      commit(insertImage(valueRef.current, start, end, uploaded.id, altText(file.name)));
    } catch (err) {
      setMessage(uploadFailure(err));
    } finally {
      setUploading(false);
    }
  }

  async function showPreview() {
    const request = ++previewRequest.current;
    setPreview(null);
    try {
      const result = await previewDescription(value);
      if (request === previewRequest.current) setPreview({ html: result.html });
    } catch {
      if (request === previewRequest.current) setPreview({ error: true });
    }
  }

  function onMode(next: Mode) {
    setMode(next);
    if (next === "preview") void showPreview();
  }

  const messageId = `${id}-message`;

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <label htmlFor={`${id}-source`} className={styles.label}>
          Description
        </label>
        <SegmentedControl label="Description mode" value={mode} onChange={onMode} options={MODES} />
      </div>

      {mode === "write" ? (
        <>
          <Toolbar label="Formatting">
            {COMMANDS.map(({ command, label, glyph, className }) => (
              <Button
                key={command}
                variant="plain"
                label={label}
                title={label}
                className={className}
                onClick={() => run(command)}
              >
                {glyph}
              </Button>
            ))}
            <Button
              variant="plain"
              label="Image"
              title="Image"
              busy={uploading}
              busyLabel="Uploading image"
              onClick={() => fileRef.current?.click()}
            >
              Image
            </Button>
          </Toolbar>
          {/* Outside the toolbar, which would otherwise count it as one of its items. */}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            aria-label="Image file"
            className={styles.file}
            tabIndex={-1}
            onChange={onFile}
          />
          <textarea
            ref={textareaRef}
            id={`${id}-source`}
            className={styles.source}
            value={value}
            rows={14}
            spellCheck
            aria-invalid={invalid || undefined}
            aria-describedby={
              [describedBy, message ? messageId : undefined].filter(Boolean).join(" ") || undefined
            }
            onChange={(e) => onChange(e.target.value)}
          />
          {message && <InlineMessage id={messageId}>{message}</InlineMessage>}
        </>
      ) : (
        <div className={styles.preview} aria-live="polite">
          {preview === null && <Spinner label="Rendering preview" size={16} />}
          {preview && "html" in preview && <DescriptionView html={preview.html} />}
          {preview && "error" in preview && (
            <InlineMessage id={messageId}>The preview isn't available right now.</InlineMessage>
          )}
        </div>
      )}
    </div>
  );
}
