"""015 task 11: `/brand/*` is served unauthenticated from the brand-assets directory, with an
empty stylesheet when nothing is mounted (FR-3, FR-11). No database: the lifespan is not run."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.asgi import build_app
from app.config import Settings


def _client(brand_dir: str, base_path: str = "") -> TestClient:
    settings = Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url="postgresql://unused",
        runner_url="http://unused",
        base_path=base_path,
        brand_assets_dir=brand_dir,
    )
    return TestClient(build_app(settings))


def test_no_mount_serves_an_empty_stylesheet(tmp_path: Path) -> None:
    r = _client(str(tmp_path / "missing")).get("/brand/brand.css")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/css")
    assert "@font-face" not in r.text
    assert r.text.strip() == ""


def test_other_paths_without_a_mount_are_404_not_html(tmp_path: Path) -> None:
    r = _client(str(tmp_path / "missing")).get("/brand/fonts/x.woff2")
    assert r.status_code == 404
    assert "text/html" not in r.headers["content-type"]


def test_mount_without_brand_css_still_serves_empty_stylesheet(tmp_path: Path) -> None:
    r = _client(str(tmp_path)).get("/brand/brand.css")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/css")


def test_mounted_files_are_served_unauthenticated_under_the_base_path(tmp_path: Path) -> None:
    (tmp_path / "brand.css").write_text(".brand-logo { display: block; }\n")
    (tmp_path / "logo.svg").write_text("<svg viewBox='0 0 3 1'/>")
    client = _client(str(tmp_path), base_path="/collab")
    css = client.get("/collab/brand/brand.css")
    assert css.status_code == 200
    assert css.headers["content-type"].startswith("text/css")
    assert ".brand-logo" in css.text
    assert client.get("/collab/brand/logo.svg").status_code == 200
    assert client.get("/collab/brand/nope.svg").status_code == 404


@pytest.mark.parametrize("path", ["/brand/../main.py", "/brand/%2e%2e/x"])
def test_no_path_traversal(tmp_path: Path, path: str) -> None:
    (tmp_path / "brand.css").write_text("x{}")
    assert "text/x-python" not in _client(str(tmp_path)).get(path).headers.get("content-type", "")
