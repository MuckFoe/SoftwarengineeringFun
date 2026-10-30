import { type ReactNode, useState } from "react";
import { Route, Routes, useParams } from "react-router";
import { RequireRole } from "./auth/RequireRole";
import { LearningSessionWindow } from "./learn/LearningSessionWindow";
import { LearnWindow } from "./learn/LearnWindow";
import { NotFound } from "./pages/NotFound";
import { ProblemsWindow } from "./pages/ProblemsWindow";
import { SessionWindow } from "./pages/SessionWindow";
import { ShortcutList } from "./shortcuts/ShortcutList";
import { ShortcutsProvider, useShortcut } from "./shortcuts/useShortcut";
import { useAppearance } from "./theme/useAppearance";

/** The deep links are for editors, as the pages they replace were (spec 001 FR-1, FR-2a). */
function EditorsOnly({ children }: { children: ReactNode }) {
  // biome-ignore lint/a11y/useValidAriaRole: `role` is RequireRole's prop, not an ARIA role
  return <RequireRole role="editor">{children}</RequireRole>;
}

/** The old edit link, opened as the problems window with that problem's sheet (spec 003 FR-8). */
function EditProblemLink() {
  const { id = "" } = useParams();
  return <ProblemsWindow key={id} initialSheet={{ mode: "edit", id }} />;
}

/** Top-level routes (plan.md "Deploy"), under the one shortcut listener (spec 003 FR-17). */
export function App() {
  return (
    <ShortcutsProvider>
      <AppShell />
    </ShortcutsProvider>
  );
}

/**
 * Everything every screen shares: the appearance kept in step with the OS (FR-5) and the
 * shortcut list on ⇧⌘/ or Ctrl+Shift+/ (FR-19).
 */
function AppShell() {
  useAppearance();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcut("shortcutList", () => setShortcutsOpen(true));

  return (
    <>
      <Routes>
        <Route path="/" element={<ProblemsWindow />} />
        <Route
          path="/problems/new"
          element={
            <EditorsOnly>
              <ProblemsWindow initialSheet={{ mode: "new" }} />
            </EditorsOnly>
          }
        />
        <Route
          path="/problems/:id/edit"
          element={
            <EditorsOnly>
              <EditProblemLink />
            </EditorsOnly>
          }
        />
        <Route path="/s/:invite" element={<SessionWindow />} />
        <Route path="/learn" element={<LearnWindow />} />
        <Route path="/learn/s/:invite" element={<LearningSessionWindow />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <ShortcutList open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
