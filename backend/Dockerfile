# The api image (plan.md "Deploy"): builds the frontend, then the api that serves it.
# Build context is the repo root (docker-compose.yml already sets this).

FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir uv

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/app ./app

# Mirrors the repo's layout, so main.py's FRONTEND_DIST and SEED_DIR (both resolved
# relative to backend/app/) find their siblings.
COPY --from=frontend-builder /frontend/dist /app/frontend/dist
COPY seed /app/seed

EXPOSE 8000
# The venv's own uvicorn, not `uv run`: the latter re-resolves (and, for this frozen,
# --no-dev sync, re-downloads the dev group) on every container start.
# --workers 1: the in-memory session hub (sessions/hub.py) assumes a single process.
CMD ["/app/backend/.venv/bin/uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--ws-ping-interval", "2", "--ws-ping-timeout", "3"]
