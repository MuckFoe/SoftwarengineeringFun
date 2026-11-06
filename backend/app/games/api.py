"""Games REST (spec 014 plan.md "Contracts — REST"): the catalogue, open to anyone."""

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter

from app.games.catalog import GAMES

router = APIRouter()


@router.get("/api/games")
async def list_games() -> list[dict[str, Any]]:
    return [asdict(game) for game in GAMES]
