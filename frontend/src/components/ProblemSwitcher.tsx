import { useEffect, useState } from "react";
import { searchProblems } from "../api/client";
import type { ProblemSummary } from "../api/types";
import type { CollabProvider } from "../collab/provider";

interface Props {
  provider: Pick<CollabProvider, "send" | "on">;
}

/** Searches problems and sends `switch_problem` (FR-17). */
export function ProblemSwitcher({ provider }: Props) {
  const [query, setQuery] = useState("");
  const [problems, setProblems] = useState<ProblemSummary[]>([]);

  useEffect(() => {
    let current = true;
    searchProblems(query).then(
      (found) => {
        if (current) setProblems(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [query]);

  return (
    <section>
      <label>
        Switch problem{" "}
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul>
        {problems.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => provider.send({ type: "switch_problem", problem_id: p.id })}
            >
              {p.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
