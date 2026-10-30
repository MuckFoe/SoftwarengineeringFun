"""Spec 006 task 3: judge quiz answers and terminal commands (AC-15, 16, 18-22)."""

import ast
from dataclasses import dataclass
from pathlib import Path

import app.learn
from app.learn.checks import (
    Accepted,
    KnownMistake,
    Unavailable,
    judge_choice,
    judge_command,
    judge_text,
    normalise_command,
    normalise_text,
)


@dataclass(frozen=True)
class Cmd:
    command: str
    output: str


@dataclass(frozen=True)
class Terminal:
    accept: tuple[Cmd, ...]
    responses: tuple[Cmd, ...] = ()


PS_OUTPUT = "CONTAINER ID   IMAGE   COMMAND"
LS_OUTPUT = "docker: 'ls' is not a docker command. Did you mean `docker container ls`?"
DOCKER_PS = Terminal(
    accept=(Cmd("docker ps", PS_OUTPUT),), responses=(Cmd("docker ls", LS_OUTPUT),)
)


def test_ac15_choice_passes_only_on_the_exact_set_of_correct_options():
    correct = (2, 4)  # B and D

    assert judge_choice(correct, [2, 4])
    assert judge_choice(correct, [4, 2])
    assert not judge_choice(correct, [2])
    assert not judge_choice(correct, [2, 3, 4])
    assert not judge_choice(correct, [])


def test_ac16_text_ignores_surrounding_whitespace_and_case_only():
    accept = ("container",)

    assert normalise_text("  Container ") == "container"
    assert judge_text(accept, "  Container ")
    assert judge_text(accept, "container")
    assert not judge_text(accept, "containers")
    assert not judge_text(accept, "")


def test_text_passes_on_any_accepted_answer():
    assert judge_text(("container", "a container"), "A Container")


def test_ac18_accepted_command_returns_the_lesson_output():
    assert judge_command(DOCKER_PS, "docker ps") == Accepted(PS_OUTPUT)


def test_accepted_command_returns_the_output_of_the_entry_it_matched():
    check = Terminal(accept=(Cmd("docker ps", "first"), Cmd("docker container ls", "second")))

    assert judge_command(check, "docker container ls") == Accepted("second")


def test_ac19_known_mistake_returns_its_output():
    assert judge_command(DOCKER_PS, "docker ls") == KnownMistake(LS_OUTPUT)


def test_ac20_anything_else_is_unavailable_named_by_its_first_word():
    assert judge_command(DOCKER_PS, "rm -rf /") == Unavailable("rm: not available in this exercise")
    assert judge_command(DOCKER_PS, "  docker   images ") == Unavailable(
        "docker: not available in this exercise"
    )


def test_ac21_only_whitespace_is_ignored_in_commands():
    check = Terminal(accept=(Cmd("docker run -p 8080:80 nginx", "started"),))

    assert normalise_command("  docker  run -p 8080:80   nginx ") == "docker run -p 8080:80 nginx"
    assert judge_command(check, "  docker  run -p 8080:80   nginx ") == Accepted("started")
    assert not isinstance(judge_command(check, "docker run -p 8080:80 NGINX"), Accepted)
    assert not isinstance(judge_command(check, "docker run nginx -p 8080:80"), Accepted)


def test_lesson_commands_are_normalised_too():
    check = Terminal(
        accept=(Cmd(" docker   ps ", PS_OUTPUT),), responses=(Cmd("docker  ls", LS_OUTPUT),)
    )

    assert judge_command(check, "docker ps") == Accepted(PS_OUTPUT)
    assert judge_command(check, "docker ls") == KnownMistake(LS_OUTPUT)


FORBIDDEN_MODULES = {"subprocess", "os", "pty", "shlex"}


def test_ac22_no_module_in_learn_imports_a_process_or_shell_module():
    package = Path(app.learn.__file__).parent
    sources = sorted(package.rglob("*.py"))
    assert any(p.name == "checks.py" for p in sources)

    found = []
    for path in sources:
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            found += [f"{path.name}: {n}" for n in names if n.split(".")[0] in FORBIDDEN_MODULES]

    assert found == []
