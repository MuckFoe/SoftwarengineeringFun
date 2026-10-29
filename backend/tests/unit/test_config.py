from datetime import UTC, datetime

import pytest

from app import clock
from app.config import ConfigError, load_settings

REQUIRED = {
    "OIDC_ISSUER": "http://keycloak.local/realms/test",
    "OIDC_CLIENT_ID": "collab",
    "OIDC_CLIENT_SECRET": "from-env",
    "SESSION_COOKIE_KEY": "from-env",
    "DATABASE_URL": "postgresql://db/collab",
    "RUNNER_URL": "http://runner:8080",
}


def test_nfr7_missing_client_secret_raises_clear_error():
    env = {k: v for k, v in REQUIRED.items() if k != "OIDC_CLIENT_SECRET"}
    with pytest.raises(ConfigError, match="OIDC_CLIENT_SECRET"):
        load_settings(env)


def test_nfr7_every_missing_required_setting_is_named():
    with pytest.raises(ConfigError) as exc:
        load_settings({})
    for name in REQUIRED:
        assert name in str(exc.value)


def test_nfr7_empty_value_counts_as_missing():
    with pytest.raises(ConfigError, match="SESSION_COOKIE_KEY"):
        load_settings({**REQUIRED, "SESSION_COOKIE_KEY": ""})


def test_settings_read_from_env_with_role_defaults():
    s = load_settings(REQUIRED)
    assert s.oidc_client_secret == "from-env"
    assert s.database_url == "postgresql://db/collab"
    assert s.role_editor == "editor"
    assert s.role_admin == "admin"


def test_role_names_overridable():
    s = load_settings({**REQUIRED, "ROLE_EDITOR": "problem-editor", "ROLE_ADMIN": "ops"})
    assert (s.role_editor, s.role_admin) == ("problem-editor", "ops")


def test_secrets_not_in_repr():
    s = load_settings({**REQUIRED, "OIDC_CLIENT_SECRET": "s3cr3t", "SESSION_COOKIE_KEY": "k3y"})
    assert "s3cr3t" not in repr(s)
    assert "k3y" not in repr(s)


def test_clock_override_is_returned():
    fixed = datetime(2026, 1, 1, tzinfo=UTC)
    with clock.frozen(fixed):
        assert clock.now() == fixed
    assert clock.now() != fixed


def test_clock_default_is_timezone_aware_utc():
    assert clock.now().tzinfo is UTC


def test_hub_settings_default_to_local_behaviour():
    s = load_settings(REQUIRED)
    assert s.base_path == ""
    assert s.public_base_url is None
    assert s.oidc_metadata_url is None
    assert s.session_cookie_name == "collab_session"
    assert s.cookie_secure is False


def test_hub_settings_read_from_env():
    s = load_settings(
        {
            **REQUIRED,
            "BASE_PATH": "/collab",
            "PUBLIC_BASE_URL": "https://hub.example.ts.net/collab",
            "OIDC_METADATA_URL": "http://auth:8080/auth/realms/hub/.well-known/openid-configuration",
            "SESSION_COOKIE_NAME": "hub_collab",
            "COOKIE_SECURE": "true",
        }
    )
    assert s.base_path == "/collab"
    assert s.public_base_url == "https://hub.example.ts.net/collab"
    assert (
        s.oidc_metadata_url == "http://auth:8080/auth/realms/hub/.well-known/openid-configuration"
    )
    assert s.session_cookie_name == "hub_collab"
    assert s.cookie_secure is True


@pytest.mark.parametrize("value", ["/collab", "/a", "/my-app2"])
def test_fr1_base_path_accepted(value):
    assert load_settings({**REQUIRED, "BASE_PATH": value}).base_path == value


@pytest.mark.parametrize("value", ["collab", "/collab/", "/Collab", "/1x", "//x", "/", "/a/b"])
def test_fr1_malformed_base_path_raises(value):
    with pytest.raises(ConfigError, match="BASE_PATH"):
        load_settings({**REQUIRED, "BASE_PATH": value})


@pytest.mark.parametrize(("value", "expected"), [("true", True), ("false", False)])
def test_cookie_secure_parses_booleans(value, expected):
    assert load_settings({**REQUIRED, "COOKIE_SECURE": value}).cookie_secure is expected


@pytest.mark.parametrize("value", ["yes", "1", "on", "maybe"])
def test_cookie_secure_rejects_other_values(value):
    with pytest.raises(ConfigError, match="COOKIE_SECURE"):
        load_settings({**REQUIRED, "COOKIE_SECURE": value})
