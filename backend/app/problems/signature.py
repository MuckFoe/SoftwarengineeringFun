"""Problem signatures and test validation (FR-3, FR-4, FR-16).

Pure: no I/O and no framework imports.
"""

import ast
import json
import math
from dataclasses import dataclass
from typing import Any

_SCALARS = {"int": int, "float": float, "str": str, "bool": bool}
FLOAT_REL_TOL = 1e-9


class SignatureError(ValueError):
    """The signature isn't a single, fully annotated `def` line with allowed types."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class Param:
    name: str
    type: str


@dataclass(frozen=True)
class Signature:
    name: str
    params: list[Param]
    return_type: str

    @property
    def line(self) -> str:
        params = ", ".join(f"{p.name}: {p.type}" for p in self.params)
        return f"def {self.name}({params}) -> {self.return_type}:"


@dataclass(frozen=True)
class TestInput:
    __test__ = False  # not a pytest test class

    args: list[Any]
    expected: Any


@dataclass(frozen=True)
class FieldError:
    field: str
    message: str
    test_index: int | None = None


# --- annotations ----------------------------------------------------------


def _check_annotation(node: ast.expr | None, where: str) -> ast.expr:
    if node is None:
        raise SignatureError(f"{where} needs a type annotation")
    if isinstance(node, ast.Name) and node.id in _SCALARS:
        return node
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        if node.value.id == "list":
            _check_annotation(node.slice, where)
            return node
        if node.value.id == "dict":
            sl = node.slice
            if (
                isinstance(sl, ast.Tuple)
                and len(sl.elts) == 2
                and isinstance(sl.elts[0], ast.Name)
                and sl.elts[0].id == "str"
            ):
                _check_annotation(sl.elts[1], where)
                return node
            raise SignatureError(f"{where}: dict keys must be str, as in dict[str, T]")
    if (
        isinstance(node, ast.BinOp)
        and isinstance(node.op, ast.BitOr)
        and isinstance(node.right, ast.Constant)
        and node.right.value is None
    ):
        _check_annotation(node.left, where)
        return node
    raise SignatureError(
        f"{where} has an unsupported type '{ast.unparse(node)}'; allowed: "
        "int, float, str, bool, list[T], dict[str, T], T | None"
    )


def parse_signature(src: str) -> Signature:
    line = src.strip()
    if not line or "\n" in line:
        raise SignatureError("The signature must be a single 'def' line")
    if not line.endswith(":"):
        line += ":"
    try:
        module = ast.parse(line + "\n    pass\n")
    except SyntaxError as exc:
        raise SignatureError(f"The signature isn't valid Python: {exc.msg}") from None
    if len(module.body) != 1 or not isinstance(module.body[0], ast.FunctionDef):
        raise SignatureError("The signature must be a single 'def' line")
    fn = module.body[0]
    if fn.decorator_list or fn.type_params:
        raise SignatureError("The signature can't have decorators or type parameters")
    if len(fn.body) != 1 or not isinstance(fn.body[0], ast.Pass):
        raise SignatureError("The signature must be a single 'def' line with no body")
    a = fn.args
    if a.posonlyargs or a.vararg or a.kwonlyargs or a.kwarg or a.defaults:
        raise SignatureError(
            "Only plain parameters are allowed: no defaults, '/', '*', *args or **kwargs"
        )
    params = [
        Param(arg.arg, ast.unparse(_check_annotation(arg.annotation, f"Parameter '{arg.arg}'")))
        for arg in a.args
    ]
    return_type = ast.unparse(_check_annotation(fn.returns, "The return value"))
    return Signature(name=fn.name, params=params, return_type=return_type)


# --- values ---------------------------------------------------------------


def _conforms(value: Any, node: ast.expr) -> bool:
    if isinstance(node, ast.Name):
        if node.id == "float":
            return isinstance(value, int | float) and not isinstance(value, bool)
        if node.id == "int":
            return isinstance(value, int) and not isinstance(value, bool)
        return type(value) is _SCALARS[node.id]
    if isinstance(node, ast.BinOp):  # T | None
        return value is None or _conforms(value, node.left)
    # Only annotations accepted by _check_annotation reach here: list[T] or dict[str, T].
    sl = node.slice  # type: ignore[attr-defined]
    if isinstance(sl, ast.Tuple):  # dict[str, T]
        return (
            isinstance(value, dict)
            and all(isinstance(k, str) for k in value)
            and all(_conforms(v, sl.elts[1]) for v in value.values())
        )
    return isinstance(value, list) and all(_conforms(v, sl) for v in value)


def _type_node(annotation: str) -> ast.expr:
    return ast.parse(annotation, mode="eval").body


def validate_tests(sig: Signature, tests: list[TestInput]) -> list[FieldError]:
    if not tests:
        return [FieldError("tests", "Add at least one test")]
    param_nodes = [(p, _type_node(p.type)) for p in sig.params]
    return_node = _type_node(sig.return_type)
    errors: list[FieldError] = []
    for i, test in enumerate(tests):
        message = _test_problem(test, param_nodes, sig.return_type, return_node)
        if message:
            errors.append(FieldError("tests", f"Test {i + 1}: {message}", test_index=i))
    return errors


def _test_problem(
    test: TestInput,
    param_nodes: list[tuple[Param, ast.expr]],
    return_type: str,
    return_node: ast.expr,
) -> str | None:
    if not isinstance(test.args, list) or len(test.args) != len(param_nodes):
        got = len(test.args) if isinstance(test.args, list) else "no"
        return f"expected {len(param_nodes)} arguments, got {got}"
    for value, (param, node) in zip(test.args, param_nodes, strict=True):
        if not _conforms(value, node):
            return f"argument '{param.name}' must be {param.type}"
    if not _conforms(test.expected, return_node):
        return f"expected value must be {return_type}"
    return None


def starter_code(sig: Signature) -> str:
    return f"{sig.line}\n    pass\n"


def _round_trip(value: Any) -> Any:
    return json.loads(json.dumps(value, allow_nan=False))


def _equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, int | float) and isinstance(b, int | float):
        if isinstance(a, int) and isinstance(b, int):
            return a == b
        return math.isclose(a, b, rel_tol=FLOAT_REL_TOL)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_equal(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


def values_equal(actual: Any, expected: Any) -> bool:
    """Compare two values after a JSON round-trip; floats use a relative tolerance."""
    try:
        return _equal(_round_trip(actual), _round_trip(expected))
    except (TypeError, ValueError):
        return False
