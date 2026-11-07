"""Shared by seed_check.py and seed_fill_expected.py: run a reference in the project's runner.

Uses the sandbox harness's own `run_case` (a fresh interpreter per case under the harness's
rlimits and wall limit), the same code the runner container executes. Needs Python 3.10+.
"""

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sandbox"))

import harness  # noqa: E402

if sys.platform == "darwin":
    # macOS refuses RLIMIT_AS, which the harness case process sets; run the case through a shim
    # that tolerates that. Wall and CPU limits still apply; the memory limit is the container's.
    harness.__file__ = str(Path(__file__).with_name("_darwin_case_shim.py"))

SEED_DIR = ROOT / "seed" / "problems"


def run_reference(code: str, function_name: str, cases: list[list]) -> list[dict]:
    """One harness result dict per case, in order (`status` ok/error/timeout/memory)."""
    if not cases:
        return []
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(lambda args: harness.run_case(code, function_name, args), cases))


def function_name_of(signature: str) -> str:
    """The function name in a `def name(...) -> ...` signature; ValueError if it doesn't parse."""
    import ast

    try:
        node = ast.parse(signature.strip().rstrip(":") + ":\n    pass\n").body[0]
    except (SyntaxError, IndexError) as exc:
        raise ValueError(f"signature does not parse: {exc}") from exc
    if not isinstance(node, ast.FunctionDef):
        raise ValueError("signature is not a def")
    return node.name
