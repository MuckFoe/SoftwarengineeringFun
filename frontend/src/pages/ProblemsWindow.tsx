import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createSession, searchProblems } from "../api/client";
import type { ProblemSummary } from "../api/types";
import { useMe } from "../auth/useMe";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { AreaNav } from "../components/AreaNav";
import { StaleSessionsList } from "../components/StaleSessionsList";
import { ShortcutScope, useShortcut } from "../shortcuts/useShortcut";
import { Button } from "../ui/Button";
import { Hud } from "../ui/Hud";
import { InlineMessage } from "../ui/InlineMessage";
import { SearchField } from "../ui/SearchField";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { SourceList } from "../ui/SourceList";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import { ProblemEditorSheet } from "./ProblemEditorSheet";
import styles from "./ProblemsWindow.module.css";

export type SheetRequest = { mode: "new" } | { mode: "edit"; id: string };

const LIBRARIES = [
  { id: "all", title: "All problems" },
  { id: "starter", title: "Starter problems" },
] as const;

type Library = (typeof LIBRARIES)[number]["id"];

interface Props {
  /** Opens the editor sheet on arrival, for the /problems/new and /problems/:id/edit links. */
  initialSheet?: SheetRequest;
}

/**
 * The problems window (FR-2, FR-9, FR-10, FR-11): browse and search problems, start a
 * session, and, for editors, create and edit problems in a sheet over the list without
 * leaving it. Admins also see the stale sessions.
 */
export function ProblemsWindow({ initialSheet }: Props) {
  const navigate = useNavigate();
  const me = useMe();
  const roles = me.status === "ready" ? me.me.roles : [];
  const isEditor = roles.includes("editor");
  const isAdmin = roles.includes("admin");

  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<Library>("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sheet, setSheet] = useState<SheetRequest | null>(initialSheet ?? null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<{ key: number; message: string } | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` re-fetches after a save or delete.
  useEffect(() => {
    let current = true;
    searchProblems("").then(
      (found) => {
        if (!current) return;
        setProblems(found);
        setError(null);
      },
      () => {
        if (current) setError("Could not load problems.");
      },
    );
    return () => {
      current = false;
    };
  }, [reload]);

  useShortcut("focusSearch", () => search.current?.focus());
  useShortcut("newProblem", () => setSheet({ mode: "new" }), { enabled: isEditor });
  useShortcut("toggleSidebar", () => setSidebarOpen((open) => !open));

  // Filtered by title on every keystroke (FR-11).
  const needle = query.trim().toLowerCase();
  const shown = problems.filter(
    (p) =>
      (library === "all" || p.is_starter) &&
      (needle === "" || p.title.toLowerCase().includes(needle)),
  );

  async function start(problemId: string) {
    try {
      const { invite_id } = await createSession(problemId);
      navigate(`/s/${encodeURIComponent(invite_id)}`);
    } catch {
      setError("Could not start a session.");
    }
  }

  function closeSheet(message?: string) {
    setSheet(null);
    if (message) {
      setReload((n) => n + 1);
      setHud({ key: Date.now(), message });
    }
  }

  return (
    <ShortcutScope scope="problems">
      <Window
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar label="Sidebar">
            <AreaNav />
            <SidebarSection title="Problems">
              <SourceList
                label="Problems"
                items={LIBRARIES}
                selectedId={library}
                onActivate={(item) => setLibrary(item.id)}
                renderItem={(item) => item.title}
              />
            </SidebarSection>
            {isAdmin && <StaleSessionsList />}
          </Sidebar>
        }
        toolbar={
          <Toolbar label="Problems">
            <Button
              variant="plain"
              icon="sidebar"
              label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            />
            <h1 className={styles.title}>Problems</h1>
            <span className={styles.spacer} />
            <div className={styles.search}>
              <SearchField ref={search} label="Search problems" value={query} onChange={setQuery} />
            </div>
            {isEditor && (
              <Button variant="plain" icon="plus" onClick={() => setSheet({ mode: "new" })}>
                New problem
              </Button>
            )}
            <AppearanceControl />
            <AccountControl />
          </Toolbar>
        }
      >
        <div className={styles.content}>
          {error && <InlineMessage id="problems-error">{error}</InlineMessage>}
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Kind</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="anim-row-in">
                  <td className={styles.titleCell}>{p.title}</td>
                  <td className={styles.kind}>{p.is_starter ? "Starter" : ""}</td>
                  <td className={styles.actions}>
                    {isEditor && (
                      <Button
                        variant="plain"
                        label={`Edit ${p.title}`}
                        icon="pencil"
                        onClick={() => setSheet({ mode: "edit", id: p.id })}
                      />
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
          {shown.length === 0 && problems.length > 0 && (
            <p className={styles.none}>No problems match “{query}”.</p>
          )}
        </div>
      </Window>
      <ProblemEditorSheet
        open={sheet !== null}
        problemId={sheet?.mode === "edit" ? sheet.id : undefined}
        onClose={() => closeSheet()}
        onSaved={() => closeSheet("Problem saved")}
        onDeleted={() => closeSheet("Problem deleted")}
      />
      {hud && <Hud key={hud.key} message={hud.message} />}
    </ShortcutScope>
  );
}
