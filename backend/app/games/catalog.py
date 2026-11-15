"""The static list of games on offer (spec 014 FR-1, FR-2)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Game:
    id: str
    name: str
    description: str
    start_path: str


GAMES: tuple[Game, ...] = (
    Game(
        id="chess",
        name="Chess",
        description="Play a game of chess with a friend; others can watch and chat.",
        start_path="/api/games/chess/sessions",
    ),
    Game(
        id="rps",
        name="Rock Paper Siege",
        description="Outwit a friend on a hidden board of rocks, papers and scissors; "
        "others can watch.",
        start_path="/api/games/rps/sessions",
    ),
)
