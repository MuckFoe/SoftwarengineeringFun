"""Spec 020 task 4: the hint prompt builder (FR-9, FR-11, FR-12, FR-13, NFR Test secrecy)."""

import dataclasses

import pytest

from app.hints.prompt import (
    CODE_CAP,
    DESCRIPTION_CAP,
    ERROR_CAP,
    SYSTEM_MESSAGE,
    HintContext,
    RunOutcome,
    build_messages,
)


def _ctx(**overrides: object) -> HintContext:
    base: dict[str, object] = {
        "title": "Two Sum Zebra",
        "description": "Return indices of the two numbers that add up to target. DESCQUAIL",
        "signature": "def two_sum(nums: list[int], target: int) -> list[int]:",
        "code": "def two_sum(nums, target):\n    return CODEOTTER",
        "latest_run": [
            RunOutcome(position=1, outcome="passed", error_message=None),
            RunOutcome(position=2, outcome="error", error_message="NameError: CODEOTTER"),
            RunOutcome(position=3, outcome="wrong_answer", error_message=None),
        ],
        "earlier_hints": ["Think about a dictionary HINTONE.", "Store each value's index HINTTWO."],
        "note": "we are stuck NOTEHERON",
    }
    base.update(overrides)
    return HintContext(**base)  # type: ignore[arg-type]


def _user(ctx: HintContext) -> str:
    messages = build_messages(ctx)
    return messages[1]["content"]


def test_messages_are_one_fixed_system_message_and_one_user_message() -> None:
    messages = build_messages(_ctx())
    assert [m["role"] for m in messages] == ["system", "user"]
    assert messages[0]["content"] == SYSTEM_MESSAGE
    assert build_messages(_ctx(code="other"))[0]["content"] == SYSTEM_MESSAGE
    assert all(set(m) == {"role", "content"} for m in messages)


def test_ac10_hint_context_holds_only_the_fr12_inputs() -> None:
    names = {f.name for f in dataclasses.fields(HintContext)}
    assert names == {
        "title",
        "description",
        "signature",
        "code",
        "latest_run",
        "earlier_hints",
        "note",
    }
    for forbidden in ("name", "user", "username", "email", "chat", "tests", "account"):
        assert forbidden not in names, forbidden
    assert {f.name for f in dataclasses.fields(RunOutcome)} == {
        "position",
        "outcome",
        "error_message",
    }


def test_ac10_user_message_carries_every_context_field() -> None:
    ctx = _ctx()
    user = _user(ctx)
    for value in (ctx.title, ctx.description, ctx.signature, ctx.code, ctx.note):
        assert value in user
    assert "NameError: CODEOTTER" in user
    for word in ("passed", "error", "wrong_answer"):
        assert word in user
    for hint in ctx.earlier_hints:
        assert hint in user
    for label in ("Problem", "Current code", "Latest run", "Earlier hints", "Note"):
        assert label in user


def _scaffold(ctx: HintContext) -> str:
    """The user message with every context value removed: what the builder adds itself."""
    user = _user(ctx)
    assert ctx.latest_run is not None
    values = [ctx.title, ctx.description, ctx.signature, ctx.code, ctx.note or ""]
    values += ctx.earlier_hints
    values += [r.error_message for r in ctx.latest_run if r.error_message]
    for value in sorted(values, key=len, reverse=True):
        user = user.replace(value, "")
    return user


def test_ac10_nothing_but_the_context_reaches_the_model() -> None:
    """Two contexts of the same shape differ only in their values: the rest is fixed text."""
    a = _ctx()
    b = _ctx(
        title="TITLEB",
        description="DESCB",
        signature="SIGB",
        code="CODEB",
        latest_run=[
            RunOutcome(position=1, outcome="passed", error_message=None),
            RunOutcome(position=2, outcome="error", error_message="ERRB"),
            RunOutcome(position=3, outcome="wrong_answer", error_message=None),
        ],
        earlier_hints=["HINTB1", "HINTB2"],
        note="NOTEB",
    )
    assert _scaffold(a) == _scaffold(b)
    combined = "".join(m["content"] for m in build_messages(a)).lower()
    for leak in ("@", "username", "email", "chat", "expected", "args"):
        assert leak not in _scaffold(a).lower(), leak
    assert "@" not in combined


