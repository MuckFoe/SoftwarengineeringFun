"""OIDC Authorization Code + PKCE against Keycloak (plan.md "Single sign-on").

Authlib drives the flow and validates the ID token against Keycloak's JWKS (signature,
issuer, audience, expiry, nonce) -- hand-rolled JWT checks are a security risk (plan.md,
constitution rule 5). `session_claims` reduces the result to exactly the fields the app's
session cookie stores (NFR-8): `sub`, `name`, `roles`, and `exp`, when this site's sign-in
ends (`auth/deps.py` enforces it).
"""

from datetime import timedelta
from typing import Any

from authlib.integrations.starlette_client import OAuth, StarletteOAuth2App
from authlib.jose import JsonWebKey, jwt

from app import clock
from app.config import Settings

KEYCLOAK = "keycloak"


def build_oauth(settings: Settings) -> OAuth:
    oauth = OAuth()
    oauth.register(
        name=KEYCLOAK,
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=f"{settings.oidc_issuer}/.well-known/openid-configuration",
        client_kwargs={"scope": "openid", "code_challenge_method": "S256"},
    )
    return oauth


async def verified_access_token_claims(
    app: StarletteOAuth2App, token: dict[str, Any]
) -> dict[str, Any]:
    """Validate the access token's signature against Keycloak's JWKS (NFR-8) and decode it.

    Realm roles (`realm_access.roles`) are carried by Keycloak's access token, not its ID
    token or userinfo response, under this project's realm (`tests/keycloak/realm.json`).
    """
    jwks = await app.fetch_jwk_set()
    claims = jwt.decode(token["access_token"], key=JsonWebKey.import_key_set(jwks))
    claims.validate()
    return dict(claims)


def session_claims(claims: dict[str, Any], max_age_seconds: int) -> dict[str, Any]:
    """The validated claims, reduced to what the session cookie may hold (NFR-8).

    `exp` is this site's sign-in expiry, not the access token's (minutes, in Keycloak).
    """
    roles = sorted(claims.get("realm_access", {}).get("roles", []))
    expires = clock.now() + timedelta(seconds=max_age_seconds)
    return {
        "sub": claims["sub"],
        "name": claims.get("preferred_username", claims["sub"]),
        "roles": roles,
        "exp": int(expires.timestamp()),
    }
