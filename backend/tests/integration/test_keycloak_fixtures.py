"""Task 11: the Keycloak test realm and the `login_as` fixture.

Until the app's own `/api/auth/*` endpoints exist (task 15), a minimal stand-in relying
party below plays their part: it runs the authorization code flow with PKCE against the
real Keycloak, exchanges the code with the confidential client's secret and sets a cookie.
`login_as` drives that flow exactly as it will drive the app's.
"""

import base64
import hashlib
import json
import secrets
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlencode

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.testclient import TestClient

from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    _admin_client,
    cookie_header,
    keycloak,
    login_as,
    signed_in_jar,
)

REALM_FILE = Path(__file__).parents[1] / "keycloak" / "realm.json"
CALLBACK = "http://testserver/callback"


def _claims(jwt: str) -> dict:
    payload = jwt.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def _stand_in_app(kc: Keycloak) -> FastAPI:
    """A relying party doing what task 15's login/callback will do, minus validation."""
    app = FastAPI()
    pending: dict[str, str] = {}  # state -> PKCE verifier
    claims_of: dict[str, dict] = {}  # username -> claims of their last access token

    @app.get("/login")
    def login() -> RedirectResponse:
        state, verifier = secrets.token_urlsafe(16), secrets.token_urlsafe(48)
        pending[state] = verifier
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        query = urlencode(
            {
                "response_type": "code",
                "client_id": kc.client_id,
                "redirect_uri": CALLBACK,
                "scope": "openid",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return RedirectResponse(f"{kc.issuer}/protocol/openid-connect/auth?{query}")

    @app.get("/callback")
    def callback(code: str, state: str) -> RedirectResponse:
        token = httpx.post(
            f"{kc.issuer}/protocol/openid-connect/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": CALLBACK,
                "code_verifier": pending.pop(state),
            },
            auth=(kc.client_id, kc.client_secret),
        )
        token.raise_for_status()
        claims = _claims(token.json()["access_token"])
        claims_of[claims["preferred_username"]] = claims
        response = RedirectResponse("/me")
        roles = ",".join(sorted(claims.get("realm_access", {}).get("roles", [])))
        response.set_cookie("session", f"{claims['preferred_username']}|{roles}", httponly=True)
        return response

    @app.get("/me")
    def me(request: Request) -> JSONResponse:
        user, _, roles = request.cookies["session"].partition("|")
        return JSONResponse({"user": user, "roles": roles.split(",")})

    @app.get("/claims")
    def claims(request: Request) -> JSONResponse:
        user, _, _ = request.cookies["session"].partition("|")
        return JSONResponse(claims_of[user])

    return app


@pytest.fixture
def client(keycloak: Keycloak) -> TestClient:  # noqa: F811
    return TestClient(_stand_in_app(keycloak))


def test_login_as_editor1_ends_with_cookie_on_test_client(client: TestClient, login_as) -> None:  # noqa: F811
    final = login_as(client, "editor1", start="/login")

    assert client.cookies.get("session")
    assert final.status_code == 200
    me = final.json()
    assert me["user"] == "editor1"
    assert "editor" in me["roles"]
    assert "admin" not in me["roles"]


@pytest.mark.parametrize(
    ("user", "has_editor", "has_admin"),
    [("editor2", True, False), ("plain1", False, False), ("admin1", False, True)],
)
def test_other_users_carry_their_roles(
    client: TestClient,
    login_as,  # noqa: F811
    user: str,
    has_editor: bool,
    has_admin: bool,
) -> None:
    me = login_as(client, user, start="/login").json()

    assert me["user"] == user
    assert ("editor" in me["roles"]) is has_editor
    assert ("admin" in me["roles"]) is has_admin


def test_passwords_are_random_per_run(keycloak: Keycloak) -> None:  # noqa: F811
    passwords = [u.password for u in keycloak.users.values()]
    assert set(keycloak.users) == {
        "editor1",
        "editor2",
        "plain1",
        "admin1",
        "decoy1",
        "appadmin1",
        "newuser",
        "other",
    }
    assert len(set(passwords)) == len(passwords)
    assert all(len(p) >= 20 for p in passwords)


def test_wrong_password_is_refused(client: TestClient, keycloak: Keycloak, login_as) -> None:  # noqa: F811
    keycloak.users["plain1"].password, real = "not-the-password", keycloak.users["plain1"].password
    try:
        with pytest.raises(AssertionError, match="rejected"):
            login_as(client, "plain1", start="/login")
    finally:
        keycloak.users["plain1"].password = real
    assert not client.cookies.get("session")


def _keys(node: object) -> list[str]:
    if isinstance(node, dict):
        return [k for k, v in node.items() for k in (k, *_keys(v))]
    if isinstance(node, list):
        return [k for item in node for k in _keys(item)]
    return []


def test_realm_file_holds_no_credentials() -> None:
    realm = json.loads(REALM_FILE.read_text())
    keys = {k.lower() for k in _keys(realm)}

    assert not keys & {"secret", "credentials", "password", "users", "privatekey"}
    assert {r["name"] for r in realm["roles"]["realm"]} >= {"editor", "admin"}
    (app,) = [c for c in realm["clients"] if c["clientId"] == "collab-coding"]
    assert app["publicClient"] is False
    assert app["standardFlowEnabled"] is True


# Spec 005 task 3: roles come from this app's client; the decoys hold the same role names
# on another client and in the realm (plan 4.2 role matrix, FR3).

OTHER_CLIENT = "other-app"

# username -> (this app's client roles, other-app's client roles, realm roles)
EXPECTED_ROLES: dict[str, tuple[set[str], set[str], set[str]]] = {
    "editor1": ({"editor"}, set(), {"editor"}),
    "editor2": ({"editor"}, set(), {"editor"}),
    "plain1": (set(), set(), set()),
    "admin1": ({"admin"}, set(), {"admin"}),
    "decoy1": (set(), {"editor", "admin"}, {"editor"}),
    "appadmin1": ({"admin"}, set(), set()),
    "newuser": (set(), set(), set()),
    "other": (set(), set(), set()),
}


def _own_realm_roles(claims: dict) -> set[str]:
    """Realm roles minus the ones Keycloak gives every user of the realm."""
    roles = set(claims.get("realm_access", {}).get("roles", []))
    return {r for r in roles if not r.startswith("default-roles-")} - {
        "offline_access",
        "uma_authorization",
    }


def _client_roles(claims: dict, client_id: str) -> set[str]:
    return set(claims.get("resource_access", {}).get(client_id, {}).get("roles", []))


@pytest.mark.parametrize("user", sorted(EXPECTED_ROLES))
def test_fr3_access_token_carries_exactly_the_expected_roles(
    client: TestClient,
    keycloak: Keycloak,  # noqa: F811
    login_as,  # noqa: F811
    user: str,
) -> None:
    login_as(client, user, start="/login")
    claims = client.get("/claims").json()

    app_roles, other_roles, realm_roles = EXPECTED_ROLES[user]
    assert claims["preferred_username"] == user
    assert _client_roles(claims, keycloak.client_id) == app_roles
    assert _client_roles(claims, OTHER_CLIENT) == other_roles
    assert _own_realm_roles(claims) == realm_roles


def test_fr3_realm_file_declares_client_roles_and_decoy_client() -> None:
    realm = json.loads(REALM_FILE.read_text())
    client_roles = realm["roles"]["client"]
    assert {r["name"] for r in client_roles["collab-coding"]} == {"editor", "admin"}
    assert {r["name"] for r in client_roles[OTHER_CLIENT]} == {"editor", "admin"}
    assert OTHER_CLIENT in {c["clientId"] for c in realm["clients"]}


# Spec 012 task 4: `newuser` and `other` (no app role), the editor, registration allowed
# and one signed-in cookie jar per call (FR-10, FR-11; plan "Test strategy").

APP_COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


@pytest.fixture
async def app_client(keycloak: Keycloak, database_url: str) -> AsyncIterator[TestClient]:  # noqa: F811
    import asyncpg

    from app import db as app_db
    from app.config import Settings
    from app.main import create_app

    # Signed-in `/api/me` reads account preferences (012 task 11), so the app needs its DB.
    conn = await asyncpg.connect(database_url)
    try:
        await app_db.migrate(conn)
    finally:
        await conn.close()
    settings = Settings(
        oidc_issuer=keycloak.issuer,
        oidc_client_id=keycloak.client_id,
        oidc_client_secret=keycloak.client_secret,
        session_cookie_key=APP_COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.mark.parametrize(
    ("user", "roles"), [("newuser", []), ("other", []), ("editor1", ["editor"])]
)
def test_012_users_sign_in_with_their_roles(
    app_client: TestClient,
    signed_in_jar,  # noqa: F811
    user: str,
    roles: list[str],
) -> None:
    jar = signed_in_jar(app_client, user)
    app_client.cookies = jar
    me = app_client.get("/api/me").json()

    assert me["signed_in"] is True
    assert me["name"] == user
    assert me["roles"] == roles


def test_012_two_jars_for_one_user_are_both_signed_in(
    app_client: TestClient,
    signed_in_jar,  # noqa: F811
) -> None:
    first = signed_in_jar(app_client, "newuser")
    second = signed_in_jar(app_client, "newuser")

    # The app cookie is stateless, so equal values within one second are fine; what matters
    # is two separate jars, each signed in, and the second sign-in not ending the first.
    assert first is not second
    assert first["collab_session"] and second["collab_session"]
    assert not app_client.cookies  # the client's own jar is left as it was
    for jar in (first, second):
        app_client.cookies = jar
        me = app_client.get("/api/me").json()
        assert (me["signed_in"], me["name"]) == (True, "newuser")
    # The jars work side by side as request headers too (e.g. two sockets at once).
    app_client.cookies = httpx.Cookies()
    for jar in (first, second):
        me = app_client.get("/api/me", headers=cookie_header(jar)).json()
        assert me["name"] == "newuser"


def test_012_registration_is_allowed(keycloak: Keycloak) -> None:  # noqa: F811
    assert json.loads(REALM_FILE.read_text())["registrationAllowed"] is True
    with _admin_client() as admin:
        realm = admin.get(str(admin.base_url).rstrip("/")).raise_for_status().json()
    assert realm["registrationAllowed"] is True
