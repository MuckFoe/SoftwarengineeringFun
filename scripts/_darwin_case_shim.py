"""macOS only: `harness.py --case` with setrlimit failures tolerated (see seed_runner.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sandbox"))

import harness  # noqa: E402

_real_limit = harness._limit


def _tolerant_limit(which, value, hard=None):
    try:
        _real_limit(which, value, hard)
    except (ValueError, OSError):
        pass


harness._limit = _tolerant_limit
harness._case_main()
