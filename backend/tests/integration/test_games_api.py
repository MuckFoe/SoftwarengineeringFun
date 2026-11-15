"""Spec 014 task 3: the games catalogue (`games/catalog.py`, `games/api.py`). FR-1, FR-2."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _client() -> TestClient:
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url="postgresql://unused",
        runner_url="http://unused",
    )
    return TestClient(create_app(settings))


def test_ac1_games_list_contains_chess_without_auth() -> None:
    response = _client().get("/api/games")
    assert response.status_code == 200
    games = response.json()
    assert [g["id"] for g in games] == ["chess", "rps"]
    chess = games[0]
    assert chess["id"] == "chess"
    assert chess["name"]
    assert chess["description"]
    assert chess["start_path"] == "/api/games/chess/sessions"


def test_ac1_spec021_rock_paper_siege_is_listed_beside_chess() -> None:
    """Spec 021 AC-1 (FR-1, FR-3)."""
    games = {g["id"]: g for g in _client().get("/api/games").json()}
    rps = games["rps"]
    assert rps["name"] == "Rock Paper Siege"
    assert rps["description"]
    assert rps["start_path"] == "/api/games/rps/sessions"
