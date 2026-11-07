"""Validate seed problems: `python scripts/seed_check.py [--expect-total] [dir ...]`.

With no dirs, checks every directory under seed/problems. Without --expect-total only
per-problem checks run (fast mode for authoring slices); --expect-total adds the catalogue
checks (150 problems, 50/50/50 difficulty, 3-6 per category x difficulty, legacy keys).
Exits 1 and lists violations. Needs Python 3.10+ (run with backend/.venv/bin/python).
"""

import ast
import json
from concurrent.futures import ThreadPoolExecutor
import sys
from collections import Counter
from pathlib import Path

from seed_runner import SEED_DIR, function_name_of, run_reference

CATEGORIES = (
    "arrays",
    "strings",
    "hash-maps-sets",
    "two-pointers-windows",
    "stacks-queues",
    "sorting-searching",
    "recursion-backtracking",
    "dynamic-programming",
    "graphs-trees",
    "math-bits",
    "greedy-intervals",
)
DIFFICULTIES = ("easy", "medium", "hard")
SECTIONS = ("## Task", "## Input", "## Output", "## Example", "## Constraints")
LEGACY_KEYS = [
    "01-sum-two",
    "02-reverse-words",
    "03-count-vowels",
    "04-max-of-three",
    "05-is-palindrome",
    "06-unique-elements",
    "07-word-frequency",
    "08-flatten-pairs",
    "09-average-or-none",
    "10-shift-letters",
    "11-pair-sum-indices",
    "12-valid-brackets",
    "13-kth-smallest",
    "14-climb-steps",
    "15-insert-position",
    "16-digital-root",
    "17-max-profit",
    "18-common-elements",
    "19-merge-ranges",
    "20-count-set-bits",
]
# Nondeterminism sources (randomness, clock, network, environment) a reference may not import.
BANNED_MODULES = {
    "random", "secrets", "uuid", "time", "datetime", "calendar", "socket", "ssl", "select",
    "selectors", "urllib", "http", "ftplib", "smtplib", "xmlrpc", "asyncio", "os", "subprocess",
    "multiprocessing", "threading", "tempfile", "shutil", "ctypes", "sched", "timeit",
}  # fmt: skip
BANNED_CALLS = {"open", "input", "__import__", "eval", "exec", "compile"}
MIN_TESTS = 5
WORKERS = 8
MAX_PROBLEM_BYTES = 150_000  # problem.json is stored in the database and shipped in the image
KNOWN_TITLES = SEED_DIR.parent / "known-titles.txt"


def known_titles(path: Path = KNOWN_TITLES) -> set[str]:
    if not path.exists():
        return set()
    lines = (ln.strip() for ln in path.read_text().splitlines())
    return {ln.lower() for ln in lines if ln and not ln.startswith("#")}


