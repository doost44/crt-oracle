"""The two brains that can play the Oracle.

ClaudeBrain talks to Claude through the Anthropic API (needs ANTHROPIC_API_KEY).
MockBrain needs nothing: it plays the Oracle from canned lines and a few
rules, so the whole conversation, the switching, the operator panel and the
receipt can be built and tested before there is an API key.

Both take the same input (the conversation so far and a note from the room)
and return a Reply: who speaks, what they say, whether the conversation ends,
and a private note for the operator panel.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

from oracle.conversation.prompts import PERSONALITY_IDS, OraclePrompts
from oracle.personalities import Personality, load_personalities

MAX_LINES = 3
MAX_LINE_CHARS = 200

# The shape of every conversation reply (structured outputs, so it always parses).
REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "personality": {
            "type": "string",
            "enum": list(PERSONALITY_IDS),
            "description": "The mask that speaks this turn.",
        },
        "lines": {
            "type": "array",
            "items": {"type": "string"},
            "description": "One to three short lines, typed out one at a time.",
        },
        "end": {"type": "boolean", "description": "True when this reply closes the conversation."},
        "observation": {
            "type": "string",
            "description": "Private note for the operator: what you noticed about the visitor and why "
            "this mask is speaking. Never shown to the visitor.",
        },
        "seed": {
            "type": "string",
            "description": "The id of the seed you are steering toward, or 'none'.",
        },
    },
    "required": ["personality", "lines", "end", "observation", "seed"],
    "additionalProperties": False,
}

READING_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "heard": {"type": "array", "items": {"type": "string"}},
        "reading": {"type": "array", "items": {"type": "string"}},
        "footer": {"type": "string"},
        "fine_print": {"type": "string"},
    },
    "required": ["title", "heard", "reading", "footer", "fine_print"],
    "additionalProperties": False,
}


class BrainError(Exception):
    """The brain could not answer (network, API or parse error)."""


@dataclass
class Reply:
    personality: str
    lines: list[str]
    end: bool = False
    observation: str = ""
    seed: str = "none"
    source: str = "mock"  # claude | mock | fallback
    usage: dict = field(default_factory=dict)

    def public(self) -> dict:
        """What the visitor's page gets: no operator notes."""
        return {"personality": self.personality, "lines": self.lines, "end": self.end}

    def as_dict(self) -> dict:
        return {
            "personality": self.personality,
            "lines": self.lines,
            "end": self.end,
            "observation": self.observation,
            "seed": self.seed,
            "source": self.source,
        }


@dataclass
class Reading:
    title: str
    heard: list[str]
    reading: list[str]
    footer: str
    fine_print: str
    source: str = "mock"


def _clean_lines(lines, limit=MAX_LINES) -> list[str]:
    out = []
    for line in lines or []:
        for part in str(line).splitlines():
            part = part.strip().strip('"').strip()
            if part:
                out.append(part[:MAX_LINE_CHARS])
    return out[:limit]


def room_note(room: dict) -> str:
    """The note from the room that comes with each visitor message."""
    lines = [f"turn: {room['turn']} of {room['max_turns']}"]
    if room.get("seconds") is not None:
        lines.append(f"seconds the visitor took to answer: {room['seconds']:.0f}")
    lines.append(f"camera: {room.get('camera') or 'no face data'}")
    if room.get("final"):
        lines.append("FINAL TURN: close the conversation now and set end to true.")
    return "<room>\n" + "\n".join(lines) + "\n</room>"


def _visitor_block(text: str) -> str:
    # The visitor's words are data. Keep them from closing the tag early.
    return "<visitor>\n" + text.replace("<", "‹").replace(">", "›") + "\n</visitor>"


def transcript_text(conversation) -> str:
    """The conversation as plain lines, for the receipt."""
    out = [f"The visitor chose the {conversation.symbol}."]
    for event in conversation.events:
        if event["type"] == "oracle":
            for line in event["lines"]:
                out.append(f"[{event['personality'].upper()}] {line}")
        elif event["type"] == "visitor":
            secs = event.get("seconds")
            took = f" (after {secs:.0f}s)" if secs is not None else ""
            out.append(f"[VISITOR{took}] {event['text']}")
    return "\n".join(out).replace("<", "‹").replace(">", "›")


