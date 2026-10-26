import json
import shutil
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from shelf_admin import yamlio
from shelf_admin.model import load_yaml
from shelf_admin.server import make_server

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "collection.yaml"


@pytest.fixture
def yaml_copy(tmp_path):
    p = tmp_path / "collection.yaml"
    shutil.copy(SAMPLE, p)
    return p


def test_unchanged_save_is_byte_identical(yaml_copy):
    yamlio.save(yaml_copy, load_yaml(yaml_copy))
    assert yaml_copy.read_bytes() == SAMPLE.read_bytes()


def test_save_keeps_comments_and_compact_style(yaml_copy):
    data = load_yaml(yaml_copy)
    data["storages"].append({"id": "k", "name": "K", "type": "kallax", "rows": 1, "cols": 1, "cells": [{"at": [1, 1], "kind": "open", "layout": "standing", "games": ["new"]}]})
    data["games"]["new"] = {"name": "New Game", "size": "small"}
    yamlio.save(yaml_copy, data)
    text = yaml_copy.read_text(encoding="utf-8")
    assert text.startswith("# Source of truth")
    assert "\n# id: {name" in text and text.index("\n# id: {name") < text.index("\ngames:")
    assert "- {at: [1, 1], kind: open, layout: standing, games: [new]}" in text
    assert 'new: {name: "New Game", size: small}' in text
    assert load_yaml(yaml_copy) == data


def test_save_preserves_crlf(yaml_copy):
    yaml_copy.write_bytes(SAMPLE.read_bytes().replace(b"\n", b"\r\n"))
    data = load_yaml(yaml_copy)
    data["games"]["azul"]["size"] = "standard"
    yamlio.save(yaml_copy, data)
    raw = yaml_copy.read_bytes()
    assert raw.count(b"\r\n") == raw.count(b"\n")


@pytest.fixture
def server(tmp_path, yaml_copy):
    site = tmp_path / "site"
    site.mkdir()
    (site / "style.css").write_text("body{}", encoding="utf-8")
    srv = make_server(0, yaml_copy, tmp_path / "bgg.json", site)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", yaml_copy, site
    srv.shutdown()


def call(url, method="GET", body=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_serves_page_and_site_assets(server):
    base, _, _ = server
    assert call(base + "/")[0] == 200
    assert call(base + "/site/style.css") == (200, b"body{}")
    assert call(base + "/site/../collection.yaml")[0] == 404


def test_rejects_foreign_host(server):
    base, _, _ = server
    assert call(base + "/api/collection", headers={"Host": "evil.example"})[0] == 403


def test_put_saves_yaml_and_builds_site(server):
    base, path, site = server
    snap = json.loads(call(base + "/api/collection")[1])
    snap["data"]["storages"][1]["shelves"][0]["games"].reverse()
    status, body = call(base + "/api/collection", "PUT", {"data": snap["data"], "version": snap["version"]})
    assert status == 200
    assert json.loads(body)["version"] == yamlio.version(path)
    assert load_yaml(path) == snap["data"]
    out = json.loads((site / "collection.json").read_text(encoding="utf-8"))
    assert out["storages"][1]["shelves"][0]["games"][0] == "photosynthesis"


def test_put_rejects_invalid_data(server):
    base, path, _ = server
    before = path.read_bytes()
    snap = json.loads(call(base + "/api/collection")[1])
    snap["data"]["storages"][1]["shelves"][0]["games"].append("ghost")
    status, body = call(base + "/api/collection", "PUT", {"data": snap["data"], "version": snap["version"]})
    assert status == 422 and any("ghost" in e for e in json.loads(body)["errors"])
    assert path.read_bytes() == before


def test_put_refuses_stale_version(server):
    base, path, _ = server
    snap = json.loads(call(base + "/api/collection")[1])
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    status, _ = call(base + "/api/collection", "PUT", {"data": snap["data"], "version": snap["version"]})
    assert status == 409


def test_validate_endpoint(server):
    base, _, _ = server
    status, body = call(base + "/api/validate", "POST", {"data": {"storages": [{"id": "x", "type": "nope"}], "games": {}}})
    assert status == 200 and json.loads(body)["errors"]