def check_reference_source(code: str) -> list[str]:
    """Static NFR-3 / rule 6 checks: stdlib-only imports, no randomness, clock or network."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return [f"reference.py does not parse: {exc}"]
    out = []
    stdlib = sys.stdlib_module_names
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""] if node.level == 0 else ["."]
        for name in names:
            top = name.split(".")[0]
            if top not in stdlib:
                out.append(f"reference.py imports non-standard-library module {name!r}")
            elif top in BANNED_MODULES:
                out.append(f"reference.py imports {name!r} (randomness, clock, network or I/O)")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in BANNED_CALLS:
                out.append(f"reference.py calls {node.func.id}()")
    return out


def _defines(code: str, name: str) -> bool:
    return any(isinstance(n, ast.FunctionDef) and n.name == name for n in ast.walk(ast.parse(code)))


def check_problem(directory: Path, denylist: set[str]) -> tuple[dict | None, list[str]]:
    """Per-problem checks. Returns (parsed problem or None, violations)."""
    pj = directory / "problem.json"
    ref = directory / "reference.py"
    if not pj.is_file():
        return None, ["problem.json is missing"]
    try:
        p = json.loads(pj.read_text())
    except ValueError as exc:
        return None, [f"problem.json is not valid JSON: {exc}"]
    if not isinstance(p, dict):
        return None, ["problem.json is not an object"]
    v: list[str] = []
    size = pj.stat().st_size
    if size > MAX_PROBLEM_BYTES:
        v.append(f"problem.json is {size} bytes, over the {MAX_PROBLEM_BYTES} byte cap")
    title = p.get("title")
    if not isinstance(title, str) or not title.strip():
        v.append("title is missing")
    elif title.strip().lower() in denylist:
        v.append(f"title {title!r} is on seed/known-titles.txt")
    desc = p.get("description")
    if not isinstance(desc, str) or not desc.strip():
        v.append("description is missing")
    else:
        v += [f"description lacks the section {s!r}" for s in SECTIONS if s not in desc]
    if p.get("difficulty") not in DIFFICULTIES:
        v.append(f"difficulty {p.get('difficulty')!r} is missing or not one of {DIFFICULTIES}")
    if p.get("category") not in CATEGORIES:
        v.append(f"category {p.get('category')!r} is missing or not a known category id")
    fn = None
    sig = p.get("signature")
    if not isinstance(sig, str) or not sig.strip():
        v.append("signature is missing")
    else:
        try:
            fn = function_name_of(sig)
        except ValueError as exc:
            v.append(str(exc))
    tests = p.get("tests")
    if not isinstance(tests, list) or len(tests) < MIN_TESTS:
        v.append(
            f"needs at least {MIN_TESTS} tests, has {len(tests) if isinstance(tests, list) else 0}"
        )
        tests = [t for t in tests if isinstance(t, dict)] if isinstance(tests, list) else []
    for i, t in enumerate(tests):
        if not isinstance(t, dict) or not isinstance(t.get("args"), list):
            v.append(f"tests[{i}] has no args list")
        elif "expected" not in t:
            v.append(f"tests[{i}] has no expected (run seed_fill_expected.py)")
    if not ref.is_file():
        return p, [*v, "reference.py is missing"]
    code = ref.read_text()
    static = check_reference_source(code)
    v += static
    defined = bool(fn) and not static and _defines(code, fn)
    if fn and not static and not defined:
        v.append(f"function {fn!r} from the signature is not defined in reference.py")
    ok_tests = [t for t in tests if isinstance(t, dict) and isinstance(t.get("args"), list)]
    if defined and ok_tests:
        cases = [t["args"] for t in ok_tests]
        runs = [run_reference(code, fn, cases), run_reference(code, fn, cases)]
        for i, (t, r1, r2) in enumerate(zip(ok_tests, *runs, strict=True)):
            for r in (r1, r2):
                if r["status"] != "ok":
                    detail = r.get("error_message") or ""
                    v.append(f"tests[{i}] reference run {r['status']} (limits): {detail}".strip())
                    break
            else:
                if r1["value"] != r2["value"]:
                    v.append(f"tests[{i}] reference is not deterministic")
                elif "expected" in t and r1["value"] != t["expected"]:
                    v.append(
                        f"tests[{i}] expected {t['expected']!r}, reference gives {r1['value']!r}"
                    )
    return p, v


def check_seed(
    dirs: list[Path], expect_total: bool = False, denylist: set[str] | None = None
) -> list[str]:
    """All violations over `dirs`, each prefixed with the directory name."""
    denylist = known_titles() if denylist is None else denylist
    out: list[str] = []
    problems: dict[str, dict] = {}
    # Each problem's reference runs in its own subprocess, so the checks overlap safely.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda d: check_problem(d, denylist), dirs))
    for d, (p, v) in zip(dirs, results, strict=True):
        out += [f"{d.name}: {x}" for x in v]
        if p is not None:
            problems[d.name] = p
    seen: dict[str, str] = {}
    for key, p in problems.items():
        t = p.get("title")
        if isinstance(t, str) and t.strip():
            first = seen.setdefault(t.strip().lower(), key)
            if first != key:
                out.append(f"{key}: title {t!r} duplicates the title of {first}")
    if expect_total:
        keys = {d.name for d in dirs}
        if len(dirs) != 150:
            out.append(f"catalogue: expected 150 problems, found {len(dirs)}")
        missing = [k for k in LEGACY_KEYS if k not in keys]
        if missing:
            out.append(f"catalogue: legacy directories missing or renamed: {', '.join(missing)}")
        by_diff = Counter(p.get("difficulty") for p in problems.values())
        for dif in DIFFICULTIES:
            if by_diff[dif] != 50:
                out.append(f"catalogue: expected 50 {dif} problems, found {by_diff[dif]}")
        cells = Counter((p.get("category"), p.get("difficulty")) for p in problems.values())
        for cat in CATEGORIES:
            for dif in DIFFICULTIES:
                if not 3 <= cells[(cat, dif)] <= 6:
                    out.append(f"catalogue: {cat}/{dif} has {cells[(cat, dif)]} problems, need 3-6")
    return out


def main(argv: list[str]) -> int:
    expect_total = "--expect-total" in argv
    paths = [a for a in argv if not a.startswith("--")]
    dirs = [Path(a) for a in paths] or sorted(p for p in SEED_DIR.iterdir() if p.is_dir())
    violations = check_seed(dirs, expect_total)
    for line in violations:
        print(line)
    print(f"seed_check: {len(dirs)} problem(s), {len(violations)} violation(s)")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
