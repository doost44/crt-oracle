"""One visitor's conversation with the live Oracle, and the log it leaves.

Every event (the Oracle's lines, the visitor's answers, switches, errors, the
receipt) is appended to out/sessions/<time>-<id>.jsonl as it happens, and kept
in memory for the operator panel. Nothing from the camera is stored.
"""

from __future__ import annotations

import json
import random
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path

from oracle.conversation.brains import BrainError, MockBrain, Reading, Reply
from oracle.conversation.prompts import SYMBOLS
from oracle.conversation.receipt import format_reading

MAX_INPUT_CHARS = 240


class Conversation:
    def __init__(self, symbol: str, brain, backup: MockBrain, cfg: dict, log_dir: Path | None, voices: dict):
        if symbol not in SYMBOLS:
            raise ValueError(f"unknown symbol: {symbol!r}")
        self.id = secrets.token_hex(4)
        self.symbol = symbol
        self.personality = SYMBOLS[symbol]
        self.brain = brain
        self.backup = backup
        self.voices = voices
        self.max_turns = int(cfg.get("max_turns", 8))
        self.width = int(cfg.get("receipt_width", 32))
        self.rng = random.Random()
        self.history: list[dict] = []  # API messages, for ClaudeBrain
        self.events: list[dict] = []
        self.turns = 0  # visitor answers so far
        self.turns_since_switch = 0
        self.spoken = [self.personality]  # each mask in the order it took over
        self.ended = False
        self.receipt: str | None = None
        self.started = time.time()
        self.updated = self.started
        self.lock = threading.Lock()
        self.log_path = None
        if log_dir is not None:
            log_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            self.log_path = log_dir / f"{stamp}-{self.id}.jsonl"
        self._event("start", symbol=symbol, personality=self.personality, brain=brain.name)

    # --- events -------------------------------------------------------------------------

    def _event(self, kind: str, **data) -> dict:
        self.updated = time.time()
        event = {"seq": len(self.events), "t": datetime.now().isoformat(timespec="seconds"), "type": kind, **data}
        self.events.append(event)
        if self.log_path is not None:
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event

    def summary(self) -> dict:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "personality": self.personality,
            "brain": self.brain.name,
            "turns": self.turns,
            "max_turns": self.max_turns,
            "ended": self.ended,
            "started": datetime.fromtimestamp(self.started).isoformat(timespec="seconds"),
            "updated": self.updated,
            "events": len(self.events),
        }

    # --- the conversation ---------------------------------------------------------------

    def _ask(self, visitor_text: str | None, room: dict) -> Reply:
        try:
            reply = self.brain.reply(self, visitor_text, room)
        except BrainError as exc:
            self._event("error", where="reply", message=str(exc)[:500])
            reply = self.backup.reply(self, visitor_text, room)
            reply.source = "fallback"
            if self.history and self.history[-1]["role"] == "user":
                # Keep Claude's history in step with what was actually said.
                self.history.append({"role": "assistant", "content": json.dumps(reply.as_dict())})
        if reply.personality != self.personality:
            self._event("switch", frm=self.personality, to=reply.personality)
            self.personality = reply.personality
            self.turns_since_switch = 0
            self.spoken.append(reply.personality)
        else:
            self.turns_since_switch += 1
        if reply.end:
            self.ended = True
        self._event(
            "oracle",
            personality=reply.personality,
            lines=reply.lines,
            end=reply.end,
            observation=reply.observation,
            seed=reply.seed,
            source=reply.source,
            usage=reply.usage,
        )
        return reply

    def start(self) -> Reply:
        with self.lock:
            return self._ask(None, {"turn": 0, "max_turns": self.max_turns})

    def answer(self, text: str, seconds: float | None = None, camera: str | None = None) -> Reply:
        with self.lock:
            if self.ended:
                raise ValueError("the conversation is over")
            text = " ".join(str(text).split())[:MAX_INPUT_CHARS] or "(nothing)"
            if seconds is not None:
                seconds = max(0.0, min(float(seconds), 3600.0))
            self.turns += 1
            self._event("visitor", text=text, seconds=seconds, camera=camera)
            room = {
                "turn": self.turns,
                "max_turns": self.max_turns,
                "seconds": seconds,
                "camera": camera,
                "final": self.turns >= self.max_turns,
            }
            return self._ask(text, room)

    def finish(self, now: datetime | None = None) -> str:
        with self.lock:
            if self.receipt is not None:
                return self.receipt
            self.ended = True
            try:
                reading: Reading = self.brain.reading(self)
            except BrainError as exc:
                self._event("error", where="receipt", message=str(exc)[:500])
                reading = self.backup.reading(self)
                reading.source = "fallback"
            self.receipt = format_reading(
                reading, self.voices.get(self.personality), self.spoken, self.width, now
            )
            self._event("receipt", text=self.receipt, source=reading.source)
            return self.receipt


class Conversations:
    """Every conversation since the server started (old ones are dropped after an hour)."""

    KEEP_SECONDS = 3600

    def __init__(self, brain, backup: MockBrain, cfg: dict, log_dir: Path | None):
        self.brain = brain
        self.backup = backup
        self.cfg = cfg
        self.log_dir = log_dir
        self.items: dict[str, Conversation] = {}
        self.lock = threading.Lock()

    def new(self, symbol: str) -> Conversation:
        conv = Conversation(symbol, self.brain, self.backup, self.cfg, self.log_dir, self.backup.voices)
        with self.lock:
            cutoff = time.time() - self.KEEP_SECONDS
            for key in [k for k, c in self.items.items() if c.updated < cutoff]:
                del self.items[key]
            self.items[conv.id] = conv
        return conv

    def get(self, conv_id: str) -> Conversation | None:
        with self.lock:
            return self.items.get(conv_id)

    def all(self) -> list[Conversation]:
        with self.lock:
            return sorted(self.items.values(), key=lambda c: c.started, reverse=True)
