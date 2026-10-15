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
