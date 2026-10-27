"""Serve the web Oracle with the live conversation, on this computer.

    python -m oracle.server            # Claude if ANTHROPIC_API_KEY is set, otherwise the mock
    python -m oracle.server --mock     # always the offline mock (no key, no cost)
    python -m oracle.server --claude   # always Claude; stops if there is no key

Then open http://localhost:8000 for the Oracle and
http://localhost:8000/operator.html for the hidden operator panel.

The API key never leaves this process: the page only ever talks to this
server, and the server talks to Anthropic. Standard library only, apart from
the `anthropic` package in Claude mode (pip install -e ".[live]").
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import secrets
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from oracle.config import load_config
from oracle.conversation import MockBrain, load_prompts, make_brain
from oracle.conversation.session import MAX_INPUT_CHARS, Conversations

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MAX_BODY = 16 * 1024


class OracleHandler(BaseHTTPRequestHandler):
    server_version = "CRTOracle/0.1"
    conversations: Conversations = None  # set by make_server
    operator_key: str = ""
    live_config: dict = {}

    def log_message(self, fmt, *args):  # keep the console quiet except for errors
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    # --- helpers ------------------------------------------------------------------------

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status: int = 200) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message}, status)

    def _body(self) -> dict | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self._error(413, "too much")
            return None
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self._error(400, "not JSON")
            return None
        if not isinstance(data, dict):
            self._error(400, "not an object")
            return None
        return data

    def _operator_ok(self, query: dict) -> bool:
        if not self.operator_key:
            return True
        given = (query.get("key") or [""])[0]
        if secrets.compare_digest(given, self.operator_key):
            return True
        self._error(403, "operator key needed")
        return False

    # --- routes -------------------------------------------------------------------------

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        path = url.path
        if path == "/data/live.js":
            # Tells the page that the live conversation is here (on GitHub Pages it's a stub).
            body = "window.ORACLE_LIVE = " + json.dumps(self.live_config) + ";\n"
            return self._send(200, body.encode("utf-8"), "text/javascript; charset=utf-8")
        if path == "/api/health":
            return self._json({"ok": True, **self.live_config})
        if path == "/api/operator/sessions":
            if self._operator_ok(query):
                self._json({"brain": self.live_config["brain"], "sessions": [c.summary() for c in self.conversations.all()]})
            return
        if path.startswith("/api/operator/sessions/"):
            if not self._operator_ok(query):
                return
            conv = self.conversations.get(path.rsplit("/", 1)[-1])
            if conv is None:
                return self._error(404, "no such conversation")
            since = int((query.get("since") or ["0"])[0] or 0)
            return self._json({**conv.summary(), "events": conv.events[since:]})
        if path.startswith("/api/"):
            return self._error(404, "no such endpoint")
        return self._static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._body()
        if data is None:
            return
        try:
            if path == "/api/session":
                conv = self.conversations.new(str(data.get("symbol", "")))
                reply = conv.start()
                return self._json({"id": conv.id, **reply.public()})
            conv = self.conversations.get(str(data.get("id", "")))
            if conv is None:
                return self._error(404, "no such conversation")
            if path == "/api/turn":
                seconds = data.get("seconds")
                reply = conv.answer(
                    str(data.get("text", "")),
                    float(seconds) if isinstance(seconds, (int, float)) else None,
                    str(data["camera"])[:200] if data.get("camera") else None,
                )
                return self._json(reply.public())
            if path == "/api/receipt":
                return self._json({"receipt": conv.finish(), "personality": conv.personality})
        except ValueError as exc:
            return self._error(400, str(exc))
        return self._error(404, "no such endpoint")

    def _static(self, path: str):
        if path.endswith("/"):
            path += "index.html"
        file = (WEB / path.lstrip("/")).resolve()
        if WEB not in file.parents or not file.is_file():
            return self._error(404, "not found")
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, file.read_bytes(), ctype)


def make_server(host: str, port: int, mode: str, cfg: dict, operator_key: str = "", log: bool = True):
    live = cfg.get("live", {})
    prompts = load_prompts(live.get("prompts_dir", "content/oracle"))
    personalities_dir = cfg["story"]["personalities_dir"]
    brain = make_brain(mode, prompts, live, personalities_dir)
    backup = brain if isinstance(brain, MockBrain) else MockBrain(prompts, personalities_dir)
    log_dir = Path(live.get("log_dir", "out/sessions")) if log else None
    handler = type("Handler", (OracleHandler,), {})
    handler.conversations = Conversations(brain, backup, live, log_dir)
    handler.operator_key = operator_key
    handler.live_config = {"api": "api", "brain": brain.name, "maxInput": MAX_INPUT_CHARS}
    return ThreadingHTTPServer((host, port), handler), brain


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m oracle.server", description=__doc__.split("\n\n")[0])
    which = parser.add_mutually_exclusive_group()
    which.add_argument("--mock", action="store_const", dest="mode", const="mock", help="offline mock, no API key")
    which.add_argument("--claude", action="store_const", dest="mode", const="claude", help="Claude (needs ANTHROPIC_API_KEY)")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to watch the operator panel from another device")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-log", action="store_true", help="don't write out/sessions/*.jsonl")
    args = parser.parse_args(argv)

    os.chdir(ROOT)
    cfg = load_config(args.config)
    mode = args.mode or cfg.get("live", {}).get("brain", "auto")
    if mode == "claude" and not os.environ.get("ANTHROPIC_API_KEY"):
        print("No ANTHROPIC_API_KEY set. Set it, or run with --mock.", file=sys.stderr)
        return 2
    key = os.environ.get("ORACLE_OPERATOR_KEY", "")
    if args.host not in ("127.0.0.1", "localhost") and not key:
        key = secrets.token_urlsafe(8)
    server, brain = make_server(args.host, args.port, mode, cfg, key, log=not args.no_log)
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    print(f"The Oracle ({brain.name}) is at http://{shown}:{args.port}/")
    print(f"Operator panel: http://{shown}:{args.port}/operator.html" + (f"?key={key}" if key else ""))
    if brain.name == "mock":
        print("Mock mode: canned replies, no API key, no cost.")
    print("Ctrl+C stops it.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
