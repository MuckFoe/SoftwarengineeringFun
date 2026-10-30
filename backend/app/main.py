"""The app factory (constitution rule 9). Routers for other modules are added here
as they exist (tasks 29, 30, 34).
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles
from starlette.types import Receive, Scope, Send

from app import db
from app.auth.deps import current_user
from app.auth.oidc import build_oauth, session_claims, verified_access_token_claims
from app.chat.api import router as chat_router
from app.config import Settings
from app.learn import stale as learn_stale
from app.learn.api import router as learn_router
from app.learn.ws import router as learn_ws_router
from app.problems.api import router as problems_router
from app.problems.images_api import router as images_router
from app.problems.service import register_on_problem_deleted, unregister_on_problem_deleted
from app.sessions.api import router as sessions_router
from app.sessions.service import on_problem_deleted
from app.sessions.stale import run_periodically
from app.sessions.ws import drain_runs
from app.sessions.ws import router as sessions_ws_router

# backend/app/main.py -> backend/app -> backend -> repo root -> frontend/dist
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Opens the DB pool and starts the hourly stale-session job (task 26).

    Migrating and seeding the database is a one-time startup step (app/asgi.py), not
    part of this lifespan: it would otherwise re-run for every `create_app()` call,
    including every test's.
    """
    pool = await db.create_pool(app.state.settings.database_url)
    app.state.pool = pool

    async def _on_problem_deleted(problem_id: uuid.UUID) -> None:
        async with pool.acquire() as conn:
            await on_problem_deleted(conn, problem_id)

    register_on_problem_deleted(_on_problem_deleted)
    stale_task = asyncio.create_task(run_periodically(pool))
    learn_stale_task = asyncio.create_task(learn_stale.run_periodically(pool))
    try:
        yield
    finally:
        unregister_on_problem_deleted(_on_problem_deleted)
        stale_task.cancel()
        learn_stale_task.cancel()
        await drain_runs()
        await pool.close()


def app_path(request: Request) -> str:
    """Request path relative to the mount (scope `root_path` removed). Every in-app path
    test, such as the SPA fallback's `/api/` check, uses this, never `request.url.path`."""
    path: str = request.scope["path"]
    root_path: str = request.scope.get("root_path", "")
    return path[len(root_path) :] if root_path and path.startswith(root_path) else path


def safe_next(next: str) -> str:
    """An app-relative path to return to after sign-in; anything that could leave the app
    (`//host`, `/\\host`, an absolute URL) becomes "/"."""
    if not next.startswith("/") or next.startswith(("//", "/\\")):
        return "/"
    return next


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_cookie_key,
        max_age=settings.session_max_age_seconds,
        # Scoped to this app on a shared host (spec 005 FR3).
        session_cookie=settings.session_cookie_name,
        path=settings.base_path or "/",
        https_only=settings.cookie_secure,
    )
    oauth = build_oauth(settings)
    app.include_router(problems_router)
    app.include_router(images_router)
    app.include_router(sessions_router)
    app.include_router(chat_router)
    app.include_router(sessions_ws_router)
    app.include_router(learn_router)
    app.include_router(learn_ws_router)

    @app.exception_handler(HTTPException)
    async def _http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        # The HTTP contract's error bodies (e.g. {error: "missing_role", role}) are not
        # wrapped in {"detail": ...}, unlike FastAPI's default handler.
        body = exc.detail if isinstance(exc.detail, dict) else {"detail": exc.detail}
        return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)

    @app.get("/api/auth/login")
    async def login(request: Request, next: str = "/", appearance: str | None = None) -> Response:
        request.session["next"] = safe_next(next)
        if settings.public_base_url:
            redirect_uri = f"{settings.public_base_url}/api/auth/callback"
        else:
            redirect_uri = str(request.url_for("auth_callback"))
        # Spec 003 FR-18: the login theme reads this hint from its URL; anything else is dropped.
        extra = {"appearance": appearance} if appearance in ("light", "dark") else {}
        return await oauth.keycloak.authorize_redirect(request, redirect_uri, **extra)

    @app.get("/api/auth/callback", name="auth_callback")
    async def auth_callback(request: Request) -> Response:
        token = await oauth.keycloak.authorize_access_token(request)
        access_claims = await verified_access_token_claims(oauth.keycloak, token)
        settings = app.state.settings
        claims = session_claims(
            access_claims, settings.oidc_client_id, settings.session_max_age_seconds
        )
        next_url = safe_next(request.session.get("next", "/"))
        request.session.clear()
        request.session.update(claims)
        return RedirectResponse(settings.base_path + next_url)

    @app.post("/api/auth/logout", status_code=204)
    async def logout(request: Request) -> Response:
        request.session.clear()
        return Response(status_code=204)

    @app.get("/api/me")
    async def me(request: Request) -> JSONResponse:
        user = current_user(request)
        if user is None:
            return JSONResponse({"signed_in": False, "roles": []})
        return JSONResponse({"signed_in": True, "name": user.name, "roles": user.roles})

    if (FRONTEND_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    async def _spa_fallback(scope: Scope, receive: Receive, send: Send) -> None:
        # Reached only once every route (including any added after create_app() returns,
        # e.g. in tests) has failed to match. Any non-API path falls back to the SPA shell;
        # the frontend's own router decides what to render client-side.
        request = Request(scope, receive=receive)
        if app_path(request).startswith("/api/"):
            response: Response = JSONResponse({"error": "not_found"}, status_code=404)
        else:
            response = FileResponse(FRONTEND_DIST / "index.html")
        await response(scope, receive, send)

    app.router.default = _spa_fallback

    return app
