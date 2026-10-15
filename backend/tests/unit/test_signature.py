"""Unit tests for app.problems.signature (plan: Signatures and tests; FR-3, FR-4, FR-16)."""

import pytest

from app.problems.signature import (
    FieldError,
    Param,
    SignatureError,
    TestInput,
    parse_signature,
    starter_code,
    validate_tests,
    values_equal,
)

ADD = "def add(a: int, b: int) -> int"


# --- FR-3: parsing ---------------------------------------------------------


def test_fr3_parses_add_signature():
    sig = parse_signature(ADD)
    assert sig.name == "add"
    assert sig.params == [Param("a", "int"), Param("b", "int")]
    assert sig.return_type == "int"


def test_fr3_trailing_colon_is_accepted():
    assert parse_signature(ADD + ":") == parse_signature(ADD)


@pytest.mark.parametrize(
    "annotation",
    [
        "int",
        "float",
        "str",
        "bool",
        "list[int]",
        "dict[str, float]",
        "int | None",
        "list[dict[str, list[str] | None]]",
    ],
)
def test_fr3_allowed_annotations(annotation):
    sig = parse_signature(f"def f(x: {annotation}) -> {annotation}")
    assert sig.params[0].type == annotation
    assert sig.return_type == annotation


@pytest.mark.parametrize(
    "src",
    [
        "",
        "add(a, b)",
        "def add(a, b) -> int",  # missing param annotation
        "def add(a: int, b: int)",  # missing return annotation
        "def f(x: tuple[int]) -> int",
        "def f(x: dict[int, int]) -> int",
        "def f(x: list) -> int",
        "def f(x: set[int]) -> int",
        "def f(x: int = 1) -> int",
        "def f(*xs: int) -> int",
        "def f(**kw: int) -> int",
        "def f(*, x: int) -> int",
        "async def f(x: int) -> int",
        "def f(x: int) -> int:\n    return x",
        "def f(x: int) -> int: return x",
        "class F: pass",
    ],
)
def test_fr3_invalid_signatures_raise(src):
    with pytest.raises(SignatureError):
        parse_signature(src)


# --- FR-4: test validation -------------------------------------------------


def test_fr4_zero_tests_is_a_field_error_on_tests():
    errors = validate_tests(parse_signature(ADD), [])
    assert len(errors) == 1
    assert errors[0].field == "tests"
    assert errors[0].test_index is None
    assert errors[0].message


def test_fr4_three_args_for_two_params_names_that_test():
    tests = [TestInput(args=[2, 3], expected=5), TestInput(args=[1, 2, 3], expected=6)]
    errors = validate_tests(parse_signature(ADD), tests)
    assert len(errors) == 1
    assert isinstance(errors[0], FieldError)
    assert errors[0].field == "tests"
    assert errors[0].test_index == 1
    assert errors[0].message


def test_fr4_valid_tests_give_no_errors():
    sig = parse_signature("def f(xs: list[float], m: dict[str, int] | None) -> bool")
    tests = [
        TestInput(args=[[1.5, 2], {"a": 1}], expected=True),
        TestInput(args=[[], None], expected=False),
    ]
    assert validate_tests(sig, tests) == []


@pytest.mark.parametrize(
    "args, expected",
    [
        (["2", 3], 5),  # str for int
        ([True, 3], 5),  # bool is not int
        ([2.5, 3], 5),  # float for int
        ([2, 3], "5"),  # wrong expected type
        ([2, None], 5),  # None for non-optional
    ],
)
def test_fr4_type_mismatch_names_that_test(args, expected):
    errors = validate_tests(parse_signature(ADD), [TestInput(args=args, expected=expected)])
    assert [(e.field, e.test_index) for e in errors] == [("tests", 0)]


def test_fr4_int_is_accepted_for_float():
    sig = parse_signature("def f(x: float) -> float")
    assert validate_tests(sig, [TestInput(args=[2], expected=3)]) == []


def test_fr4_dict_keys_and_nested_values_are_checked():
    sig = parse_signature("def f(m: dict[str, list[int]]) -> int")
    bad = [TestInput(args=[{"a": [1, "x"]}], expected=1)]
    assert [e.test_index for e in validate_tests(sig, bad)] == [0]


# --- FR-16: starter code ---------------------------------------------------


def test_fr16_starter_code_is_signature_then_indented_pass():
    code = starter_code(parse_signature(ADD))
    assert code.splitlines() == [ADD + ":", "    pass"]


def test_fr16_starter_code_compiles():
    compile(starter_code(parse_signature(ADD)), "<starter>", "exec")


# --- values_equal (grading comparison) --------------------------------------


def test_values_equal_floats_within_relative_tolerance():
    assert values_equal(0.1 + 0.2, 0.3)
    assert not values_equal(1.0, 1.0001)


def test_values_equal_after_json_round_trip():
    assert values_equal((1, 2), [1, 2])  # tuple becomes list
    assert values_equal({"a": [1.0, None]}, {"a": [1, None]})
    assert not values_equal({"a": 1}, {"a": 1, "b": 2})
    assert not values_equal([1, 2], [2, 1])


def test_values_equal_bool_is_not_number():
    assert not values_equal(True, 1)
    assert not values_equal(0, False)
    assert values_equal(True, True)


def test_values_equal_unserialisable_is_not_equal():
    assert not values_equal({1, 2}, [1, 2])
