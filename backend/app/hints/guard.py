"""Solution guard: the app's own checks on every model answer (plan: Solution guard; FR-9, FR-10).

Steps 1-4 and `candidates` are pure. `passes_all_tests` and `check` add the executed step 5:
candidates go to the runner and are graded in memory, never written to `run` or `run_result`
and never broadcast (FR-11).
"""

import ast
import asyncio
import re

from app.problems.repo import ProblemWithTests
from app.problems.signature import parse_signature
from app.runs.grading import grade, is_accepted
from app.runs.runner_client import execute

MAX_CHARS = 600
MAX_CODE_LINES = 1
MAX_SENTENCES = 4
MAX_ENUMERATED_LINES = 2

_THINK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_UNCLOSED = re.compile(r"<think>.*\Z", re.IGNORECASE | re.DOTALL)
_THINK_ORPHAN_CLOSE = re.compile(r"\A.*?</think>", re.IGNORECASE | re.DOTALL)
_HINT_LABEL = re.compile(r"\A\s*hint\s*:\s*", re.IGNORECASE)
_FENCE = re.compile(r"^\s*```")
_SPAN = re.compile(r"(`[^`\n]+`)")
_SPAN_BODY = re.compile(r"`([^`\n]+)`")
_ENUMERATED = re.compile(r"^(?:\d+[.)](?!\d)|[-*•](?=\s)|step\s*\d+\b)", re.IGNORECASE)
_LIST_MARKER = re.compile(r"^(?:\d+[.)](?!\d)|[-*•](?=\s)|step\s*\d+\b[:.)]?)\s*", re.IGNORECASE)
_ABBREVIATIONS = re.compile(r"\b(?:e\.g|i\.e|etc|vs)\.", re.IGNORECASE)
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+")
_PARSE_ERRORS = (SyntaxError, ValueError, RecursionError, MemoryError)
# A name in backticks (`a`, `str.split`) mentions code; it is not a line of code (FR-9).
_BARE_NAME = re.compile(r"\A[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\(\))?\Z")


def _split(text: str) -> list[tuple[bool, str]]:
    """Each line of `text` with whether it is inside a fenced block. Fence markers are dropped."""
    lines: list[tuple[bool, str]] = []
    in_fence = False
    for line in text.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        lines.append((in_fence, line))
    return lines


def _parse(code: str) -> ast.Module | None:
    try:
        return ast.parse(code)
    except _PARSE_ERRORS:
        return None


def _is_code(line: str) -> bool:
    """True when an unmarked line parses as Python and is more than a lone name or constant."""
    tree = _parse(line)
    if tree is None or not tree.body:
        return False
    if len(tree.body) == 1 and isinstance(tree.body[0], ast.Expr):
        return not isinstance(tree.body[0].value, ast.Name | ast.Constant)
    return True


def _collapse_prose(line: str) -> str:
    parts = _SPAN.split(line)
    out = [part if index % 2 else re.sub(r"\s+", " ", part) for index, part in enumerate(parts)]
    return "".join(out).strip()


def normalize(raw: str) -> str | None:
    """Clean a model answer; None when the result is not 1-600 characters (step 1)."""
    text = _THINK.sub("", raw)
    text = _THINK_UNCLOSED.sub("", text)
    text = _THINK_ORPHAN_CLOSE.sub("", text)
    text = _HINT_LABEL.sub("", text.strip(), count=1)
    out: list[str] = []
    in_fence = False
    for line in text.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
            out.append(line.strip())
        elif in_fence:
            if line.strip():
                out.append(line.rstrip())
        else:
            collapsed = _collapse_prose(line)
            if collapsed:
                out.append(collapsed)
    result = "\n".join(out).strip()
    if not 1 <= len(result) <= MAX_CHARS:
        return None
    return result


def code_lines(text: str) -> list[str]:
    """Fenced lines, backtick spans, and unmarked lines that parse as code (step 2)."""
    found: list[str] = []
    for in_fence, line in _split(text):
        if in_fence:
            if line.strip():
                found.append(line.strip())
            continue
        spans = [body.strip() for body in _SPAN_BODY.findall(line) if body.strip()]
        found.extend(spans)
        rest = _SPAN.sub(" ", line).strip()
        if rest and not spans and _is_code(rest):
            found.append(rest)
    return found


