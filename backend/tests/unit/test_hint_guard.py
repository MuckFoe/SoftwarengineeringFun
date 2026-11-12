"""Unit tests for the pure checks of app.hints.guard (plan: Solution guard 1-4; FR-9, FR-10)."""

import pytest

from app.hints.guard import candidates, code_lines, normalize, shape_ok, structurally_complete
from app.hints.service import normalize_note

ADD_SIG = "def add(a: int, b: int) -> int"


# --- normalize --------------------------------------------------------------


def test_normalize_drops_think_blocks():
    raw = "<think>\nThe answer is return a + b.\n</think>\nConsider the empty list."
    assert normalize(raw) == "Consider the empty list."


def test_normalize_drops_unclosed_think_and_orphan_close():
    assert normalize("<think>never closed, all reasoning") is None
    assert normalize("no opener</think>Look at the base case.") == "Look at the base case."


def test_normalize_strips_leading_hint_label():
    assert normalize("  Hint: Think about the base case.  ") == "Think about the base case."
    assert normalize("hint:Think about the base case.") == "Think about the base case."


def test_normalize_joins_prose_whitespace():
    assert normalize("Think   about\t the\n\n\nbase case.") == "Think about the\nbase case."


def test_normalize_keeps_one_code_line_intact():
    fenced = "Try reversing the string.\n```python\nfor  i in range(len(s)  -  1):\n```"
    out = normalize(fenced)
    assert out is not None
    assert "for  i in range(len(s)  -  1):" in out
    inline = "Try   `s[::-1]  ==  s`   here."
    assert normalize(inline) == "Try `s[::-1]  ==  s` here."


@pytest.mark.parametrize("raw", ["", "   ", "Hint:", "<think>x</think>  ", "a" * 601])
def test_normalize_rejects_out_of_range_length(raw):
    assert normalize(raw) is None


def test_normalize_accepts_bounds():
    assert normalize("a") == "a"
    assert normalize("a" * 600) == "a" * 600


# --- code_lines -------------------------------------------------------------


def test_code_lines_finds_fenced_lines():
    text = "Look at this.\n```python\nseen = set()\nfor x in xs:\n```\nThen think."
    assert code_lines(text) == ["seen = set()", "for x in xs:"]


def test_code_lines_finds_backtick_spans():
    assert code_lines("Use `len(s)` and `s[0]` to start.") == ["len(s)", "s[0]"]


def test_code_lines_finds_unmarked_code():
    text = "Consider sorting first.\nnums.sort()\nThen look at neighbours."
    assert code_lines(text) == ["nums.sort()"]


def test_code_lines_ignores_prose_and_lone_names_or_constants():
    text = "Consider the empty case.\nresult\n42\nWhat if both are negative?"
    assert code_lines(text) == []


def test_code_lines_finds_unmarked_one_line_def():
    assert code_lines("def add(a, b): return a + b") == ["def add(a, b): return a + b"]


# --- shape_ok (AC-7, FR-9) --------------------------------------------------


def test_ac7_keeps_three_sentences_and_one_code_line():
    text = (
        "Your loop stops one element early. Check the range bound. "
        "What is the last index you need?\n```python\nfor i in range(len(xs)):\n```"
    )
    assert shape_ok(text)


def test_ac7_rejects_more_than_one_code_line():
    assert not shape_ok("Try this.\n```python\nseen = set()\nfor x in xs:\n```")
    assert not shape_ok("Use `seen = set()` and then `seen.add(x)`.")


def test_ac7_names_in_backticks_are_not_code_lines():
    # A backticked name mentions code; only real code fragments count towards the one line.
    assert shape_ok("Add `a` and `b` with the addition operator.")
    assert shape_ok("Use `str.split` on `s`, then `sorted()` with one line: `words[::-1]`.")
    assert not shape_ok("Use `a` with `seen = set()` and then `seen.add(x)`.")


def test_ac7_rejects_more_than_four_sentences():
    text = "One idea. Two ideas. Three ideas. Four ideas. Five ideas."
    assert not shape_ok(text)
    assert shape_ok("One idea. Two ideas. Three ideas. Four ideas.")


@pytest.mark.parametrize(
    "plan",
    [
        "1. Sort\n2. Scan\n3. Return",
        "1) Sort\n2) Scan\n3) Return",
        "- Sort\n- Scan\n- Return",
        "* Sort\n* Scan\n* Return",
        "• Sort\n• Scan\n• Return",
        "Step 1 sort\nStep 2 scan\nStep 3 return",
    ],
)
def test_ac7_rejects_enumerated_plan(plan):
    assert not shape_ok(plan)


def test_ac7_allows_two_enumerated_lines():
    assert shape_ok("Two cases matter:\n- an empty list\n- a single element")


def test_ac7_decimals_are_not_sentence_breaks():
    assert shape_ok("The rate is 1.5 here. It doubles at 2.5 too. And 3.5 later.")


# --- structurally_complete (AC-8, FR-10) ------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "```python\ndef add(a, b): return a + b\n```",
        "Try `def add(a, b): return a + b`.",
        "def helper(x): return x",
        "Use `lambda a, b: a + b` here.",
        "```python\nadd = lambda a, b: a + b\n```",
        "Write `add = sum` and be done.",
        "```python\ndef add(a, b):\n```",
    ],
)
def test_ac8_structurally_complete_is_true(text):
    assert structurally_complete(text, "add")


@pytest.mark.parametrize(
    "text",
    [
        "What if the first list is empty?\n```python\nif not a:\n```",
        "Try `total = a + b` first.",
        "Think about the base case.",
    ],
)
def test_ac8_partial_line_is_not_structurally_complete(text):
    assert not structurally_complete(text, "add")


# --- candidates -------------------------------------------------------------


def test_candidates_expression_gives_all_three_forms():
    assert candidates(ADD_SIG, "a + b") == [
        "a + b",
        f"{ADD_SIG}:\n    a + b",
        f"{ADD_SIG}:\n    return a + b",
    ]


def test_candidates_accepts_signature_with_trailing_colon():
    assert candidates(ADD_SIG + ":", "a + b")[1] == f"{ADD_SIG}:\n    a + b"


def test_candidates_return_statement_drops_unparseable_forms():
    # (a) `return` outside a function and (c) not an expression are dropped.
    assert candidates(ADD_SIG, "return a + b") == [f"{ADD_SIG}:\n    return a + b"]


def test_candidates_full_def_keeps_only_standalone_form():
    line = "def add(a, b): return a + b"
    assert candidates(ADD_SIG, line) == [line, f"{ADD_SIG}:\n    {line}"]


def test_candidates_partial_line_yields_nothing():
    assert candidates(ADD_SIG, "if not a:") == []


# --- note normalization (AC-4, FR-5) -----------------------------------------


def test_ac4_normalize_note_keeps_the_first_line_stripped():
    assert normalize_note("  stuck on empty input  \nsecond line") == "stuck on empty input"
    assert normalize_note("first\r\nsecond") == "first"


def test_ac4_normalize_note_cuts_201_characters_to_200():
    assert normalize_note("x" * 201) == "x" * 200
    assert normalize_note("x" * 200) == "x" * 200


@pytest.mark.parametrize("raw", ["", "   ", "\nsecond line", None, 42, ["a"]])
def test_ac4_normalize_note_turns_an_empty_or_non_text_note_into_none(raw):
    assert normalize_note(raw) is None
