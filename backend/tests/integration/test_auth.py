"""Task 15: OIDC login, callback, logout, `/api/me` (FR-1, FR-2b, NFR-8)."""

import html
import json
import re
from base64 import b64decode
from urllib.parse import urljoin, urlsplit

import httpx
import itsdangerous
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
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
    raw = client.cookies["session"].encode("utf-8")
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
