"""Spec 006: every lesson file shipped under lessons/ parses and validates (FR-3, FR-5)."""

from pathlib import Path

import pytest

from app.learn.lesson_file import parse_lesson, parse_topic

LESSONS_DIR = Path(__file__).resolve().parents[3] / "lessons"


def _topics() -> list[Path]:
    if not LESSONS_DIR.is_dir():
        return []
    return sorted(p for p in LESSONS_DIR.iterdir() if p.is_dir())


def _lessons() -> list[Path]:
    return [lesson for topic in _topics() for lesson in sorted(topic.iterdir()) if lesson.is_dir()]


def test_lessons_folder_has_topics() -> None:
    assert _topics(), f"no topic folders under {LESSONS_DIR}"


@pytest.mark.parametrize("folder", _topics(), ids=lambda p: p.name)
def test_topic_parses(folder: Path) -> None:
    parse_topic(folder)


@pytest.mark.parametrize("folder", _lessons(), ids=lambda p: f"{p.parent.name}/{p.name}")
def test_lesson_parses(folder: Path) -> None:
    lesson = parse_lesson(folder)
    assert lesson.steps
