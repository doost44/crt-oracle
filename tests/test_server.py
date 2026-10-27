"""oracle/server.py in mock mode: the page, the API and the operator panel,
over real HTTP on a free port. No API key, no network beyond localhost."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

from oracle.config import load_config
from oracle.server import make_server


def _start(tmp_path, key=""):
    cfg = load_config()
    cfg["live"]["log_dir"] = str(tmp_path)
    server, brain = make_server("127.0.0.1", 0, "mock", cfg, operator_key=key)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


@pytest.fixture
def oracle(tmp_path, monkeypatch, root):
    monkeypatch.chdir(root)
    server, base = _start(tmp_path)
    yield base
    server.shutdown()
    server.server_close()


def get(url):
    with urllib.request.urlopen(url, timeout=5) as res:
        return res.status, res.headers.get("Content-Type", ""), res.read().decode("utf-8")


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read())


def status_of(fn, *args):
    try:
        fn(*args)
    except urllib.error.HTTPError as err:
        return err.code
    return 200


def test_page_and_live_switch(oracle):
    status, ctype, body = get(oracle + "/")
    assert status == 200 and "text/html" in ctype and "data/live.js" in body
    _, ctype, live = get(oracle + "/data/live.js")
    assert "javascript" in ctype
    config = json.loads(live.split("=", 1)[1].strip().rstrip(";"))
    assert config["brain"] == "mock" and config["api"] == "api"
    assert get(oracle + "/operator.html")[0] == 200


def test_whole_conversation_over_http(oracle):
    start = post(oracle + "/api/session", {"symbol": "tree"})
    assert start["personality"] == "clinical" and start["lines"]
    assert set(start) == {"id", "personality", "lines", "end"}, "operator notes leaked to the page"
    reply = start
    for _ in range(20):
        reply = post(oracle + "/api/turn", {"id": start["id"], "text": "no", "seconds": 4})
        assert set(reply) == {"personality", "lines", "end"}
        if reply["end"]:
            break
    assert reply["end"]
    receipt = post(oracle + "/api/receipt", {"id": start["id"]})["receipt"]
    assert "WHAT YOU SAID" in receipt

    sessions = json.loads(get(oracle + "/api/operator/sessions")[2])["sessions"]
    assert sessions[0]["id"] == start["id"] and sessions[0]["ended"]
    events = json.loads(get(oracle + f"/api/operator/sessions/{start['id']}?since=2")[2])["events"]
    assert events[0]["seq"] == 2 and events[-1]["type"] == "receipt"
    assert any(e.get("observation") for e in events if e["type"] == "oracle")


def test_bad_requests(oracle):
    assert status_of(post, oracle + "/api/session", {"symbol": "moon"}) == 400
    assert status_of(post, oracle + "/api/turn", {"id": "nope", "text": "hi"}) == 404
    assert status_of(post, oracle + "/api/turn", ["not", "an", "object"]) == 400
    assert status_of(get, oracle + "/api/nothing") == 404
    assert status_of(get, oracle + "/..%2f..%2fconfig.yaml") == 404
    assert status_of(get, oracle + "/../config.yaml") == 404


def test_operator_key(tmp_path, monkeypatch, root):
    monkeypatch.chdir(root)
    server, base = _start(tmp_path, key="s3cret")
    try:
        assert status_of(get, base + "/api/operator/sessions") == 403
        assert status_of(get, base + "/api/operator/sessions?key=wrong") == 403
        assert get(base + "/api/operator/sessions?key=s3cret")[0] == 200
        # The visitor's side needs no key.
        assert post(base + "/api/session", {"symbol": "sun"})["lines"]
    finally:
        server.shutdown()
        server.server_close()
