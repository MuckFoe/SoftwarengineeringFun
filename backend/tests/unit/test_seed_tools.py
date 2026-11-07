"""Spec 018 tasks 2 and 3: seed_check.py and seed_fill_expected.py, on fixture directories.

References run through the real sandbox harness (no mocks).
"""

import copy
import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import seed_check  # noqa: E402
import seed_fill_expected  # noqa: E402

DESCRIPTION = (
    "## Task\n\nAdd.\n\n## Input\n\n- `a`\n\n## Output\n\nSum.\n\n"
    "## Example\n\n```python\nadd(1, 2)\n```\n\n## Constraints\n\n- small\n"
)
GOOD = {
    "title": "Add Pair",
    "description": DESCRIPTION,
    "signature": "def add(a: int, b: int) -> int",
    "difficulty": "easy",
    "category": "math-bits",
    "tests": [
        {"args": [1, 2], "expected": 3},
        {"args": [0, 0], "expected": 0},
        {"args": [-1, 1], "expected": 0},
        {"args": [5, 7], "expected": 12},
        {"args": [100, 1], "expected": 101},
    ],
}
REFERENCE = "def add(a, b):\n    return a + b\n"


def make(root: Path, name: str, problem: dict, reference: str = REFERENCE) -> Path:
    d = root / name
    d.mkdir()
    (d / "problem.json").write_text(json.dumps(problem))
    (d / "reference.py").write_text(reference)
    return d


def violations(dirs: list[Path], **kw) -> list[str]:
    return seed_check.check_seed(dirs, denylist=kw.pop("denylist", set()), **kw)


def test_good_fixture_passes(tmp_path):
    assert violations([make(tmp_path, "a", GOOD)]) == []


@pytest.mark.parametrize(
    "mutate, needle",
    [
        (lambda p: p.pop("title"), "title"),
        (lambda p: p.pop("signature"), "signature"),
        (lambda p: p.pop("difficulty"), "difficulty"),
        (lambda p: p.pop("category"), "category"),
        (lambda p: p.update(category="nope"), "category"),
        (
            lambda p: p.update(description=p["description"].replace("## Example", "## Eg")),
            "## Example",
        ),
        (lambda p: p.update(description=p["description"].replace("## Task", "## T")), "## Task"),
        (lambda p: p.update(tests=p["tests"][:4]), "at least 5"),
    ],
)
def test_missing_field_is_reported(tmp_path, mutate, needle):
    problem = copy.deepcopy(GOOD)
    mutate(problem)
    found = violations([make(tmp_path, "a", problem)])
    assert any(needle in line for line in found), found
    assert seed_check.main([str(tmp_path / "a")]) == 1


def test_duplicate_titles_case_insensitive(tmp_path):
    other = {**GOOD, "title": "ADD pair"}
    found = violations([make(tmp_path, "a", GOOD), make(tmp_path, "b", other)])
    assert any("duplicates" in line for line in found), found


def test_denylisted_title_fails(tmp_path):
    found = violations([make(tmp_path, "a", {**GOOD, "title": "Two Sum"})], denylist={"two sum"})
    assert any("known-titles" in line for line in found), found


def test_known_titles_file_is_seeded():
    assert "two sum" in seed_check.known_titles()


def test_wrong_stored_expected_fails(tmp_path):
    problem = copy.deepcopy(GOOD)
    problem["tests"][0]["expected"] = 99
    found = violations([make(tmp_path, "a", problem)])
    assert any("tests[0]" in line and "99" in line for line in found), found


def test_missing_function_fails(tmp_path):
    found = violations([make(tmp_path, "a", GOOD, "def other(a, b):\n    return 0\n")])
    assert any("not defined" in line for line in found), found


@pytest.mark.parametrize(
    "header",
    ["import random", "import time", "import datetime", "import socket", "import numpy"],
)
def test_nondeterministic_or_non_stdlib_reference_fails(tmp_path, header):
    found = violations([make(tmp_path, "a", GOOD, header + "\n" + REFERENCE)])
    assert any("reference.py imports" in line for line in found), found


def test_reference_over_the_run_limit_fails_naming_problem(tmp_path):
    slow = "def add(a, b):\n    while True:\n        pass\n"
    found = violations([make(tmp_path, "slow-one", GOOD, slow)])
    assert any(line.startswith("slow-one:") and "timeout" in line for line in found), found


def test_expect_total_catalogue_checks(tmp_path):
    found = violations([make(tmp_path, "a", GOOD)], expect_total=True)
    assert any("expected 150" in line for line in found)
    assert any("50 easy" in line for line in found)
    assert any("legacy" in line for line in found)
    assert any("math-bits/easy has 1" in line for line in found)
    assert violations([make(tmp_path, "b", {**GOOD, "title": "Other"})]) == []  # fast mode


def test_fill_writes_expected_and_passes_check(tmp_path):
    problem = copy.deepcopy(GOOD)
    for t in problem["tests"]:
        del t["expected"]
    d = make(tmp_path, "a", problem)
    assert seed_fill_expected.main([str(d)]) == 0
    filled = json.loads((d / "problem.json").read_text())
    assert [t["expected"] for t in filled["tests"]] == [3, 0, 0, 12, 101]
    assert violations([d]) == []


def test_fill_refuses_nondeterministic_reference(tmp_path):
    problem = copy.deepcopy(GOOD)
    for t in problem["tests"]:
        del t["expected"]
    # a per-process-varying reference: the id of a fresh object differs between runs
    varying = "def add(a, b):\n    return hash('x') + a\n"
    d2 = make(tmp_path, "bad", problem, varying)
    before = (d2 / "problem.json").read_text()
    assert seed_fill_expected.main([str(d2)]) == 1
    assert (d2 / "problem.json").read_text() == before


def test_fill_refuses_banned_import_and_writes_nothing(tmp_path):
    problem = copy.deepcopy(GOOD)
    d = make(tmp_path, "a", problem, "import random\n" + REFERENCE)
    before = (d / "problem.json").read_text()
    assert seed_fill_expected.main([str(d)]) == 1
    assert (d / "problem.json").read_text() == before