def _sentence_count(text: str) -> int:
    count = 0
    for in_fence, line in _split(text):
        if in_fence:
            continue
        stripped = line.strip()
        if not _SPAN.search(stripped) and _is_code(stripped):
            continue
        prose = _LIST_MARKER.sub("", _SPAN.sub("code", stripped))
        prose = _ABBREVIATIONS.sub("abbr", prose)
        count += sum(1 for part in _SENTENCE_BREAK.split(prose) if re.search(r"\w", part))
    return count


def shape_ok(text: str) -> bool:
    """FR-9: at most one code line, about 3 sentences, and no enumerated plan (step 3).

    Names in backticks (`a`, `str.split`) don't count towards the one code line.
    """
    if len([line for line in code_lines(text) if not _BARE_NAME.match(line)]) > MAX_CODE_LINES:
        return False
    if _sentence_count(text) > MAX_SENTENCES:
        return False
    lines = [line.strip() for in_fence, line in _split(text) if not in_fence]
    enumerated = sum(1 for line in lines if _ENUMERATED.match(line))
    return enumerated <= MAX_ENUMERATED_LINES


def _parse_lenient(code: str) -> ast.Module | None:
    """Parse code; a header line such as `def f(a):` is completed with `pass` so it still counts."""
    tree = _parse(code)
    if tree is None and code.rstrip().endswith(":"):
        tree = _parse(code.rstrip() + " pass")
    return tree


def _defines(tree: ast.AST, function_name: str) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            return True
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign | ast.AugAssign | ast.NamedExpr):
            targets = [node.target]
        else:
            continue
        for target in targets:
            if any(isinstance(n, ast.Name) and n.id == function_name for n in ast.walk(target)):
                return True
    return False


def structurally_complete(text: str, function_name: str) -> bool:
    """FR-10: a code line defines a function or lambda, or assigns the function name (step 4)."""
    for line in code_lines(text):
        tree = _parse_lenient(line)
        if tree is not None and _defines(tree, function_name):
            return True
    return False


def _compiles(code: str) -> bool:
    try:
        compile(code, "<hint>", "exec", dont_inherit=True)
    except (*_PARSE_ERRORS, OverflowError):
        return False
    return True


def _is_expression(line: str) -> bool:
    try:
        ast.parse(line, mode="eval")
    except _PARSE_ERRORS:
        return False
    return True


def candidates(signature: str, line: str) -> list[str]:
    """Every way `line` could be placed alone into the editor (step 5, forms a-c).

    Candidates that do not compile are dropped.
    """
    header = signature.strip().rstrip(":").rstrip()
    body = line.strip()
    forms = [body, f"{header}:\n    {body}"]
    if _is_expression(body):
        forms.append(f"{header}:\n    return {body}")
    out: list[str] = []
    for form in forms:
        if form not in out and _compiles(form):
            out.append(form)
    return out


async def passes_all_tests(runner_url: str, problem: ProblemWithTests, codes: list[str]) -> bool:
    """True when any of `codes` passes every test of `problem` (step 5).

    The codes run concurrently. Raises RunnerUnavailable.
    """
    if not codes:
        return False
    function_name = parse_signature(problem.signature).name
    cases = [test.args for test in problem.tests]
    expected = [test.expected for test in problem.tests]
    outcomes = await asyncio.gather(
        *(execute(runner_url, code, function_name, cases) for code in codes)
    )
    return any(is_accepted(grade(expected, outcome)) for outcome in outcomes)


async def check(runner_url: str, problem: ProblemWithTests, raw: str) -> str | None:
    """Every guard step on a model answer: the body to show, or None when it is withheld.

    The executed check (step 5) runs only when the answer has a code line (step 6).
    Raises RunnerUnavailable when that check cannot reach the runner.
    """
    text = normalize(raw)
    if text is None or not shape_ok(text):
        return None
    function_name = parse_signature(problem.signature).name
    if structurally_complete(text, function_name):
        return None
    # Every code fragment is tried, names included: shape_ok lets several names through.
    codes = [code for line in code_lines(text) for code in candidates(problem.signature, line)]
    if codes and await passes_all_tests(runner_url, problem, codes):
        return None
    return text
