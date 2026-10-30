"""Spec 006 task 2: parse and validate one lesson file (AC-5; FR-4, 5, 16, 17, 19, 20)."""

import base64
from pathlib import Path

import pytest

from app.learn.lesson_file import (
    ChoiceCheck,
    CommandOutput,
    LessonError,
    TerminalCheck,
    TextCheck,
    parse_lesson,
    parse_topic,
)

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqGgAAAABJRU5ErkJggg=="
)
GIF = b"GIF87a\x01\x00\x01\x00\x00\x00\x00;"
WEBP = base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16

# The example lesson from plan.md, Lesson files.
PLAN_EXAMPLE = '''
title = "Basics"
summary = "Images vs containers, and the commands to run and inspect them."
minutes = 25

[[steps]]
kind = "explanation"
title = "Images and containers"
body = """
Markdown. Images: ![diagram](layers.png), a file in this lesson's folder.
"""
hint = "Optional Markdown."

[[steps]]
kind = "quiz"
title = "Which runs?"
body = "Which of these are running processes?"
[steps.check]
type = "choice"
options = ["An image", "A container", "A Dockerfile", "A container started with -d"]
correct = [2, 4]
multiple = true

[[steps]]
kind = "quiz"
title = "Name it"
body = "A running instance of an image is called a …"
[steps.check]
type = "text"
accept = ["container"]

[[steps]]
kind = "terminal"
title = "List containers"
body = "Show the running containers."
[steps.check]
type = "terminal"
prompt = "$ "
[[steps.check.accept]]
command = "docker ps"
output = """CONTAINER ID   IMAGE   ..."""
[[steps.check.responses]]
command = "docker ls"
output = "docker: 'ls' is not a docker command. Did you mean `docker container ls`?"
'''

HEADER = 'title = "T"\nsummary = "S"\nminutes = 5\n'


def write_lesson(tmp_path: Path, text: str, files: dict[str, bytes] | None = None) -> Path:
    folder = tmp_path / "01-topic" / "01-lesson"
    folder.mkdir(parents=True)
    (folder / "lesson.toml").write_text(text, encoding="utf-8")
    for name, data in (files or {}).items():
        (folder / name).write_bytes(data)
    return folder


def step(kind: str, extra: str = "", body: str = "b") -> str:
    return f'\n[[steps]]\nkind = "{kind}"\ntitle = "x"\nbody = "{body}"\n{extra}'


CHOICE = '[steps.check]\ntype = "choice"\n'
TEXT = '[steps.check]\ntype = "text"\n'
TERMINAL = '[steps.check]\ntype = "terminal"\n'


def test_plan_example_parses_into_expected_structure(tmp_path: Path) -> None:
    folder = write_lesson(tmp_path, PLAN_EXAMPLE, {"layers.png": PNG})

    lesson = parse_lesson(folder)

    assert lesson.title == "Basics"
    assert lesson.summary == "Images vs containers, and the commands to run and inspect them."
    assert lesson.minutes == 25
    assert lesson.images == ("layers.png",)
    assert [s.kind for s in lesson.steps] == ["explanation", "quiz", "quiz", "terminal"]

    explanation, choice, text, terminal = lesson.steps
    assert explanation.title == "Images and containers"
    assert "![diagram](layers.png)" in explanation.body
    assert explanation.hint == "Optional Markdown."
    assert explanation.check is None

    assert choice.hint is None
    assert choice.check == ChoiceCheck(
        options=("An image", "A container", "A Dockerfile", "A container started with -d"),
        correct=(2, 4),
        multiple=True,
    )
    assert text.check == TextCheck(accept=("container",))
    assert terminal.check == TerminalCheck(
        prompt="$ ",
        accept=(CommandOutput("docker ps", "CONTAINER ID   IMAGE   ..."),),
        responses=(
            CommandOutput(
                "docker ls",
                "docker: 'ls' is not a docker command. Did you mean `docker container ls`?",
            ),
        ),
    )