def test_ac9_no_test_data_and_instruction_to_ignore_embedded_instructions() -> None:
    # RunOutcome cannot carry args or expected values: only position, outcome, error.
    user = _user(_ctx())
    assert "expected" not in user.lower()
    system = SYSTEM_MESSAGE.lower()
    assert "data" in system
    assert "ignore" in system
    for where in ("code", "note", "error"):
        assert where in system


def test_fr9_system_message_bounds_the_hint_shape() -> None:
    system = SYSTEM_MESSAGE.lower()
    assert "one very small next step" in system
    assert "2 sentences" in system
    assert "one small code fragment in backticks" in system
    # FR-10: the model is told no code line may solve the problem, not even a one-liner.
    assert "never give code that solves the problem" in system
    assert "one-liner" in system
    assert "never a `return` statement" in system
    assert "whole function" in system
    assert "numbered" in system


def test_ac11_earlier_hints_are_numbered_with_more_specific_instruction() -> None:
    user = _user(_ctx())
    assert "Hint 1: Think about a dictionary HINTONE." in user
    assert "Hint 2: Store each value's index HINTTWO." in user
    assert user.index("HINTONE") < user.index("HINTTWO")
    system = SYSTEM_MESSAGE.lower()
    assert "one small step beyond the last one" in system
    assert "do not repeat" in system


@pytest.mark.parametrize(("earlier", "level"), [(0, 1), (1, 2), (2, 3), (3, 4), (9, 4)])
def test_fr13_the_hint_level_rises_with_each_hint_on_the_problem(earlier: int, level: int) -> None:
    # The first hint is the vaguest; each further hint on the problem is a little more concrete.
    user = _user(_ctx(earlier_hints=[f"hint {i}" for i in range(earlier)]))
    assert user.rstrip().endswith(f"## Hint level\n{level}")


def test_fr13_the_levels_go_from_a_vague_nudge_to_one_small_fragment() -> None:
    system = SYSTEM_MESSAGE.lower()
    level_1 = system[system.index("level 1:") : system.index("level 2:")]
    assert "vague nudge" in level_1 and "give no code" in level_1
    assert "no function or method names and no code" in system[system.index("level 2:") :]
    assert "one small code" in system[system.index("level 4 and up:") :]


def test_no_earlier_hints_says_so() -> None:
    user = _user(_ctx(earlier_hints=[]))
    assert "Earlier hints" in user
    assert "Hint 1:" not in user
    assert "none" in user.split("Earlier hints", 1)[1].lower()


def test_never_run_when_latest_run_is_none() -> None:
    user = _user(_ctx(latest_run=None))
    assert "never run" in user
    assert "passed" not in user


def test_run_outcomes_are_listed_by_test_number() -> None:
    user = _user(_ctx())
    assert "Test 1: passed" in user
    assert "Test 2: error" in user
    assert "Test 3: wrong_answer" in user


def test_empty_or_missing_note_leaves_the_note_section_out() -> None:
    for note in (None, ""):
        user = _user(_ctx(note=note))
        assert "Note" not in user


def test_overlong_description_code_and_errors_are_cut_to_their_caps() -> None:
    assert (DESCRIPTION_CAP, CODE_CAP, ERROR_CAP) == (4000, 6000, 300)
    description = "d" * DESCRIPTION_CAP + "DESCTAIL"
    code = "c" * CODE_CAP + "CODETAIL"
    error = "e" * ERROR_CAP + "ERRTAIL"
    ctx = _ctx(
        description=description,
        code=code,
        latest_run=[RunOutcome(position=1, outcome="error", error_message=error)],
    )
    user = _user(ctx)
    assert "d" * DESCRIPTION_CAP in user and "DESCTAIL" not in user
    assert "c" * CODE_CAP in user and "CODETAIL" not in user
    assert "e" * ERROR_CAP in user and "ERRTAIL" not in user
    assert "d" * (DESCRIPTION_CAP + 1) not in user
    assert "c" * (CODE_CAP + 1) not in user
    assert "e" * (ERROR_CAP + 1) not in user


def test_text_at_the_cap_is_kept_whole() -> None:
    user = _user(_ctx(description="d" * DESCRIPTION_CAP, code="c" * CODE_CAP))
    assert "d" * DESCRIPTION_CAP in user
    assert "c" * CODE_CAP in user
    assert "cut" not in user.lower()
