"""Checks: judge quiz answers and terminal commands (spec 006 plan, Checks).

Pure. Takes plain data shaped like `lesson_file`'s checks without importing it. A terminal
command is only ever compared against the lesson's text; nothing is run (FR-23, NFR-4).
"""

from collections.abc import Collection, Iterable
from dataclasses import dataclass
from typing import Protocol


class CommandOutput(Protocol):
    @property
    def command(self) -> str: ...
    @property
    def output(self) -> str: ...


class TerminalCheck(Protocol):
    @property
    def accept(self) -> Iterable[CommandOutput]: ...
    @property
    def responses(self) -> Iterable[CommandOutput]: ...


@dataclass(frozen=True)
class Accepted:
    output: str


@dataclass(frozen=True)
class KnownMistake:
    output: str


@dataclass(frozen=True)
class Unavailable:
    text: str


CommandResult = Accepted | KnownMistake | Unavailable


def normalise_command(s: str) -> str:
    # Only whitespace is ignored; case and word order count (FR-22).
    return " ".join(s.split())


def judge_command(check: TerminalCheck, submission: str) -> CommandResult:
    command = normalise_command(submission)
    for entry in check.accept:
        if normalise_command(entry.command) == command:
            return Accepted(entry.output)
    for entry in check.responses:
        if normalise_command(entry.command) == command:
            return KnownMistake(entry.output)
    first_word = command.split(" ", 1)[0]
    return Unavailable(f"{first_word}: not available in this exercise")


def normalise_text(s: str) -> str:
    return s.strip().casefold()


def judge_text(accept: Iterable[str], submission: str) -> bool:
    answer = normalise_text(submission)
    return any(normalise_text(a) == answer for a in accept)


def judge_choice(correct: Collection[int], selected: Collection[int]) -> bool:
    return set(selected) == set(correct)
