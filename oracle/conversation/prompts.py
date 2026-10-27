"""The Oracle's prompts, loaded from content/oracle/.

  oracle.md        the shared brief: who the Oracle is, the rules, switching
  sugar.md ...     one brief per personality
  seeds.yaml       the themes the conversation steers toward
  receipt.md       how the receipt's reading is written

The system prompt is built once at start-up and never changes during a run,
so the API can cache it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PERSONALITY_IDS = ("sugar", "weary", "clinical")
SYMBOLS = {"sun": "sugar", "rock": "weary", "tree": "clinical"}

_COMMENT = re.compile(r"<!--.*?-->\s*", re.S)


def _read_md(path: Path) -> str:
    """A prompt file without its <!-- notes for the editor -->."""
    return _COMMENT.sub("", path.read_text(encoding="utf-8")).strip()


@dataclass
class Seed:
    id: str
    theme: str
    probes: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class OraclePrompts:
    brief: str
    personalities: dict[str, str]
    seeds: list[Seed]
    receipt: str

    def system(self) -> str:
        """The conversation's system prompt: brief, personalities, seeds."""
        parts = [self.brief, "# The three masks"]
        parts += [self.personalities[pid] for pid in PERSONALITY_IDS]
        parts.append("# Seeds")
        for seed in self.seeds:
            lines = [f"- {seed.id}: {seed.theme}"]
            for pid in PERSONALITY_IDS:
                for probe in seed.probes.get(pid, []):
                    lines.append(f"  - {pid}, for example: {probe}")
            parts.append("\n".join(lines))
        return "\n\n".join(parts)

    def receipt_system(self, personality: str) -> str:
        return "\n\n".join([self.receipt, self.personalities[personality]])


def load_prompts(directory: str | Path = "content/oracle") -> OraclePrompts:
    directory = Path(directory)
    personalities = {pid: _read_md(directory / f"{pid}.md") for pid in PERSONALITY_IDS}
    data = yaml.safe_load((directory / "seeds.yaml").read_text(encoding="utf-8")) or {}
    seeds = []
    for raw in data.get("seeds") or []:
        probes = {pid: list((raw.get("probes") or {}).get(pid) or []) for pid in PERSONALITY_IDS}
        seeds.append(Seed(id=str(raw["id"]), theme=str(raw["theme"]), probes=probes))
    return OraclePrompts(
        brief=_read_md(directory / "oracle.md"),
        personalities=personalities,
        seeds=seeds,
        receipt=_read_md(directory / "receipt.md"),
    )
