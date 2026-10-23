import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { createSession, searchProblems } from "../api/client";
import type { ProblemSummary } from "../api/types";

/** Lists problems matching the search text (FR-5) and starts sessions (FR-11). */
export function ProblemList() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Matching is done by the server; a response for an outdated query is dropped.
    let current = true;
    searchProblems(query).then(
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
  }, [query]);

  async function start(problemId: string) {
    try {
      const { invite_id } = await createSession(problemId);
      // The session page shows the invite link (FR-11).
      navigate(`/s/${encodeURIComponent(invite_id)}`);
    } catch {
      setError("Could not start a session.");
    }
  }

  return (
    <section>
      <h2>Problems</h2>
      <label>
        Search problems{" "}
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <ul>
        {problems.map((p) => (
          <li key={p.id}>
            <span>{p.title}</span>{" "}
            <button
              type="button"
              aria-label={`Start session: ${p.title}`}
              onClick={() => void start(p.id)}
            >
              Start session
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