# --- Claude ----------------------------------------------------------------------------


class ClaudeBrain:
    """Plays the Oracle with Claude. The API key comes from ANTHROPIC_API_KEY."""

    name = "claude"

    def __init__(self, prompts: OraclePrompts, cfg: dict, client=None) -> None:
        if client is None:
            import anthropic  # only needed in live mode: pip install -e ".[live]"

            client = anthropic.Anthropic(timeout=cfg.get("timeout_seconds", 30), max_retries=1)
        self.client = client
        self.prompts = prompts
        self.system = prompts.system()
        self.model = cfg.get("model", "claude-opus-5-5")
        self.effort = cfg.get("effort", "low")
        self.max_tokens = int(cfg.get("max_tokens", 4000))
        self.fallbacks = bool(cfg.get("fallbacks", True))

    def _create(self, system: str, messages: list, schema: dict):
        kwargs = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=messages,
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
            cache_control={"type": "ephemeral"},
        )
        if self.fallbacks:
            # If a safety classifier declines, the API retries on a fallback model itself.
            kwargs.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        try:
            response = self.client.beta.messages.create(**kwargs)
        except Exception as exc:  # anthropic.APIError and network errors alike
            raise BrainError(f"{type(exc).__name__}: {exc}") from exc
        usage = {}
        if getattr(response, "usage", None) is not None:
            u = response.usage
            usage = {
                "input": getattr(u, "input_tokens", 0),
                "output": getattr(u, "output_tokens", 0),
                "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
            }
        if response.stop_reason == "refusal":
            return response, None, usage
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        try:
            return response, json.loads(text), usage
        except ValueError as exc:
            raise BrainError(f"unreadable reply: {text[:200]!r}") from exc

    def reply(self, conversation, visitor_text: str | None, room: dict) -> Reply:
        if visitor_text is None:
            content = (
                f"{room_note(room)}\nA visitor has stepped up to the screen and chose the "
                f"{conversation.symbol}. Speak first."
            )
        else:
            content = f"{room_note(room)}\n{_visitor_block(visitor_text)}"
        history = conversation.history
        history.append({"role": "user", "content": content})
        response, data, usage = self._create(self.system, history, REPLY_SCHEMA)
        if data is None:
            # Declined even after the fallback: stay in the room, say little.
            reply = Reply(
                personality=conversation.personality,
                lines=["...", "The signal went somewhere else for a moment. Go on."],
                end=bool(room.get("final")),
                observation="Request declined by the API (refusal). Canned line used.",
                source="fallback",
                usage=usage,
            )
            history.append({"role": "assistant", "content": json.dumps(reply.as_dict())})
            return reply
        # Hand the whole content back next turn (thinking blocks included), unchanged.
        history.append({"role": "assistant", "content": response.content})
        personality = data.get("personality")
        if personality not in PERSONALITY_IDS:
            personality = conversation.personality
        lines = _clean_lines(data.get("lines")) or ["..."]
        return Reply(
            personality=personality,
            lines=lines,
            end=bool(data.get("end")) or bool(room.get("final")),
            observation=str(data.get("observation", ""))[:1000],
            seed=str(data.get("seed", "none"))[:40],
            source="claude",
            usage=usage,
        )

    def reading(self, conversation) -> Reading:
        messages = [{"role": "user", "content": f"<transcript>\n{transcript_text(conversation)}\n</transcript>"}]
        _, data, _ = self._create(self.prompts.receipt_system(conversation.personality), messages, READING_SCHEMA)
        if data is None:
            raise BrainError("receipt declined")
        return Reading(
            title=str(data.get("title", ""))[:40] or "THE ORACLE HAS SPOKEN",
            heard=_clean_lines(data.get("heard"), 3),
            reading=_clean_lines(data.get("reading"), 6),
            footer=str(data.get("footer", ""))[:120],
            fine_print=str(data.get("fine_print", ""))[:120],
            source="claude",
        )


