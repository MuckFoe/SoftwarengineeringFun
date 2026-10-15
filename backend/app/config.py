"""Settings, read only from the environment (constitution rule 7)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

REQUIRED = (
    "OIDC_ISSUER",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "SESSION_COOKIE_KEY",
    "DATABASE_URL",
    "RUNNER_URL",
)


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    oidc_issuer: str
    oidc_client_id: str
    oidc_client_secret: str = field(repr=False)
    session_cookie_key: str = field(repr=False)
    database_url: str = field(repr=False)
    runner_url: str
    role_editor: str = "editor"
    role_admin: str = "admin"
    # Site-wide run limits (FR-24, NFR-2): same for every problem.
    case_cpu_seconds: int = 2
    case_wall_seconds: int = 3
    memory_mb: int = 256
    run_timeout_seconds: int = 20


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    missing = [name for name in REQUIRED if not env.get(name)]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")
    return Settings(
        oidc_issuer=env["OIDC_ISSUER"],
        oidc_client_id=env["OIDC_CLIENT_ID"],
        oidc_client_secret=env["OIDC_CLIENT_SECRET"],
        session_cookie_key=env["SESSION_COOKIE_KEY"],
        database_url=env["DATABASE_URL"],
        runner_url=env["RUNNER_URL"],
        role_editor=env.get("ROLE_EDITOR") or "editor",
        role_admin=env.get("ROLE_ADMIN") or "admin",
    )
