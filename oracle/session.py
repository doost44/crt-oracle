"""Session: one visitor's walk through the story."""

from __future__ import annotations

import random

from oracle.personalities import Personality, _Safe
from oracle.story import Node, Story


class Session:
    def __init__(
        self,
        story: Story,
        personalities: dict[str, Personality],
        rng: random.Random | None = None,
        mishear_rate: float = 0.25,
    ) -> None:
        self.story = story
        self.personalities = personalities
        self.rng = rng or random.Random()
        self.mishear_rate = mishear_rate
        self.node_id = story.start
        self.personality: Personality | None = None
        self.answers: dict[str, str] = {}  # what the visitor typed
        self.heard: dict[str, str] = {}  # what the Oracle claims it heard
        self.path: list[str] = []

    # --- reading state -------------------------------------------------
    @property
    def node(self) -> Node:
        return self.story.nodes[self.node_id]

    @property
    def finished(self) -> bool:
        return self.node.type == "end"

    def text(self, node: Node | None = None) -> str:
        """Resolve a node's text for the current personality, filling in {answers}."""
        node = node or self.node
        raw = node.text
        if isinstance(raw, dict):
            pid = self.personality.id if self.personality else "default"
            raw = raw.get(pid, raw.get("default", ""))
        return str(raw).format_map(_Safe(self.heard))

    # --- moving through the story -------------------------------------
    def _go(self, target: str) -> None:
        self.path.append(self.node_id)
        self.node_id = target

    def choose(self, index: int) -> None:
        node = self.node
        if node.type != "choice":
            raise ValueError(f"node '{node.id}' is not a choice")
        option = node.options[index]
        if option.personality:
            self.personality = self.personalities[option.personality]
        self._go(option.next)

    def answer(self, text: str) -> tuple[str, bool]:
        """Record an answer. Returns (what the Oracle heard, whether it misheard)."""
        node = self.node
        if node.type != "ask":
            raise ValueError(f"node '{node.id}' is not an ask")
        heard, misheard = text, False
        if self.personality and text.strip() and self.rng.random() < self.mishear_rate:
            twisted = self.personality.mishear(text, self.rng)
            if twisted != text:
                heard, misheard = twisted, True
        self.answers[node.key] = text
        self.heard[node.key] = heard
        self._go(node.next)
        return heard, misheard

    def advance(self) -> None:
        node = self.node
        if node.type not in ("say", "mash"):
            raise ValueError(f"node '{node.id}' cannot simply advance")
        self._go(node.next)

    # --- the Oracle talking --------------------------------------------
    def reaction(self) -> str | None:
        return self.personality.reaction(self.rng) if self.personality else None

    def interruption(self, emotion: str = "unreadable") -> str | None:
        return self.personality.interruption(self.rng, emotion) if self.personality else None

    def verdict_lines(self) -> list[str]:
        if not self.personality:
            return ["I CANNOT JUDGE SOMEONE WHO WILL NOT CHOOSE."]
        return self.personality.verdict(self.heard)
