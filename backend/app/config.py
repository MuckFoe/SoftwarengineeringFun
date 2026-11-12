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
    # Spec 015: where the brand assets (fonts, icons, logo, brand.css) are mounted.
    brand_assets_dir: str = "/app/brand-assets"
    # Next-step hints (spec 020). Unset base URL means hints are off everywhere (FR-2).
    # The base URL is OpenAI-compatible and includes /v1.
    hint_llm_base_url: str | None = None
    hint_llm_model: str | None = None
    hint_llm_api_key: str | None = field(default=None, repr=False)
    hint_llm_timeout_seconds: float = 20.0
    # The model call's timeout when the model is cold (FR-14a).
    hint_llm_cold_timeout_seconds: float = 110.0
    # Sent as reasoning_effort; "" omits it.
    hint_llm_reasoning_effort: str = "none"
    # Whole-pipeline deadlines, not read from the environment; tests construct smaller ones.
    hint_deadline_seconds: float = 28.0
    hint_cold_deadline_seconds: float = 118.0


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    missing = [name for name in REQUIRED if not env.get(name)]
    if missing:
        raise ConfigError(f"missing required environment variables: {', '.join(missing)}")
    base_path = env.get("BASE_PATH") or ""
    if not BASE_PATH_RE.fullmatch(base_path):
        raise ConfigError(f"BASE_PATH must look like /collab, got {base_path!r}")
    hint_llm_base_url = env.get("HINTS_LLM_BASE_URL") or None
    hint_llm_model = env.get("HINTS_LLM_MODEL") or None
    if hint_llm_base_url and not hint_llm_model:
        raise ConfigError("HINTS_LLM_MODEL is required when HINTS_LLM_BASE_URL is set")
    hint_llm_timeout = _timeout_below(
        env, "HINTS_LLM_TIMEOUT_SECONDS", default=20.0, deadline=Settings.hint_deadline_seconds
    )
    hint_llm_cold_timeout = _timeout_below(
        env,
        "HINTS_LLM_COLD_TIMEOUT_SECONDS",
        default=110.0,
        deadline=Settings.hint_cold_deadline_seconds,
    )
    reasoning_effort = env.get("HINTS_LLM_REASONING_EFFORT")
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
        brand_assets_dir=env.get("BRAND_ASSETS_DIR") or "/app/brand-assets",
        hint_llm_base_url=hint_llm_base_url,
        hint_llm_model=hint_llm_model,
        hint_llm_api_key=env.get("HINTS_LLM_API_KEY") or None,
        hint_llm_timeout_seconds=hint_llm_timeout,
        hint_llm_cold_timeout_seconds=hint_llm_cold_timeout,
        hint_llm_reasoning_effort="none" if reasoning_effort is None else reasoning_effort,
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


def _timeout_below(env: Mapping[str, str], name: str, *, default: float, deadline: float) -> float:
    timeout = _positive_float(env, name, default=default)
    if timeout >= deadline:
        raise ConfigError(f"{name} must be below the {deadline:g} second deadline, got {timeout:g}")
    return timeout