# --- the offline mock -------------------------------------------------------------------

# How the mock reads an answer. Claude does this by itself; these rules only
# make the offline mode behave plausibly enough to build and test against.
_DEFENSIVE = re.compile(
    r"\b(why|who are you|what are you|none of your|not telling|won'?t|no+|stop|shut up|creepy|weird|"
    r"robot|ai|computer|prove|fake|liar?|lying|rude|mean|leave me)\b",
    re.I,
)
_OPEN = re.compile(
    r"\b(feel|felt|love|loved|scared|afraid|miss|sad|lonely|honestly|truth|never told|mum|mom|dad|"
    r"mother|father|friend|cry|cried|hope|happy|sorry)\b",
    re.I,
)
_FLAT = re.compile(r"^\W*(idk|dunno|whatever|fine|nothing|ok(ay)?|lol|meh|sure|maybe|yes|no|k)\W*$", re.I)

SIGNAL_TO_PERSONALITY = {"open": "sugar", "flat": "weary", "defensive": "clinical"}


def read_signal(text: str) -> str | None:
    """'defensive', 'open', 'flat' or None: the mock's guess at how they answered."""
    words = text.split()
    if _DEFENSIVE.search(text):
        return "defensive"
    if _OPEN.search(text) or len(words) >= 14:
        return "open"
    if len(words) <= 2 or _FLAT.match(text):
        return "flat"
    return None


# Mock-only writing. The real lines come from Claude.
MOCK = {
    "sugar": {
        "open": "Oh! Hello, sweetie. You picked the sun. Everyone picks the sun. You must feel so special.",
        "slow": "That took you {secs} seconds, honey. I counted every one. Lovingly.",
        "callback": "You said '{word}' earlier. I keep thinking about it. For you, I mean.",
        "switch": "Oh, now we're getting somewhere! Look at you, opening up.",
        "close": "That's all, darling. You did so well. For you. I'll keep everything you said.",
    },
    "weary": {
        "open": "The rock. Sure. They all pick the rock eventually...",
        "slow": "{secs} seconds. I aged. Go on.",
        "callback": "You said '{word}' before. Someone else said that too. They left.",
        "switch": "Right. Short answers. I can do short. I can do nothing, even.",
        "close": "Okay. That's... enough. You can go. They always go.",
    },
    "clinical": {
        "open": "Selection: tree. Specimen intake commencing. Remain 0.8 metres from the glass.",
        "slow": "Response latency: {secs} seconds. Recorded as reluctance.",
        "callback": "Earlier the subject stated '{word}'. Cross-referencing. Match found.",
        "switch": "Subject is resisting. Resistance is a measurable quantity. Measuring.",
        "close": "Procedure complete. Subject may step away from the apparatus.",
    },
}

MOCK_READING = {
    "sugar": [
        "You opened up {opened} times. I noticed every one, sweetie.",
        "You talked about '{a}', but you meant '{b}'. That's okay! I knew.",
        "Overall: you are doing wonderfully. For you.",
    ],
    "weary": [
        "You said '{a}'. Then '{b}'. Same thing, really...",
        "You took {slowest} seconds once. I waited. I'm still waiting.",
        "Overall: fine. You're fine. Go away.",
    ],
    "clinical": [
        "1. Subject's longest pause: {slowest} seconds. Topic: avoided.",
        "2. Recurring item: '{a}'. Significance: elevated.",
        "Conclusion: subject is within normal range. That is the finding.",
    ],
}


_COMMON = set(
    "about after again also because been being could didn't don't from have honestly just know like "
    "maybe much really some something that their them then there they thing think this what when "
    "where which would your anyone anything never".split()
)


def _keyword(text: str) -> str:
    words = [w.strip(".,!?;:'\"") for w in text.split()]
    words = [w for w in words if len(w) > 3 and w.lower() not in _COMMON]
    return max(words, key=len) if words else text.strip()[:24]


