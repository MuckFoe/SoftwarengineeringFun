import { useEffect, useState } from "react";
import { searchProblems } from "../api/client";
import type { ProblemSummary } from "../api/types";
import type { CollabProvider } from "../collab/provider";
import { useShortcut } from "../shortcuts/useShortcut";
import { SourceList } from "../ui/SourceList";

interface Props {
  provider: Pick<CollabProvider, "send">;
  /** The session's current problem, as the server last reported it. */
  currentProblemId: string;
}

/**
 * The session sidebar's problem list (FR-9): activating a row sends `switch_problem`
 * (FR-17), the same message the old switcher sent. The picked row shows as selected at
 * once; the session's next report of its current problem takes over from there. The
 * next/previous problem shortcuts move through this list, stopping at either end.
 */
export function ProblemSourceList({ provider, currentProblemId }: Props) {
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    searchProblems("").then(
      (found) => {
        if (current) setProblems(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  // A switch by anyone (including this one, echoed back) replaces the local pick.
  const [reported, setReported] = useState(currentProblemId);
  if (reported !== currentProblemId) {
    setReported(currentProblemId);
    setPicked(null);
  }

  const selectedId = picked ?? currentProblemId;

  function activate(problem: ProblemSummary) {
    if (problem.id === selectedId) return;
    setPicked(problem.id);
    provider.send({ type: "switch_problem", problem_id: problem.id });
  }

  function step(by: 1 | -1) {
    const index = problems.findIndex((p) => p.id === selectedId);
    const target = index === -1 ? undefined : problems[index + by];
    if (target) activate(target);
  }

  useShortcut("nextProblem", () => step(1));
  useShortcut("previousProblem", () => step(-1));

  return (
    <SourceList
      label="Problems"
      items={problems}
      selectedId={selectedId}
      onActivate={activate}
      renderItem={(p) => p.title}
    />
  );
}
