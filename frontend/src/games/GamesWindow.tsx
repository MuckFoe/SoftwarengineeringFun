import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { apiPath } from "../base";
import { AppHeader } from "../ui/AppHeader";
import { AreaTitle } from "../ui/AreaTitle";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineMessage } from "../ui/InlineMessage";
import { Window } from "../ui/Window";
import styles from "./GamesWindow.module.css";
import { type GameInfo, listGames } from "./gamesApi";

/** Where each game's sessions open, by catalogue `id` (spec 021 FR-1). */
const SESSION_ROUTES: Record<string, string> = {
  chess: "/games/chess/s/",
  rps: "/games/rps/s/",
};

/** POST to a catalogue entry's `start_path` ("/api/…"), under the app's base path. */
async function startSession(startPath: string): Promise<string> {
  const res = await fetch(apiPath(startPath.replace(/^\/api(?=\/)/, "")), {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw new ApiError(res.status, { kind: "http" });
  const { invite_id } = (await res.json()) as { invite_id: string };
  return invite_id;
}

/**
 * The games catalogue (spec 014 FR-1–FR-3): each game with its name and description and a
 * *Start* button, open to anyone. Starting a game posts to its `start_path` and opens the
 * invite route for its `id` (spec 021 FR-1).
 */
export function GamesWindow() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listGames().then(
      (found) => {
        if (current) setGames(found);
      },
      () => {
        if (current) setError("Could not load games.");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  async function start(game: GameInfo) {
    const route = SESSION_ROUTES[game.id];
    if (!route) return;
    try {
      const inviteId = await startSession(game.start_path);
      navigate(`${route}${encodeURIComponent(inviteId)}`);
    } catch {
      setError("Could not start a game.");
    }
  }

  return (
    <Window
      toolbar={
        <AppHeader label="Games">
          <AreaTitle title="Games" />
        </AppHeader>
      }
    >
      <div className={styles.content}>
        {error && <InlineMessage id="games-error">{error}</InlineMessage>}
        <ul className={styles.list}>
          {games.map((g) => (
            <li key={g.id}>
              <Card className={styles.game}>
                <div className={styles.text}>
                  <h2 className={styles.name}>{g.name}</h2>
                  <p className={styles.description}>{g.description}</p>
                </div>
                <Button variant="bordered" label={`Start ${g.name}`} onClick={() => void start(g)}>
                  Start
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </Window>
  );
}
