"""Lesson files: parse and validate one lesson.toml or topic.toml (spec 006 plan, Lesson files).

Pure apart from reading the files. Every problem is a `LessonError` naming the file, so a bad
lesson stops startup instead of reaching learners (FR-5). Images referenced from a body or
hint must be files in the lesson's own folder, of a type sniffed from their bytes.
"""

import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from markdown_it import MarkdownIt
from markdown_it.token import Token

from app.problems.images import sniff_media_type

LESSON_FILE = "lesson.toml"
TOPIC_FILE = "topic.toml"
STEP_KINDS = ("explanation", "quiz", "terminal")
CHECK_TYPES = ("choice", "text", "terminal")
DEFAULT_PROMPT = "$ "


class LessonError(Exception):
    def __init__(self, path: Path, problem: str) -> None:
        super().__init__(f"{path}: {problem}")
        self.path = path
        self.problem = problem


@dataclass(frozen=True)
class ChoiceCheck:
    options: tuple[str, ...]
    correct: tuple[int, ...]  # 1-based option numbers
    multiple: bool
    type: Literal["choice"] = field(default="choice", init=False)


@dataclass(frozen=True)
class TextCheck:
    accept: tuple[str, ...]
    type: Literal["text"] = field(default="text", init=False)


@dataclass(frozen=True)
class CommandOutput:
    command: str
    output: str


@dataclass(frozen=True)
class TerminalCheck:
    prompt: str
    accept: tuple[CommandOutput, ...]  # the first is the one Show answer reveals (FR-14a)
    responses: tuple[CommandOutput, ...]
    type: Literal["terminal"] = field(default="terminal", init=False)


Check = ChoiceCheck | TextCheck | TerminalCheck


@dataclass(frozen=True)
class Step:
    kind: Literal["explanation", "quiz", "terminal"]
    title: str
    body: str
    hint: str | None
    check: Check | None


@dataclass(frozen=True)
class Lesson:
    title: str
    summary: str
    minutes: int
    steps: tuple[Step, ...]
    images: tuple[str, ...]  # file names in the lesson folder, sorted


@dataclass(frozen=True)
class Topic:
    title: str


class _Invalid(Exception):
    """A problem found below the file level; parse_* adds the path."""


def parse_topic(folder: Path) -> Topic:
    path = folder / TOPIC_FILE
    if not path.is_file():
        raise LessonError(path, f"topic folder has no {TOPIC_FILE}")
    data = _load(path)
    try:
        return Topic(title=_text(data, "title"))
    except _Invalid as e:
        raise LessonError(path, str(e)) from None


def parse_lesson(folder: Path) -> Lesson:
    path = folder / LESSON_FILE
    if not path.is_file():
        raise LessonError(path, f"lesson folder has no {LESSON_FILE}")
    data = _load(path)
    try:
        title = _text(data, "title")
        summary = _text(data, "summary")
        minutes = _int(data, "minutes")
        if minutes < 1:
            raise _Invalid("minutes must be at least 1")
        raw_steps = data.get("steps")
        if not isinstance(raw_steps, list) or not raw_steps:
            raise _Invalid("steps must list at least one step")
        steps = tuple(_step(n, raw) for n, raw in enumerate(raw_steps, start=1))
        images = _images(folder, steps)
    except _Invalid as e:
        raise LessonError(path, str(e)) from None
    return Lesson(title=title, summary=summary, minutes=minutes, steps=steps, images=images)


