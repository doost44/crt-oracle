"""Story data: a graph of nodes loaded from content/story.yaml.

Node types:
  say     show text, then go to `next`
  choice  show text and `options`; each option has label, next, and
          optionally art (a file in content/art) and personality (an id)
  ask     show text, store the visitor's answer under `key`, go to `next`
  mash    keyboard moment: the visitor presses Enter `count` times, then `next`
  end     show the verdict and print the receipt

`text` can be a plain string or a dict keyed by personality id with a
`default` entry. Text may use {key} to insert earlier answers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

NODE_TYPES = {"say", "choice", "ask", "mash", "end"}


class StoryError(ValueError):
    """The story file is malformed."""


@dataclass
class Option:
    label: str
    next: str
    art: str | None = None
    personality: str | None = None


@dataclass
class Node:
    id: str
    type: str
    text: object = ""
    next: str | None = None
    key: str | None = None
    count: int = 1
    options: list[Option] = field(default_factory=list)


@dataclass
class Story:
    start: str
    nodes: dict[str, Node]

    @classmethod
    def load(cls, path: str | Path) -> "Story":
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict) -> "Story":
        if not isinstance(data, dict) or "start" not in data or "nodes" not in data:
            raise StoryError("story needs 'start' and 'nodes'")
        nodes: dict[str, Node] = {}
        for node_id, raw in data["nodes"].items():
            raw = dict(raw or {})
            node_type = raw.get("type")
            if node_type not in NODE_TYPES:
                raise StoryError(f"node '{node_id}': unknown type {node_type!r}")
            options = [
                Option(
                    label=o["label"],
                    next=o["next"],
                    art=o.get("art"),
                    personality=o.get("personality"),
                )
                for o in raw.get("options", [])
            ]
            nodes[node_id] = Node(
                id=node_id,
                type=node_type,
                text=raw.get("text", ""),
                next=raw.get("next"),
                key=raw.get("key"),
                count=int(raw.get("count", 1)),
                options=options,
            )
        story = cls(start=data["start"], nodes=nodes)
        story.validate()
        return story

    def validate(self) -> None:
        if self.start not in self.nodes:
            raise StoryError(f"start node '{self.start}' does not exist")
        if not any(n.type == "end" for n in self.nodes.values()):
            raise StoryError("story has no 'end' node")
        for node in self.nodes.values():
            targets: list[str] = []
            if node.type in ("say", "ask", "mash"):
                if not node.next:
                    raise StoryError(f"node '{node.id}' needs 'next'")
                targets.append(node.next)
            if node.type == "ask" and not node.key:
                raise StoryError(f"node '{node.id}' needs 'key'")
            if node.type == "choice":
                if not node.options:
                    raise StoryError(f"node '{node.id}' needs 'options'")
                targets.extend(o.next for o in node.options)
            for target in targets:
                if target not in self.nodes:
                    raise StoryError(f"node '{node.id}' points to missing node '{target}'")
