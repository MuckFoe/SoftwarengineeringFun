"""One identity rule for all three sockets (spec 012 FR-1, FR-6, NFR-2).

Signed in, the cookie's account decides who joins and the name the browser sends is
ignored; signed out, the existing name rule applies.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app import clock
from app.present.service import valid_name


@dataclass(frozen=True)
class Identity:
    account_sub: str | None
    name: str


def identity_for(session: Mapping[str, Any], raw_name: str) -> Identity | None:
    """The joining identity, or `None` when signed out with an invalid name.

    Signed in means what `auth.deps.current_user` checks: a `sub` and an unexpired `exp`.
    """
    if "sub" in session and session.get("exp", 0) > clock.now().timestamp():
        return Identity(account_sub=session["sub"], name=session["name"])
    name = valid_name(raw_name)
    return None if name is None else Identity(account_sub=None, name=name)