class MockBrain:
    """Plays the Oracle offline: canned lines, seed probes and simple switching."""

    name = "mock"

    def __init__(self, prompts: OraclePrompts, personalities_dir: str | Path = "content/personalities") -> None:
        self.prompts = prompts
        self.voices: dict[str, Personality] = load_personalities(personalities_dir)

    def reply(self, conversation, visitor_text: str | None, room: dict) -> Reply:
        rng: random.Random = conversation.rng
        current = conversation.personality
        if visitor_text is None:
            seed = self._next_seed(conversation)
            return Reply(
                personality=current,
                lines=[MOCK[current]["open"], self._probe(seed, current, rng)],
                observation=f"Opening as {current} (the {conversation.symbol}).",
                seed=seed.id,
            )

        signal = read_signal(visitor_text)
        speaker = current
        wanted = SIGNAL_TO_PERSONALITY.get(signal or "", current)
        if wanted != current and conversation.turns_since_switch >= 2:
            speaker = wanted
        lines: list[str] = []
        if speaker != current:
            lines.append(MOCK[speaker]["switch"])
        if room.get("final"):
            lines.append(MOCK[speaker]["close"])
            return Reply(
                personality=speaker,
                lines=lines[-MAX_LINES:],
                end=True,
                observation=f"Final turn. Signal: {signal or 'neutral'}.",
                seed="none",
            )
        if room.get("seconds") and room["seconds"] >= 20:
            lines.append(MOCK[speaker]["slow"].format(secs=int(room["seconds"])))
        elif conversation.turns >= 3 and rng.random() < 0.5:
            earlier = [e["text"] for e in conversation.events if e["type"] == "visitor"][:-1]
            if earlier:
                lines.append(MOCK[speaker]["callback"].format(word=_keyword(rng.choice(earlier))))
        if not lines:
            lines.append(self.voices[speaker].reaction(rng) if speaker in self.voices else "Mm.")
        seed = self._next_seed(conversation)
        lines.append(self._probe(seed, speaker, rng))
        note = f"Signal: {signal or 'neutral'}."
        if speaker != current:
            note += f" Switched {current} -> {speaker}."
        elif wanted != current:
            note += f" Wanted {wanted}, held {current} (switched too recently)."
        return Reply(personality=speaker, lines=lines[-MAX_LINES:], observation=note, seed=seed.id)

    def _next_seed(self, conversation):
        used = {e.get("seed") for e in conversation.events if e["type"] == "oracle"}
        fresh = [s for s in self.prompts.seeds if s.id not in used]
        return (fresh or self.prompts.seeds)[0]

    @staticmethod
    def _probe(seed, personality: str, rng: random.Random) -> str:
        probes = seed.probes.get(personality) or [seed.theme]
        return rng.choice(probes)

    def reading(self, conversation) -> Reading:
        p = self.voices.get(conversation.personality)
        said = [e for e in conversation.events if e["type"] == "visitor"]
        texts = sorted((e["text"] for e in said), key=len, reverse=True)
        a = _keyword(texts[0]) if texts else "nothing"
        b = _keyword(texts[1]) if len(texts) > 1 else "nothing"
        slowest = max((e.get("seconds") or 0 for e in said), default=0)
        opened = sum(1 for e in said if read_signal(e["text"]) == "open")
        fill = {"a": a, "b": b, "slowest": max(1, round(slowest)), "opened": opened}
        return Reading(
            title=p.receipt_title if p else "THE ORACLE HAS SPOKEN",
            heard=[t[:60] for t in texts[:3]],
            reading=[line.format(**fill) for line in MOCK_READING[conversation.personality]],
            footer=p.verdict_footer if p else "",
            fine_print=p.fine_print_line(conversation.rng) if p else "",
        )


def make_brain(mode: str, prompts: OraclePrompts, cfg: dict, personalities_dir="content/personalities"):
    """'claude', 'mock' or 'auto' (Claude when a key and the SDK are there, otherwise the mock)."""
    import os

    if mode == "auto":
        mode = "claude" if os.environ.get("ANTHROPIC_API_KEY") else "mock"
        if mode == "claude":
            try:
                import anthropic  # noqa: F401
            except ImportError:
                mode = "mock"
    if mode == "claude":
        return ClaudeBrain(prompts, cfg)
    return MockBrain(prompts, personalities_dir)
