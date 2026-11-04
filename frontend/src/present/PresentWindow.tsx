import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../auth/useMe";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { AreaNav } from "../components/AreaNav";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { SourceList } from "../ui/SourceList";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import { PresentationEditorSheet } from "./PresentationEditorSheet";
import styles from "./PresentWindow.module.css";
import { isPresentError, listPresentations, startSession } from "./presentApi";
import type { PresentationSummary } from "./presentTypes";

/** What an editor asked to do; `PresentationEditorSheet` acts on it. */
export type EditRequest =
  | { mode: "add" }
  | { mode: "replace"; id: string }
  | { mode: "remove"; id: string };

const ALL = "\u0000all";

const size = (p: PresentationSummary) =>
  p.kind === "page"
    ? "Single page"
    : `${p.slide_count} ${p.slide_count === 1 ? "slide" : "slides"}`;

/**
 * The presentation library (spec 013 FR-6, FR-8): every presentation with its title and
 * topic, filtered by topic in the sidebar, each with a *Start session* open to anyone.
 * Editors also get add, replace and remove (FR-1–FR-5, FR-7).
 */
export function PresentWindow() {
  const navigate = useNavigate();
  const me = useMe();
  const isEditor = me.status === "ready" && me.me.signed_in && me.me.roles.includes("editor");

  const [presentations, setPresentations] = useState<PresentationSummary[]>([]);
  const [topic, setTopic] = useState(ALL);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditRequest | null>(null);

  useEffect(() => {
    let current = true;
    listPresentations().then(
      (found) => {
        if (!current) return;
        if (isPresentError(found)) {
          setError("Could not load presentations.");
          return;
        }
        setPresentations(found);
        setError(null);
      },
      () => {
        if (current) setError("Could not load presentations.");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const topics = [
    { id: ALL, title: "All" },
    ...[...new Set(presentations.map((p) => p.topic))]
      .sort((a, b) => a.localeCompare(b))
      .map((t) => ({ id: t, title: t })),
  ];
  const shown = topic === ALL ? presentations : presentations.filter((p) => p.topic === topic);

  const byTitle = (list: PresentationSummary[]) =>
    [...list].sort((a, b) => a.title.localeCompare(b.title));

  function saved(summary: PresentationSummary) {
    setPresentations((list) => byTitle([...list.filter((p) => p.id !== summary.id), summary]));
    setEditing(null);
  }

  function removed(id: string) {
    setPresentations((list) => list.filter((p) => p.id !== id));
    setEditing(null);
  }

  async function start(presentationId: string) {
    try {
      const started = await startSession(presentationId);
      if (isPresentError(started)) throw new Error(started.error);
      navigate(`/present/s/${encodeURIComponent(started.invite_id)}`);
    } catch {
      setError("Could not start a session.");
    }
  }

  return (
    <Window
      sidebarOpen={sidebarOpen}
      sidebar={
        <Sidebar label="Sidebar">
          <AreaNav />
          <SidebarSection title="Topics">
            <SourceList
              label="Topics"
              items={topics}
              selectedId={topic}
              onActivate={(item) => setTopic(item.id)}
              renderItem={(item) => item.title}
            />
          </SidebarSection>
        </Sidebar>
      }
      toolbar={
        <Toolbar label="Present">
          <Button
            variant="plain"
            icon="sidebar"
            label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          />
          <h1 className={styles.title}>Present</h1>
          <span className={styles.spacer} />
          {isEditor && (
            <Button variant="plain" icon="plus" onClick={() => setEditing({ mode: "add" })}>
              Add presentation
            </Button>
          )}
          <AppearanceControl />
          <AccountControl />
        </Toolbar>
      }
    >
      <div className={styles.content}>
        {error && <InlineMessage id="present-error">{error}</InlineMessage>}
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Topic</th>
              <th scope="col">Size</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="anim-row-in">
                <th scope="row" className={styles.titleCell}>
                  {p.title}
                </th>
                <td className={styles.secondary}>{p.topic}</td>
                <td className={styles.secondary}>{size(p)}</td>
                <td className={styles.actions}>
                  {isEditor && (
                    <>
                      <Button
                        variant="plain"
                        icon="pencil"
                        label={`Replace HTML: ${p.title}`}
                        onClick={() => setEditing({ mode: "replace", id: p.id })}
                      />
                      <Button
                        variant="plain"
                        icon="trash"
                        label={`Remove: ${p.title}`}
                        onClick={() => setEditing({ mode: "remove", id: p.id })}
                      />
                    </>
                  )}
                  <Button
                    variant="bordered"
                    label={`Start session: ${p.title}`}
                    onClick={() => void start(p.id)}
                  >
                    Start session
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {presentations.length === 0 && !error && (
          <p className={styles.none}>No presentations yet.</p>
        )}
      </div>
      {editing && (
        <PresentationEditorSheet
          request={editing}
          presentation={
            editing.mode === "add" ? undefined : presentations.find((p) => p.id === editing.id)
          }
          onClose={() => setEditing(null)}
          onSaved={saved}
          onRemoved={removed}
        />
      )}
    </Window>
  );
}
