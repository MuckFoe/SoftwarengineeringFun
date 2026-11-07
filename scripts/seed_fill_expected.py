"""Fill `tests[].expected` from the reference: `python scripts/seed_fill_expected.py <dir> ...`.

Runs reference.py on every `tests[].args` twice in the runner; writes nothing for a directory
whose runs differ, error, time out, or whose reference fails the static check, and exits 1.
Needs Python 3.10+ (run with backend/.venv/bin/python).
"""

import json
import sys
from pathlib import Path

from seed_check import check_reference_source
from seed_runner import function_name_of, run_reference


def fill(directory: Path) -> list[str]:
    """Fill one directory. Returns problems (empty on success; file untouched if any)."""
    try:
        problem = json.loads((directory / "problem.json").read_text())
        code = (directory / "reference.py").read_text()
        fn = function_name_of(problem["signature"])
        cases = [t["args"] for t in problem["tests"]]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return [f"cannot read problem: {exc!r}"]
    static = check_reference_source(code)
    if static:
        return static
    runs = [run_reference(code, fn, cases), run_reference(code, fn, cases)]
    out = []
    for i, (r1, r2) in enumerate(zip(*runs, strict=True)):
        if r1["status"] != "ok" or r2["status"] != "ok":
            bad = r1 if r1["status"] != "ok" else r2
            out.append(f"tests[{i}] reference run {bad['status']}: {bad.get('error_message', '')}")
        elif r1["value"] != r2["value"]:
            out.append(f"tests[{i}] reference is not deterministic")
    if out:
        return out
    for test, result in zip(problem["tests"], runs[0], strict=True):
        test["expected"] = result["value"]
    (directory / "problem.json").write_text(dump(problem))
    return []


def dump(problem: dict) -> str:
    """The repo's seed format: 2-space indent, one test per line."""
    tests = problem["tests"]
    head = json.dumps(
        {k: v for k, v in problem.items() if k != "tests"}, indent=2, ensure_ascii=False
    )
    lines = [json.dumps(t, ensure_ascii=False).replace("{", "{ ", 1)[:-1] + " }" for t in tests]
    body = ",\n".join("    " + ln for ln in lines)
    return head[:-2] + ',\n  "tests": [\n' + body + "\n  ]\n}\n"


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: seed_fill_expected.py <dir> ...")
        return 2
    failed = 0
    for arg in argv:
        d = Path(arg)
        problems = fill(d)
        for line in problems:
            print(f"{d.name}: {line}")
        failed += bool(problems)
        if not problems:
            print(f"{d.name}: expected filled")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
