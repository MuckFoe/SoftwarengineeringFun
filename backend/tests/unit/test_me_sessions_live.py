"""Spec 016 task 13 (FR-2, FR-5): `live` on `/api/me/sessions` rows, from in-memory hubs."""

from types import SimpleNamespace

from app.accounts.api import live_session_ids, mark_live


def _hub(n: int) -> SimpleNamespace:
    return SimpleNamespace(connections={i: object() for i in range(n)})


def test_fr2_connected_participant_is_live_idle_is_not() -> None:
    live = live_session_ids({"a": _hub(1), "b": _hub(0)}, {"p": _hub(2)}, {"c": _hub(0)})
    rows = [
        {"kind": "coding", "invite_id": "ia"},
        {"kind": "learning", "invite_id": "ib"},
        {"kind": "presentation", "invite_id": "ip"},
        {"kind": "chess", "invite_id": "ic"},
    ]
    ids = {
        ("coding", "ia"): "a",
        ("learning", "ib"): "b",
        ("presentation", "ip"): "p",
        ("chess", "ic"): "c",
    }
    assert [r["live"] for r in mark_live(rows, ids, live)] == [True, False, True, False]


def test_fr5_no_hubs_means_all_false_and_unknown_ids_are_not_live() -> None:
    live = live_session_ids({}, {}, {})
    rows = [{"kind": "coding", "invite_id": "x"}]
    assert mark_live(rows, {}, live) == [{"kind": "coding", "invite_id": "x", "live": False}]
