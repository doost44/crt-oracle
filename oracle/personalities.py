"""Personalities: the Oracle's voices, loaded from content/personalities/*.yaml.

YAML fields (see docs/PERSONALITIES.md):
  id, name, symbol
  reactions:      list of lines said after a normal answer
  interruptions:  list of lines with {emotion} (a deliberately wrong guess)
  mishear:
    lines:        list of templates with {heard}   (or the older single `template:`)
    words:        substitute words/phrases swapped into an answer
  receipt:        (the older `verdict:` section is still read as a fallback)
    title:        banner at the top of the receipt
    heard_note:   the line under "WHAT YOU SAID", e.g. "(as I heard it)"
    header:       heading above the verdict lines (also shown on screen)
    lines:        verdict lines; may use {proud}, {worry}, {wish}
    footer:       sign-off
    fine_print:   list; one is picked at random per receipt
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_TITLE = "THE ORACLE HAS SPOKEN"
DEFAULT_HEARD_NOTE = "(as I heard it)"


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
    mishear_lines: list[str] = field(default_factory=list)
    receipt_title: str = DEFAULT_TITLE
    heard_note: str = DEFAULT_HEARD_NOTE
    fine_print: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.mishear_lines and self.mishear_template:
            self.mishear_lines = [self.mishear_template]
        if not self.mishear_template and self.mishear_lines:
            self.mishear_template = self.mishear_lines[0]

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

    def mishear_line(self, heard: str, rng: random.Random | None = None) -> str:
        """Pick one of the mishear lines (with `rng` if given) and fill in {heard}."""
        lines = self.mishear_lines or [self.mishear_template or "'{heard}'."]
        template = (rng or random).choice(lines)
        return template.format_map(_Safe(heard=heard))

    def verdict(self, answers: dict[str, str]) -> list[str]:
        safe = _Safe(answers)
        return [line.format_map(safe) for line in self.verdict_lines]

    def fine_print_line(self, rng: random.Random | None = None) -> str:
        return (rng or random).choice(self.fine_print) if self.fine_print else ""


def load_personality(path: str | Path) -> Personality:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    # `receipt:` is the current section; `verdict:` is the older name. Keys in
    # `receipt:` win when both are present.
    receipt = {**(data.get("verdict") or {}), **(data.get("receipt") or {})}
    mishear = data.get("mishear") or {}
    lines = list(mishear.get("lines") or [])
    template = mishear.get("template") or (lines[0] if lines else "")
    if template and not lines:
        lines = [template]
    return Personality(
        id=data["id"],
        name=data["name"],
        symbol=data["symbol"],
        reactions=list(data["reactions"]),
        interruptions=list(data["interruptions"]),
        mishear_template=template,
        mishear_words=list(mishear.get("words") or []),
        verdict_header=receipt.get("header", "VERDICT"),
        verdict_lines=list(receipt.get("lines", [])),
        verdict_footer=receipt.get("footer", ""),
        mishear_lines=lines,
        receipt_title=receipt.get("title") or DEFAULT_TITLE,
        heard_note=receipt.get("heard_note") or DEFAULT_HEARD_NOTE,
        fine_print=list(receipt.get("fine_print") or []),
    )


def load_personalities(directory: str | Path) -> dict[str, Personality]:
    found: dict[str, Personality] = {}
    for path in sorted(Path(directory).glob("*.yaml")):
        personality = load_personality(path)
        found[personality.id] = personality
    return found