def _load(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as f:
            return tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        raise LessonError(path, f"invalid TOML: {e}") from None


def _text(data: dict[str, Any], key: str, where: str = "") -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise _Invalid(f"{where}{key} must be a non-blank string")
    return value


def _int(data: dict[str, Any], key: str) -> int:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise _Invalid(f"{key} must be an integer")
    return value


def _step(n: int, raw: object) -> Step:
    where = f"step {n}: "
    if not isinstance(raw, dict):
        raise _Invalid(f"{where}must be a table")
    kind = raw.get("kind")
    if kind not in STEP_KINDS:
        raise _Invalid(f"{where}kind must be one of {', '.join(STEP_KINDS)}, not {kind!r}")
    title = _text(raw, "title", where)
    body = _text(raw, "body", where)
    hint = raw.get("hint")
    if hint is not None and not isinstance(hint, str):
        raise _Invalid(f"{where}hint must be a string")

    raw_check = raw.get("check")
    check = None if raw_check is None else _check(where, raw_check)
    if kind == "quiz" and not isinstance(check, ChoiceCheck | TextCheck):
        raise _Invalid(f"{where}a quiz needs a check of type choice or text")
    if kind == "terminal" and not isinstance(check, TerminalCheck):
        raise _Invalid(f"{where}a terminal step needs a check of type terminal")
    return Step(kind=kind, title=title, body=body, hint=hint, check=check)


def _check(where: str, raw: object) -> Check:
    if not isinstance(raw, dict):
        raise _Invalid(f"{where}check must be a table")
    kind = raw.get("type")
    if kind == "choice":
        return _choice(where, raw)
    if kind == "text":
        return _text_check(where, raw)
    if kind == "terminal":
        return _terminal(where, raw)
    raise _Invalid(f"{where}check type must be one of {', '.join(CHECK_TYPES)}, not {kind!r}")


def _choice(where: str, raw: dict[str, Any]) -> ChoiceCheck:
    options = raw.get("options")
    if (
        not isinstance(options, list)
        or len(options) < 2
        or not all(isinstance(o, str) and o.strip() for o in options)
    ):
        raise _Invalid(f"{where}choice options must list at least 2 non-blank strings")
    correct = raw.get("correct")
    if not isinstance(correct, list) or not correct:
        raise _Invalid(f"{where}choice has no correct answer: correct must list an option number")
    for c in correct:
        if isinstance(c, bool) or not isinstance(c, int) or not 1 <= c <= len(options):
            raise _Invalid(f"{where}correct option {c!r} is out of range 1..{len(options)}")
    if len(set(correct)) != len(correct):
        raise _Invalid(f"{where}correct lists a duplicate option number")
    multiple = raw.get("multiple")
    if not isinstance(multiple, bool):
        raise _Invalid(f"{where}choice must say multiple = true or false")
    if not multiple and len(correct) != 1:
        raise _Invalid(f"{where}multiple = false needs exactly one correct option")
    return ChoiceCheck(options=tuple(options), correct=tuple(correct), multiple=multiple)


def _text_check(where: str, raw: dict[str, Any]) -> TextCheck:
    accept = raw.get("accept")
    if (
        not isinstance(accept, list)
        or not accept
        or not all(isinstance(a, str) and a.strip() for a in accept)
    ):
        raise _Invalid(f"{where}text accept must list at least one answer, none blank")
    return TextCheck(accept=tuple(accept))


def _terminal(where: str, raw: dict[str, Any]) -> TerminalCheck:
    prompt = raw.get("prompt", DEFAULT_PROMPT)
    if not isinstance(prompt, str):
        raise _Invalid(f"{where}prompt must be a string")
    accept = _commands(where, "accept", raw.get("accept"))
    if not accept:
        raise _Invalid(f"{where}terminal accept must list at least one command")
    responses = _commands(where, "responses", raw.get("responses", []))
    seen: set[str] = set()
    for entry in accept + responses:
        normalised = _normalise_command(entry.command)
        if normalised in seen:
            raise _Invalid(f"{where}command {normalised!r} is listed more than once")
        seen.add(normalised)
    return TerminalCheck(prompt=prompt, accept=accept, responses=responses)


def _commands(where: str, key: str, raw: object) -> tuple[CommandOutput, ...]:
    if not isinstance(raw, list):
        raise _Invalid(f"{where}{key} must be a list of command/output tables")
    out = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise _Invalid(f"{where}{key} must be a list of command/output tables")
        command = _text(entry, "command", f"{where}{key} ")
        output = entry.get("output")
        if not isinstance(output, str):
            raise _Invalid(f"{where}{key} output for {command!r} must be a string")
        out.append(CommandOutput(command=command, output=output))
    return tuple(out)


def _normalise_command(s: str) -> str:
    # Same rule as checks.normalise_command (FR-22): only whitespace is ignored.
    return " ".join(s.split())


_markdown = MarkdownIt("commonmark", {"html": False})


def _image_srcs(tokens: list[Token]) -> list[str]:
    srcs = []
    for token in tokens:
        if token.type == "image":
            srcs.append(str(token.attrGet("src") or ""))
        if token.children:
            srcs.extend(_image_srcs(token.children))
    return srcs


def _images(folder: Path, steps: tuple[Step, ...]) -> tuple[str, ...]:
    names: set[str] = set()
    home = folder.resolve()
    for n, step in enumerate(steps, start=1):
        for text in (step.body, step.hint or ""):
            for src in _image_srcs(_markdown.parse(text)):
                file = folder / src
                if not src or file.resolve().parent != home or not file.is_file():
                    raise _Invalid(f"step {n}: image {src!r} is not a file in the lesson folder")
                if sniff_media_type(file.read_bytes()) is None:
                    raise _Invalid(f"step {n}: image {src!r} is not a PNG, JPEG, GIF or WebP")
                names.add(src)
    return tuple(sorted(names))
