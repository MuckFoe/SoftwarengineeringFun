"""Spec 007: a reference to one GIPHY GIF. No media bytes are ever held (FR-12)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class GifRef:
    id: str
    title: str
    url: str
    still_url: str
    width: int
    height: int
