"""Task 22: role dependencies (`auth/deps.py`). FR-2, FR-2a."""

from datetime import timedelta

from fastapi import Depends
from fastapi.testclient import TestClient

from app.auth.deps import require_role
from app.config import Settings
from app.main import create_app
from tests.conftest import FrozenClock
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)


def _settings(kc: Keycloak) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url="postgresql://unused/unused",
        runner_url="http://unused",
    )


def _client(kc: Keycloak) -> TestClient:
    app = create_app(_settings(kc))

    @app.get("/test/editor-only", dependencies=[Depends(require_role("editor"))])
    def editor_only() -> dict:
        return {"ok": True}

    return TestClient(app)


def test_fr2_signed_out_gives_401(keycloak: Keycloak) -> None:  # noqa: F811
    client = _client(keycloak)

    response = client.get("/test/editor-only")

    assert response.status_code == 401


def test_fr2a_a_user_without_the_role_gives_403_missing_role(
    keycloak: Keycloak,  # noqa: F811
    login_as,  # noqa: F811
) -> None:
    client = _client(keycloak)
    login_as(client, "plain1", start="/api/auth/login")

    response = client.get("/test/editor-only")

    assert response.status_code == 403
    assert response.json() == {"error": "missing_role", "role": "editor"}


def test_fr2_a_user_with_the_role_gives_200(keycloak: Keycloak, login_as) -> None:  # noqa: F811
    client = _client(keycloak)
    login_as(client, "editor1", start="/api/auth/login")

    response = client.get("/test/editor-only")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_nfr8_a_sign_in_expires_after_the_session_max_age(
    keycloak: Keycloak,  # noqa: F811
    login_as,  # noqa: F811
    frozen_clock: FrozenClock,
) -> None:
    client = _client(keycloak)
    login_as(client, "editor1", start="/api/auth/login")
    assert client.get("/test/editor-only").status_code == 200

    # A role removed in Keycloak stops working here once the sign-in expires.
    frozen_clock.advance(timedelta(seconds=Settings.session_max_age_seconds + 1))

    assert client.get("/test/editor-only").status_code == 401
    assert client.get("/api/me").json() == {"signed_in": False, "roles": []}
