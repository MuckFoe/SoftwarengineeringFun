"""Role dependencies (plan.md "Single sign-on"). FR-2 (role check), FR-2a (missing role)."""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from app import clock


@dataclass(frozen=True)
class User:
    sub: str
    name: str
    roles: list[str]


def current_user(request: Request) -> User | None:
    """The signed-in user from the session cookie, or `None` if signed out or expired."""
    session = request.session
    if "sub" not in session:
        return None
    if session.get("exp", 0) <= clock.now().timestamp():
        session.clear()
        return None
    return User(sub=session["sub"], name=session["name"], roles=session["roles"])


def require_role(role: str) -> Callable[[Request], User]:
    """A dependency: 401 when signed out, 403 `{error: "missing_role", role}` otherwise."""

    def dependency(request: Request) -> User:
        user = current_user(request)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
        if role not in user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "missing_role", "role": role},
            )
        return user

    return dependency
