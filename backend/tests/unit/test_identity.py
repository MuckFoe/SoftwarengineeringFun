"""Spec 012 task 2: one identity rule for all sockets (FR-1, FR-6, NFR-2)."""

from datetime import UTC, datetime, timedelta

from app import clock
from app.accounts.identity import Identity, identity_for

T0 = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
SUB = "3f2c9a1e-sub-newuser"


def _signed_in(exp: datetime) -> dict[str, object]:
    return {"sub": SUB, "name": "newuser", "roles": [], "exp": int(exp.timestamp())}


def test_signed_in_join_takes_the_account_name() -> None:
    # FR-1: signed-in newuser joins with no name → participant name is newuser.
    with clock.frozen(T0):
        assert identity_for(_signed_in(T0 + timedelta(hours=1)), "") == Identity(SUB, "newuser")


def test_signed_in_browser_cannot_set_the_name() -> None:
    # NFR-2: a name sent by the browser is ignored for a signed-in user.
    with clock.frozen(T0):
        identity = identity_for(_signed_in(T0 + timedelta(hours=1)), "admin")
    assert identity == Identity(SUB, "newuser")


def test_signed_out_uses_the_name_rule() -> None:
    # FR-6: not signed in → asked for a name as today.
    with clock.frozen(T0):
        assert identity_for({}, "Ann") == Identity(None, "Ann")
        assert identity_for({}, "  Ann  ") == Identity(None, "Ann")
        assert identity_for({}, "a" * 30) == Identity(None, "a" * 30)


def test_signed_out_invalid_name_is_none() -> None:
    with clock.frozen(T0):
        assert identity_for({}, "") is None
        assert identity_for({}, "   ") is None
        assert identity_for({}, "a" * 31) is None


def test_expired_session_is_signed_out() -> None:
    with clock.frozen(T0):
        expired = _signed_in(T0 - timedelta(seconds=1))
        assert identity_for(expired, "Ann") == Identity(None, "Ann")
        assert identity_for(expired, "") is None
        at_expiry = _signed_in(T0)
        assert identity_for(at_expiry, "Ann") == Identity(None, "Ann")


def test_session_without_exp_is_signed_out() -> None:
    with clock.frozen(T0):
        assert identity_for({"sub": SUB, "name": "newuser"}, "Ann") == Identity(None, "Ann")