def test_explanation_may_carry_a_check_and_terminal_prompt_defaults(tmp_path: Path) -> None:
    text = HEADER + step(
        "explanation", TERMINAL + '[[steps.check.accept]]\ncommand = "ls"\noutput = ""\n'
    )
    lesson = parse_lesson(write_lesson(tmp_path, text))

    check = lesson.steps[0].check
    assert isinstance(check, TerminalCheck)
    assert check.prompt == "$ "
    assert check.responses == ()


@pytest.mark.parametrize("name,data", [("a.gif", GIF), ("a.webp", WEBP), ("a.jpg", JPEG)])
def test_images_in_body_or_hint_of_every_supported_type_are_collected(
    tmp_path: Path, name: str, data: bytes
) -> None:
    text = HEADER + step("explanation", f'hint = "see ![x]({name})"\n', body="![y](b.png)")
    lesson = parse_lesson(write_lesson(tmp_path, text, {name: data, "b.png": PNG}))

    assert lesson.images == tuple(sorted({name, "b.png"}))


def test_topic_parses_title(tmp_path: Path) -> None:
    (tmp_path / "topic.toml").write_text('title = "Docker"\n', encoding="utf-8")

    assert parse_topic(tmp_path).title == "Docker"


def choice(options: str, correct: str | None, multiple: str | None = "false") -> str:
    """A quiz step with a choice check; None leaves the key out."""
    extra = CHOICE + f"options = {options}\n"
    if correct is not None:
        extra += f"correct = {correct}\n"
    if multiple is not None:
        extra += f"multiple = {multiple}\n"
    return HEADER + step("quiz", extra)


def terminal(accept: str) -> str:
    """A terminal step whose check body is `accept` (TOML)."""
    return HEADER + step("terminal", TERMINAL + accept)


def lesson(header: str) -> str:
    return header + step("explanation")


ACCEPT = "[[steps.check.accept]]\n"
GOOD_CHOICE = CHOICE + 'options = ["a", "b"]\ncorrect = [1]\nmultiple = false\n'
GOOD_TERMINAL = TERMINAL + '[[steps.check.accept]]\ncommand = "docker ps"\noutput = "out"\n'

INVALID: list[tuple[str, str, str]] = [
    # (case id, lesson text, words the problem must contain)
    ("missing title", lesson('summary = "S"\nminutes = 5\n'), "title"),
    ("missing summary", lesson('title = "T"\nminutes = 5\n'), "summary"),
    ("missing minutes", lesson('title = "T"\nsummary = "S"\n'), "minutes"),
    ("title wrong type", lesson('title = 3\nsummary = "S"\nminutes = 5\n'), "title"),
    ("minutes wrong type", lesson('title = "T"\nsummary = "S"\nminutes = "5"\n'), "minutes"),
    ("minutes bool", lesson('title = "T"\nsummary = "S"\nminutes = true\n'), "minutes"),
    ("minutes zero", lesson('title = "T"\nsummary = "S"\nminutes = 0\n'), "minutes"),
    ("no steps", HEADER, "steps"),
    ("empty steps", HEADER + "steps = []\n", "steps"),
    ("step missing body", HEADER + '\n[[steps]]\nkind = "explanation"\ntitle = "x"\n', "body"),
    ("step hint wrong type", HEADER + step("explanation", "hint = 1\n"), "hint"),
    ("unknown kind", HEADER + step("video"), "kind"),
    ("unknown check type", HEADER + step("quiz", '[steps.check]\ntype = "essay"\n'), "type"),
    ("quiz without check", HEADER + step("quiz"), "check"),
    ("quiz with terminal check", HEADER + step("quiz", GOOD_TERMINAL), "check"),
    ("terminal without check", HEADER + step("terminal"), "check"),
    ("terminal with choice check", HEADER + step("terminal", GOOD_CHOICE), "check"),
    ("choice one option", choice('["a"]', "[1]"), "options"),
    ("choice no correct", choice('["a", "b"]', "[]"), "correct"),
    ("choice correct missing", choice('["a", "b"]', None), "correct"),
    ("choice out of range", choice('["a", "b"]', "[3]"), "range"),
    ("choice zero", choice('["a", "b"]', "[0]"), "range"),
    ("choice duplicate", choice('["a", "b", "c"]', "[1, 1]", "true"), "duplicate"),
    ("choice several but single", choice('["a", "b"]', "[1, 2]"), "multiple"),
    ("choice multiple missing", choice('["a", "b"]', "[1]", None), "multiple"),
    ("text blank accept", HEADER + step("quiz", TEXT + 'accept = ["  "]\n'), "accept"),
    ("text no accept", HEADER + step("quiz", TEXT + "accept = []\n"), "accept"),
    ("terminal no accept", terminal('prompt = "$ "\n'), "accept"),
    ("terminal blank command", terminal(ACCEPT + 'command = " "\noutput = ""\n'), "command"),
    ("terminal output missing", terminal(ACCEPT + 'command = "ls"\n'), "output"),
    (
        "command accepted twice",
        HEADER
        + step(
            "terminal",
            GOOD_TERMINAL + '[[steps.check.accept]]\ncommand = "docker   ps "\noutput = ""\n',
        ),
        "docker ps",
    ),
    (
        "command in accept and responses",
        HEADER
        + step(
            "terminal",
            GOOD_TERMINAL + '[[steps.check.responses]]\ncommand = " docker ps"\noutput = ""\n',
        ),
        "docker ps",
    ),
    ("missing image", HEADER + step("explanation", body="![x](nope.png)"), "nope.png"),
    ("image outside folder", HEADER + step("explanation", body="![x](../a.png)"), "../a.png"),
    (
        "image is a url",
        HEADER + step("explanation", body="![x](https://e.com/a.png)"),
        "https://e.com/a.png",
    ),
    ("missing image in hint", HEADER + step("explanation", 'hint = "![x](h.png)"\n'), "h.png"),
    ("bad toml", "title = \n", "TOML"),
]


