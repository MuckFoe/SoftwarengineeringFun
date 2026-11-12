import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createSession, getProblemCategories, searchProblems } from "../api/client";
import type { Difficulty, ProblemCategory, ProblemSummary } from "../api/types";
import { useMe } from "../auth/useMe";
import { StaleSessionsList } from "../components/StaleSessionsList";
import { ShortcutScope, useShortcut } from "../shortcuts/useShortcut";
import { AppHeader } from "../ui/AppHeader";
import { AreaTitle } from "../ui/AreaTitle";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { HeaderButton } from "../ui/HeaderButton";
import { Hud } from "../ui/Hud";
import { InlineMessage } from "../ui/InlineMessage";
import { SearchField } from "../ui/SearchField";
import { Select } from "../ui/Select";
import { Sidebar, SidebarSection } from "../ui/Sidebar";
import { SourceList } from "../ui/SourceList";
import { Tag } from "../ui/Tag";
import { Window } from "../ui/Window";
import { ProblemEditorSheet } from "./ProblemEditorSheet";
import styles from "./ProblemsWindow.module.css";

export type SheetRequest = { mode: "new" } | { mode: "edit"; id: string };

const LIBRARIES = [
  { id: "all", title: "All problems" },
  { id: "starter", title: "Starter problems" },
] as const;

type Library = (typeof LIBRARIES)[number]["id"];

const DIFFICULTIES: readonly { id: Difficulty; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];
const DIFFICULTY_LABEL = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.label]));
const ALL = "";

interface Group {
  key: string;
  label: string | null;
  items: ProblemSummary[];
}

/** Groups by category in the catalogue's category order, unset last; each group keeps the server's order. */
function groupByCategory(items: ProblemSummary[], categories: ProblemCategory[]): Group[] {
  const groups: Group[] = categories.map((c) => ({ key: c.id, label: c.label, items: [] }));
  const other: Group = { key: "", label: "Other", items: [] };
  for (const p of items) {
    const group = groups.find((g) => g.key === p.category) ?? other;
    group.items.push(p);
  }
  return [...groups, other].filter((g) => g.items.length > 0);
}

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
  const [categories, setCategories] = useState<ProblemCategory[]>([]);
  const [category, setCategory] = useState(ALL);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [library, setLibrary] = useState<Library>("all");
  // Below 1200 px the sidebar overlays the list (Window), so it starts closed there.
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 75rem)").matches,
  );
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

  useEffect(() => {
    let current = true;
    getProblemCategories().then(
      (found) => {
        if (current) setCategories(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  useShortcut("focusSearch", () => search.current?.focus());
  useShortcut("newProblem", () => setSheet({ mode: "new" }), { enabled: isEditor });
  useShortcut("toggleSidebar", () => setSidebarOpen((open) => !open));

  // Filtered by title on every keystroke (FR-11).
  const needle = query.trim().toLowerCase();
  const shown = problems.filter(
    (p) =>
      (library === "all" || p.is_starter) &&
      (category === ALL || p.category === category) &&
      (difficulty === null || p.difficulty === difficulty) &&
      (needle === "" || p.title.toLowerCase().includes(needle)),
  );

  const filtered = category !== ALL || difficulty !== null || needle !== "";
  const groups: Group[] =
    filtered || categories.length === 0
      ? [{ key: "all", label: null, items: shown }]
      : groupByCategory(shown, categories);
  const categoryLabel = (id: string | null | undefined) =>
    categories.find((c) => c.id === id)?.label ?? "";

  function clearFilters() {
    setCategory(ALL);
    setDifficulty(null);
    setQuery("");
  }

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
          <AppHeader label="Problems">
            <HeaderButton
              icon="sidebar"
              label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            />
            <AreaTitle title="Problems" />
            {isEditor && (
              <HeaderButton icon="plus" onClick={() => setSheet({ mode: "new" })}>
                New problem
              </HeaderButton>
            )}
          </AppHeader>
        }
      >
        <div className={styles.content}>
          {error && <InlineMessage id="problems-error">{error}</InlineMessage>}
          <div className={styles.filters}>
            <div className={styles.search}>
              <SearchField
                ref={search}
                label="Search problems"
                placeholder="Search problems"
                value={query}
                onChange={setQuery}
              />
            </div>
            <div className={styles.category}>
              <Select
                label="Category"
                value={category}
                onChange={setCategory}
                options={[
                  { value: ALL, label: "All categories" },
                  ...categories.map((c) => ({ value: c.id, label: c.label })),
                ]}
              />
            </div>
            <fieldset className={styles.difficulties}>
              <legend className={styles.visuallyHidden}>Difficulty</legend>
              {DIFFICULTIES.map((d) => (
                <Tag
                  key={d.id}
                  label={d.label}
                  selected={difficulty === d.id}
                  onClick={() => setDifficulty(difficulty === d.id ? null : d.id)}
                />
              ))}
            </fieldset>
            {filtered && shown.length > 0 && (
              <Button variant="plain" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <output className={styles.count} aria-label="Result count" aria-live="polite">
              {shown.length === 1 ? "1 problem" : `${shown.length} problems`}
            </output>
          </div>
          {shown.length === 0 && problems.length > 0 ? (
            <EmptyState
              icon="search"
              title="No problems match"
              action={
                <Button variant="bordered" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              Try a different search, category or difficulty.
            </EmptyState>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Category</th>
                  <th scope="col">Difficulty</th>
                  <th scope="col">Kind</th>
                  <th scope="col">
                    <span className={styles.visuallyHidden}>Actions</span>
                  </th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  {g.label && (
                    <tr className={styles.groupRow}>
                      <th scope="rowgroup" colSpan={5}>
                        <h2 className={styles.groupTitle}>{g.label}</h2>
                      </th>
                    </tr>
                  )}
                  {g.items.map((p) => (
                    <tr key={p.id} className="anim-row-in">
                      <td className={styles.titleCell}>{p.title}</td>
                      <td className={styles.meta}>{categoryLabel(p.category)}</td>
                      <td className={styles.meta}>
                        {p.difficulty ? DIFFICULTY_LABEL[p.difficulty] : ""}
                      </td>
                      <td className={styles.kind}>
                        {p.is_starter ? <span className={styles.badge}>Starter</span> : ""}
                      </td>
                      <td className={styles.actions}>
                        {isEditor && (
                          <Button
                            variant="plain"
                            size="xs"
                            label={`Edit ${p.title}`}
                            icon="pencil"
                            onClick={() => setSheet({ mode: "edit", id: p.id })}
                          />
                        )}
                        <Button
                          variant="bordered"
                          size="xs"
                          icon="play"
                          className={styles.start}
                          label={`Start session: ${p.title}`}
                          onClick={() => void start(p.id)}
                        >
                          Start session
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
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
