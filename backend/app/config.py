"""Settings, read only from the environment (constitution rule 7)."""

import math
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
    # GIF search in session chat (spec 007). Unset key means GIFs are unavailable.
    giphy_api_key: str | None = field(default=None, repr=False)
    giphy_base_url: str = "https://api.giphy.com"
    # HTML presentations (spec 013): how long an away host keeps the role (FR-16, FR-26).
    present_host_grace_seconds: float = 60.0
    # Chess (spec 014): how long an opponent must be away before a claim is possible (FR-33).
    chess_abandon_seconds: float = 120.0


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
        giphy_api_key=env.get("GIPHY_API_KEY") or None,
        giphy_base_url=env.get("GIPHY_BASE_URL") or "https://api.giphy.com",
        present_host_grace_seconds=_positive_float(env, "PRESENT_HOST_GRACE_SECONDS", default=60.0),
        chess_abandon_seconds=_positive_float(env, "CHESS_ABANDON_SECONDS", default=120.0),
    )


def _bool(env: Mapping[str, str], name: str, *, default: bool) -> bool:
    value = env.get(name)
    if not value:
        return default
    if value not in ("true", "false"):
        raise ConfigError(f"{name} must be true or false, got {value!r}")
    return value == "true"


def _positive_float(env: Mapping[str, str], name: str, *, default: float) -> float:
    value = env.get(name)
    if not value:
        return default
    try:
        number = float(value)
    except ValueError:
        number = math.nan
    if not (math.isfinite(number) and number > 0):
        raise ConfigError(f"{name} must be a positive number of seconds, got {value!r}")
    return number
