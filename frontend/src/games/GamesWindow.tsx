import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { AreaNav } from "../components/AreaNav";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { Sidebar } from "../ui/Sidebar";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import styles from "./GamesWindow.module.css";
import { createChessSession, type GameInfo, listGames } from "./gamesApi";

/**
 * The games catalogue (spec 014 FR-1–FR-3): each game with its name and description and a
 * *Start* button, open to anyone. Starting chess creates a session and opens its invite route.
 */
export function GamesWindow() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    if (game.id !== "chess") return;
    try {
      const { invite_id } = await createChessSession();
      navigate(`/games/chess/s/${encodeURIComponent(invite_id)}`);
    } catch {
      setError("Could not start a game.");
    }
  }

  return (
    <Window
      sidebarOpen={sidebarOpen}
      sidebar={
        <Sidebar label="Sidebar">
          <AreaNav />
        </Sidebar>
      }
      toolbar={
        <Toolbar label="Games">
          <Button
            variant="plain"
            icon="sidebar"
            label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          />
          <h1 className={styles.title}>Games</h1>
          <span className={styles.spacer} />
          <AppearanceControl />
          <AccountControl />
        </Toolbar>
      }
    >
      <div className={styles.content}>
        {error && <InlineMessage id="games-error">{error}</InlineMessage>}
        <ul className={styles.list}>
          {games.map((g) => (
            <li key={g.id} className={styles.game}>
              <div className={styles.text}>
                <h2 className={styles.name}>{g.name}</h2>
                <p className={styles.description}>{g.description}</p>
              </div>
              <Button variant="bordered" label={`Start ${g.name}`} onClick={() => void start(g)}>
                Start
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Window>
  );
}
