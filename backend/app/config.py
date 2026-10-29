"""Settings, read only from the environment (constitution rule 7)."""

import os
import re
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

# Mount prefix with no trailing slash, e.g. "/collab"; "" serves at the root.
BASE_PATH_RE = re.compile(r"(/[a-z][a-z0-9-]*)?")


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
    # How long a sign-in lasts here. A role removed in Keycloak stops working on this site
    # within this time (NFR-8); signing in again is silent while the Keycloak SSO session
    # lasts (FR-2b).
    session_max_age_seconds: int = 3600
    # Site-wide run limits (FR-24, NFR-2): same for every problem.
    case_cpu_seconds: int = 2
    case_wall_seconds: int = 3
    memory_mb: int = 256
    run_timeout_seconds: int = 20
    # Hosting on the project hub (spec 005). The defaults keep local behaviour unchanged.
    base_path: str = ""
    public_base_url: str | None = None
    # Unset means f"{oidc_issuer}/.well-known/openid-configuration".
    oidc_metadata_url: str | None = None
    session_cookie_name: str = "collab_session"
    cookie_secure: bool = False


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    missing = [name for name in REQUIRED if not env.get(name)]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")
    base_path = env.get("BASE_PATH") or ""
    if not BASE_PATH_RE.fullmatch(base_path):
        raise ConfigError(f"BASE_PATH must look like /collab, got {base_path!r}")
    return Settings(
        oidc_issuer=env["OIDC_ISSUER"],
        oidc_client_id=env["OIDC_CLIENT_ID"],
        oidc_client_secret=env["OIDC_CLIENT_SECRET"],
        session_cookie_key=env["SESSION_COOKIE_KEY"],
        database_url=env["DATABASE_URL"],
        runner_url=env["RUNNER_URL"],
        role_editor=env.get("ROLE_EDITOR") or "editor",
        role_admin=env.get("ROLE_ADMIN") or "admin",
        session_max_age_seconds=int(env.get("SESSION_MAX_AGE_SECONDS") or 3600),
        base_path=base_path,
        public_base_url=env.get("PUBLIC_BASE_URL") or None,
        oidc_metadata_url=env.get("OIDC_METADATA_URL") or None,
        session_cookie_name=env.get("SESSION_COOKIE_NAME") or "collab_session",
        cookie_secure=_bool(env, "COOKIE_SECURE", default=False),
    )


def _bool(env: Mapping[str, str], name: str, *, default: bool) -> bool:
    value = env.get(name)
    if not value:
        return default
    if value not in ("true", "false"):
        raise ConfigError(f"{name} must be true or false, got {value!r}")
    return value == "true"
