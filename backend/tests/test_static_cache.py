import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import FrontendStaticFiles, StaticFileMiddleware, cache_policy

IMMUTABLE = "public, max-age=31536000, immutable"


def build_site(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><html><body>home</body></html>", encoding="utf-8")
    (tmp_path / "replay").mkdir()
    (tmp_path / "replay" / "index.html").write_text("<!doctype html><html><body>replay</body></html>", encoding="utf-8")
    (tmp_path / "replay" / "index.txt").write_text("rsc-payload", encoding="utf-8")
    static = tmp_path / "_next" / "static" / "chunks"
    static.mkdir(parents=True)
    (static / "chunk.js").write_text("console.log(1)", encoding="utf-8")
    return tmp_path


def test_cache_policy_for_documents_and_hashed_assets():
    assert cache_policy("/_next/static/chunks/chunk.js") == IMMUTABLE
    assert cache_policy("/_next/static/media/font.woff2") == IMMUTABLE
    assert cache_policy("/replay/index.txt") == "no-cache"
    assert cache_policy("/replay/index.html") == "no-cache"
    assert cache_policy("/") == "no-cache"


def test_static_file_middleware_sets_cache_headers(tmp_path):
    site = build_site(tmp_path)
    app = FastAPI()
    app.add_middleware(StaticFileMiddleware, directory=str(site))
    client = TestClient(app)

    rsc = client.get("/replay/index.txt")
    assert rsc.status_code == 200
    assert rsc.headers["cache-control"] == "no-cache"

    chunk = client.get("/_next/static/chunks/chunk.js")
    assert chunk.status_code == 200
    assert chunk.headers["cache-control"] == IMMUTABLE


def test_frontend_static_mount_sets_cache_headers(tmp_path):
    site = build_site(tmp_path)
    app = FastAPI()
    app.mount("/", FrontendStaticFiles(directory=str(site), html=True), name="frontend")
    client = TestClient(app)

    home = client.get("/")
    assert home.status_code == 200
    assert home.headers["cache-control"] == "no-cache"

    replay = client.get("/replay/")
    assert replay.status_code == 200
    assert replay.headers["cache-control"] == "no-cache"