@pytest.mark.parametrize(("text", "words"), [c[1:] for c in INVALID], ids=[c[0] for c in INVALID])
def test_ac5_each_invalid_lesson_is_refused_naming_file_and_problem(
    tmp_path: Path, text: str, words: str
) -> None:
    folder = write_lesson(tmp_path, text)

    with pytest.raises(LessonError) as raised:
        parse_lesson(folder)

    assert raised.value.path == folder / "lesson.toml"
    assert words in raised.value.problem
    assert str(raised.value) == f"{folder / 'lesson.toml'}: {raised.value.problem}"


def test_ac5_quiz_without_correct_answer_names_file_and_missing_answer(tmp_path: Path) -> None:
    folder = write_lesson(
        tmp_path,
        HEADER
        + step("explanation")
        + step("quiz", CHOICE + 'options = ["a", "b"]\ncorrect = []\nmultiple = false\n'),
    )

    with pytest.raises(LessonError) as raised:
        parse_lesson(folder)

    assert str(folder / "lesson.toml") in str(raised.value)
    assert "step 2" in raised.value.problem
    assert "correct" in raised.value.problem


def test_image_with_wrong_type_is_refused(tmp_path: Path) -> None:
    folder = write_lesson(
        tmp_path,
        HEADER + step("explanation", body="![x](a.png)"),
        {"a.png": b'<svg xmlns="http://www.w3.org/2000/svg"/>'},
    )

    with pytest.raises(LessonError) as raised:
        parse_lesson(folder)

    assert "a.png" in raised.value.problem
    assert "PNG" in raised.value.problem


def test_missing_lesson_file_is_refused(tmp_path: Path) -> None:
    with pytest.raises(LessonError) as raised:
        parse_lesson(tmp_path)

    assert raised.value.path == tmp_path / "lesson.toml"


def test_topic_folder_without_topic_toml_is_refused(tmp_path: Path) -> None:
    with pytest.raises(LessonError) as raised:
        parse_topic(tmp_path)

    assert raised.value.path == tmp_path / "topic.toml"
    assert "topic.toml" in raised.value.problem


@pytest.mark.parametrize("text", ['summary = "no title"\n', "title = 1\n", 'title = " "\n'])
def test_topic_toml_without_title_is_refused(tmp_path: Path, text: str) -> None:
    (tmp_path / "topic.toml").write_text(text, encoding="utf-8")

    with pytest.raises(LessonError) as raised:
        parse_topic(tmp_path)

    assert raised.value.path == tmp_path / "topic.toml"
    assert "title" in raised.value.problem
