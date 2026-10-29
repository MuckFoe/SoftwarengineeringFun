"""Task 15: OIDC login, callback, logout, `/api/me` (FR-1, FR-2b, NFR-8)."""

import html
import json
import re
from base64 import b64decode
from collections.abc import AsyncIterator
from dataclasses import replace
from urllib.parse import parse_qs, quote, urljoin, urlsplit

import asyncpg
import httpx
import itsdangerous
import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.asgi import build_app
from app.auth.oidc import session_claims
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
NEXT_TO_ME = "/api/auth/login?next=/api/me"
_LOGIN_FORM = re.compile(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', re.S)


def _settings(kc: Keycloak) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url="postgresql://unused/unused",
        runner_url="http://unused",
    )


@pytest.fixture
def client(keycloak: Keycloak) -> TestClient:  # noqa: F811
    return TestClient(create_app(_settings(keycloak)))


def _decode_session_cookie(client: TestClient) -> dict:
    raw = client.cookies["collab_session"].encode("utf-8")
    signed = itsdangerous.TimestampSigner(COOKIE_KEY).unsign(raw)
    return json.loads(b64decode(signed))


def test_login_redirects_to_keycloak(client: TestClient, keycloak: Keycloak) -> None:  # noqa: F811
    response = client.get("/api/auth/login", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"].startswith(keycloak.base_url)


def test_login_as_editor_signs_in_and_me_reflects_it(client: TestClient, login_as) -> None:  # noqa: F811
    final = login_as(client, "editor1", start=NEXT_TO_ME)

    assert final.status_code == 200
    me = final.json()
    assert me["signed_in"] is True
    assert "editor" in me["roles"]


def test_session_cookie_holds_only_sub_name_roles_exp(client: TestClient, login_as) -> None:  # noqa: F811
    login_as(client, "editor1", start=NEXT_TO_ME)

    assert set(_decode_session_cookie(client)) == {"sub", "name", "roles", "exp"}


def _strip_secure_flag(browser: httpx.Client) -> None:
    for cookie in browser.cookies.jar:
        cookie.secure = False


def _sign_in(
    app_client: TestClient, browser: httpx.Client, kc: Keycloak, *, expect_form: bool
) -> httpx.Response:
    """Drive the login redirect chain, routing Keycloak hops through `browser`."""
    kc_origin = urlsplit(kc.base_url)[:2]
    response = app_client.get(NEXT_TO_ME, follow_redirects=False)
    for _ in range(20):
        if response.is_redirect:
            url = urljoin(str(response.url), response.headers["location"])
            if urlsplit(url)[:2] == kc_origin:
                response = browser.get(url)
                _strip_secure_flag(browser)
            else:
                response = app_client.get(url, follow_redirects=False)
            continue
        form = _LOGIN_FORM.search(response.text)
        if not form:
            return response
        if not expect_form:
            raise AssertionError("Keycloak asked for credentials on the second sign-in")
        account = kc.users["editor1"]
        response = browser.post(
            urljoin(str(response.url), html.unescape(form.group(1))),
            data={"username": account.username, "password": account.password},
        )
        _strip_secure_flag(browser)
    raise AssertionError("login did not finish within 20 redirects")


def test_already_signed_in_to_keycloak_skips_the_login_form(
    client: TestClient,
    keycloak: Keycloak,  # noqa: F811
) -> None:
    """FR-2b: a second relying-party login, in the same Keycloak SSO session, needs no form."""
    with httpx.Client() as browser:
        first = _sign_in(client, browser, keycloak, expect_form=True)
        assert first.status_code == 200
        assert first.json()["signed_in"] is True

        other_client = TestClient(create_app(_settings(keycloak)))
        second = _sign_in(other_client, browser, keycloak, expect_form=False)

    assert second.status_code == 200
    assert second.json()["signed_in"] is True


def test_logout_clears_the_session(client: TestClient, login_as) -> None:  # noqa: F811
    login_as(client, "editor1", start=NEXT_TO_ME)

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    assert client.get("/api/me").json() == {"signed_in": False, "roles": []}


def test_me_signed_out_by_default(client: TestClient) -> None:
    assert client.get("/api/me").json() == {"signed_in": False, "roles": []}


# --- spec 003 task 5: appearance hint (FR-18) ------------------------------------


def _authorize_query(client: TestClient, path: str) -> dict[str, list[str]]:
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 302
    return parse_qs(urlsplit(response.headers["location"]).query)


@pytest.mark.parametrize("appearance", ["light", "dark"])
def test_fr18_a_valid_appearance_is_passed_to_keycloak(client: TestClient, appearance: str) -> None:
    query = _authorize_query(client, f"/api/auth/login?appearance={appearance}")

    assert query["appearance"] == [appearance]


@pytest.mark.parametrize("path", ["/api/auth/login?appearance=purple", "/api/auth/login"])
def test_fr18_an_invalid_or_missing_appearance_is_dropped(client: TestClient, path: str) -> None:
    query = _authorize_query(client, path)

    assert "appearance" not in query


def test_fr18_next_still_returns_the_user_with_an_appearance_given(
    client: TestClient,
    login_as,  # noqa: F811
) -> None:
    final = login_as(client, "editor1", start="/api/auth/login?next=/api/me&appearance=dark")

    assert final.status_code == 200
    assert urlsplit(str(final.url)).path == "/api/me"
    assert final.json()["signed_in"] is True


# --- spec 005 task 9: roles only from this app's client (FR3) ---------------------


def test_fr3_session_claims_reads_only_the_app_clients_roles() -> None:
    claims = {
        "sub": "u1",
        "preferred_username": "someone",
        "realm_access": {"roles": ["editor", "admin"]},
        "resource_access": {
            "other-app": {"roles": ["editor", "admin"]},
            "collab-coding": {"roles": ["editor"]},
        },
    }

    assert session_claims(claims, "collab-coding", 3600)["roles"] == ["editor"]


def test_fr3_session_claims_without_the_app_client_has_no_roles() -> None:
    claims = {
        "sub": "u1",
        "realm_access": {"roles": ["editor"]},
        "resource_access": {"other-app": {"roles": ["admin"]}},
    }

    assert session_claims(claims, "collab-coding", 3600)["roles"] == []


ADD = parse_signature("def add(a: int, b: int) -> int")
PROBLEM_BODY = {
    "title": "Sum two",
    "description": "d",
    "signature": "def add(a: int, b: int) -> int",
    "tests": [{"args": [2, 3], "expected": 5}],
}


@pytest.fixture
async def db_client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = replace(_settings(keycloak), database_url=database_url)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


async def _stale_invite(database_url: str) -> str:
    conn = await asyncpg.connect(database_url)
    try:
        problem_id = await problems_repo.create(
            conn,
            title="Sum two",
            description="d",
            sig=ADD,
            tests=[TestInput(args=[2, 3], expected=5)],
            created_by_sub=None,
            created_by_name=None,
        )
        session = await sessions_repo.create(conn, problem_id)
        await sessions_repo.set_stale(conn, session.id)
        return session.invite_id
    finally:
        await conn.close()


@pytest.mark.parametrize(("user", "status"), [("editor1", 201), ("plain1", 403), ("decoy1", 403)])
def test_fr3_only_the_app_clients_editor_role_manages_problems(
    db_client: TestClient,
    login_as,  # noqa: F811
    user: str,
    status: int,
) -> None:
    login_as(db_client, user)

    assert db_client.post("/api/problems", json=PROBLEM_BODY).status_code == status


@pytest.mark.parametrize(("user", "status"), [("appadmin1", 200), ("decoy1", 403)])
async def test_fr3_only_the_app_clients_admin_role_reactivates_sessions(
    db_client: TestClient,
    database_url: str,
    login_as,  # noqa: F811
    user: str,
    status: int,
) -> None:
    invite = await _stale_invite(database_url)
    login_as(db_client, user)

    assert db_client.post(f"/api/sessions/{invite}/reactivate").status_code == status


# --- spec 005 task 13: cookie scope, safe next, public callback, metadata URL ------


def _hub_client(kc: Keycloak, **overrides: object) -> TestClient:
    settings = replace(_settings(kc), base_path="/collab", **overrides)
    return TestClient(build_app(settings))


def _login_set_cookie(client: TestClient) -> str:
    response = client.get("/collab/api/auth/login", follow_redirects=False)
    assert response.status_code == 302
    (cookie,) = [v for k, v in response.headers.multi_items() if k == "set-cookie"]
    return cookie


def test_fr3_session_cookie_is_named_for_the_app_and_scoped_to_its_path(
    keycloak: Keycloak,  # noqa: F811
) -> None:
    attributes = [
        part.strip().lower() for part in _login_set_cookie(_hub_client(keycloak)).split(";")
    ]

    assert attributes[0].startswith("collab_session=")
    assert "path=/collab" in attributes
    assert "secure" not in attributes


def test_fr3_session_cookie_is_secure_when_configured(keycloak: Keycloak) -> None:  # noqa: F811
    client = _hub_client(keycloak, cookie_secure=True)

    attributes = [part.strip().lower() for part in _login_set_cookie(client).split(";")]

    assert "secure" in attributes


@pytest.mark.parametrize(
    ("next_value", "lands_on"),
    [
        ("//evil", "http://testserver/collab/"),
        ("/\\evil", "http://testserver/collab/"),
        ("https://evil", "http://testserver/collab/"),
        ("/problems", "http://testserver/collab/problems"),
    ],
)
def test_fr1_next_lands_inside_the_app(
    keycloak: Keycloak,  # noqa: F811
    login_as,  # noqa: F811
    next_value: str,
    lands_on: str,
) -> None:
    client = _hub_client(keycloak)

    final = login_as(client, "editor1", start=f"/collab/api/auth/login?next={quote(next_value)}")

    assert str(final.url) == lands_on


def test_fr1_public_base_url_sets_the_redirect_uri(keycloak: Keycloak) -> None:  # noqa: F811
    public = "https://hub.example.ts.net/collab"
    client = _hub_client(keycloak, public_base_url=public)

    query = _authorize_query(client, "/collab/api/auth/login")

    assert query["redirect_uri"] == [f"{public}/api/auth/callback"]


def test_fr1_discovery_uses_the_metadata_url(keycloak: Keycloak, login_as) -> None:  # noqa: F811
    # The issuer's host does not resolve, so sign-in completes only if discovery goes to
    # the metadata URL instead.
    settings = replace(
        _settings(keycloak),
        oidc_issuer=f"http://issuer.invalid/realms/{keycloak.realm}",
        oidc_metadata_url=f"{keycloak.issuer}/.well-known/openid-configuration",
    )
    client = TestClient(create_app(settings))

    final = login_as(client, "editor1", start=NEXT_TO_ME)

    assert final.status_code == 200
    assert final.json()["signed_in"] is True
