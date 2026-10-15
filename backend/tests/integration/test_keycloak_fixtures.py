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
from pathlib import Path
from urllib.parse import urlencode

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.testclient import TestClient

from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
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
        response = RedirectResponse("/me")
        roles = ",".join(sorted(claims.get("realm_access", {}).get("roles", [])))
        response.set_cookie("session", f"{claims['preferred_username']}|{roles}", httponly=True)
        return response

    @app.get("/me")
    def me(request: Request) -> JSONResponse:
        user, _, roles = request.cookies["session"].partition("|")
        return JSONResponse({"user": user, "roles": roles.split(",")})

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
    assert set(keycloak.users) == {"editor1", "editor2", "plain1", "admin1"}
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
