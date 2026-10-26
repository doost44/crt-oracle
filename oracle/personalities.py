"""Personalities: the Oracle's voices, loaded from content/personalities/*.yaml."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

import yaml


class _Safe(dict):
    """format_map helper: unknown {keys} become 'nothing' instead of an error."""

    def __missing__(self, key: str) -> str:
        return "nothing"


@dataclass
class Personality:
    id: str
    name: str
    symbol: str
    reactions: list[str]
    interruptions: list[str]
    mishear_template: str
    mishear_words: list[str]
    verdict_header: str
    verdict_lines: list[str]
    verdict_footer: str
    extras: dict = field(default_factory=dict)

    def reaction(self, rng: random.Random) -> str:
        return rng.choice(self.reactions)

    def interruption(self, rng: random.Random, emotion: str = "unreadable") -> str:
        return rng.choice(self.interruptions).format_map(_Safe(emotion=emotion))

    def mishear(self, answer: str, rng: random.Random) -> str:
        """Return `answer` with one word swapped for something the Oracle 'heard'."""
        words = answer.split()
        if not words:
            return answer
        index = rng.randrange(len(words))
        options = [w for w in self.mishear_words if w.lower() != words[index].lower()]
        if options:
            words[index] = rng.choice(options)
        return " ".join(words)

    def mishear_line(self, heard: str) -> str:
        return self.mishear_template.format_map(_Safe(heard=heard))

    def verdict(self, answers: dict[str, str]) -> list[str]:
        safe = _Safe(answers)
        return [line.format_map(safe) for line in self.verdict_lines]


def load_personality(path: str | Path) -> Personality:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    verdict = data.get("verdict", {})
    return Personality(
        id=data["id"],
        name=data["name"],
        symbol=data["symbol"],
        reactions=list(data["reactions"]),
        interruptions=list(data["interruptions"]),
        mishear_template=data["mishear"]["template"],
        mishear_words=list(data["mishear"]["words"]),
        verdict_header=verdict.get("header", "VERDICT"),
        verdict_lines=list(verdict.get("lines", [])),
        verdict_footer=verdict.get("footer", ""),
    )


def load_personalities(directory: str | Path) -> dict[str, Personality]:
    found: dict[str, Personality] = {}
    for path in sorted(Path(directory).glob("*.yaml")):
        personality = load_personality(path)
        found[personality.id] = personality
    return found
