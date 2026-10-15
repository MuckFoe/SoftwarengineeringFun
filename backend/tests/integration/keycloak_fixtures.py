"""Keycloak fixtures for integration tests (plan.md "Test strategy").

The realm is imported from `tests/keycloak/realm.json`, which holds no credentials. Per
run, the `keycloak` fixture rotates the confidential client's secret and creates the test
users through the admin API, each with a random password.

`login_as(client, user)` drives the real authorization code flow: it starts at the app's
login URL on `client` (an httpx client or Starlette `TestClient`), follows the redirect to
Keycloak, posts Keycloak's login form, and follows the redirect back to the app's callback,
which leaves the app's cookie on `client`. Keycloak pages are fetched with a separate httpx
client because a `TestClient` routes every URL into the app.

Use them by importing `keycloak` and `login_as` into a test module (or list this module
in a root conftest's `pytest_plugins`).

Environment (same names as docker-compose.test.yml):
  TEST_KEYCLOAK_ADMIN_PASSWORD  master-realm admin password (required)
  TEST_KEYCLOAK_ADMIN_USER      default admin
  TEST_KEYCLOAK_URL             default http://127.0.0.1:58180
"""

import html
import os
import re
import secrets
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx
import pytest

REALM = "collab-test"
CLIENT_ID = "collab-coding"

# username -> realm roles (FR-2, FR-2a, FR-31)
TEST_USERS: dict[str, tuple[str, ...]] = {
    "editor1": ("editor",),
    "editor2": ("editor",),
    "plain1": (),
    "admin1": ("admin",),
}

_LOGIN_FORM = re.compile(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', re.S)


@dataclass
class TestUser:
    __test__ = False  # not a test class

    username: str
    password: str = field(repr=False)
    roles: tuple[str, ...]


@dataclass
class Keycloak:
    base_url: str
    realm: str
    client_id: str
    client_secret: str = field(repr=False)
    users: dict[str, TestUser]

    @property
    def issuer(self) -> str:
        return f"{self.base_url}/realms/{self.realm}"


def _admin_client() -> httpx.Client:
    password = os.environ.get("TEST_KEYCLOAK_ADMIN_PASSWORD")
    if not password:
        pytest.fail(
            "TEST_KEYCLOAK_ADMIN_PASSWORD is not set; start the test stack with "
            "`docker compose -f docker-compose.test.yml up -d --wait`",
            pytrace=False,
        )
    base = os.environ.get("TEST_KEYCLOAK_URL", "http://127.0.0.1:58180").rstrip("/")
    token = httpx.post(
        f"{base}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": os.environ.get("TEST_KEYCLOAK_ADMIN_USER", "admin"),
            "password": password,
        },
    )
    token.raise_for_status()
    return httpx.Client(
        base_url=f"{base}/admin/realms/{REALM}",
        headers={"Authorization": f"Bearer {token.json()['access_token']}"},
    )


def _delete_user(admin: httpx.Client, username: str) -> None:
    found = admin.get("/users", params={"username": username, "exact": "true"})
    found.raise_for_status()
    for user in found.json():
        admin.delete(f"/users/{user['id']}").raise_for_status()


def _create_user(admin: httpx.Client, user: TestUser) -> None:
    _delete_user(admin, user.username)  # left over from an interrupted run
    created = admin.post(
        "/users",
        json={
            "username": user.username,
            "enabled": True,
            "email": f"{user.username}@example.test",
            "emailVerified": True,
            "firstName": user.username,
            "lastName": "Test",
            "requiredActions": [],
            "credentials": [{"type": "password", "value": user.password, "temporary": False}],
        },
    )
    created.raise_for_status()
    user_id = created.headers["location"].rsplit("/", 1)[-1]
    if user.roles:
        roles = [admin.get(f"/roles/{name}").raise_for_status().json() for name in user.roles]
        admin.post(f"/users/{user_id}/role-mappings/realm", json=roles).raise_for_status()


@pytest.fixture(scope="session")
def keycloak() -> Iterator[Keycloak]:
    """The test realm with a fresh client secret and the test users; users removed after."""
    with _admin_client() as admin:
        (client,) = admin.get("/clients", params={"clientId": CLIENT_ID}).json()
        rotated = admin.post(f"/clients/{client['id']}/client-secret")
        rotated.raise_for_status()
        users = {
            name: TestUser(name, secrets.token_urlsafe(24), roles)
            for name, roles in TEST_USERS.items()
        }
        for user in users.values():
            _create_user(admin, user)
        base = str(admin.base_url).split("/admin/", 1)[0]
        try:
            yield Keycloak(base, REALM, CLIENT_ID, rotated.json()["value"], users)
        finally:
            for name in users:
                _delete_user(admin, name)


def _loopback_is_secure(kc: httpx.Client) -> Callable[[httpx.Response], None]:
    """Send `Secure` cookies to a plain-http loopback Keycloak, as browsers do.

    Keycloak marks its login-session cookies `Secure`. The stdlib cookie jar would not
    send them back over http://127.0.0.1 and the login form post would fail with
    `cookie_not_found`, so the flag is cleared once they are stored.
    """

    def hook(response: httpx.Response) -> None:
        if response.url.host in {"127.0.0.1", "localhost", "::1"}:
            for cookie in kc.cookies.jar:
                cookie.secure = False

    return hook


def _origin(url: str) -> tuple[str, str]:
    parts = urlsplit(url)
    return parts.scheme, parts.netloc


LoginAs = Callable[..., httpx.Response]


@pytest.fixture
def login_as(keycloak: Keycloak) -> LoginAs:
    """`login_as(client, "editor1", start="/api/auth/login")` -> the final app response."""

    def _login_as(
        client: httpx.Client, user: str, *, start: str = "/api/auth/login"
    ) -> httpx.Response:
        account = keycloak.users[user]
        kc_origin = _origin(keycloak.base_url)
        with httpx.Client() as kc:
            kc.event_hooks["response"] = [_loopback_is_secure(kc)]

            def get(url: str) -> httpx.Response:
                if _origin(url) == kc_origin:
                    return kc.get(url)
                return client.get(url, follow_redirects=False)

            response = client.get(start, follow_redirects=False)
            submitted = False
            for _ in range(20):
                if response.is_redirect:
                    response = get(urljoin(str(response.url), response.headers["location"]))
                    continue
                form = _LOGIN_FORM.search(response.text)
                if _origin(str(response.url)) != kc_origin or not form:
                    break
                if submitted:
                    raise AssertionError(f"Keycloak rejected the login of {user!r}")
                submitted = True
                response = kc.post(
                    urljoin(str(response.url), html.unescape(form.group(1))),
                    data={"username": account.username, "password": account.password},
                )
            else:
                raise AssertionError(f"login of {user!r} did not finish within 20 redirects")

        if not submitted:
            raise AssertionError(f"login of {user!r} never reached Keycloak's login form")
        if not client.cookies:
            raise AssertionError(f"login of {user!r} left no cookie on the client")
        return response

    return _login_as
