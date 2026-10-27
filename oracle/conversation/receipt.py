"""The live Oracle's receipt: a reading of the whole conversation, 32 columns wide.

Same layout as oracle/receipt.py, with the conversation's reading in place of
the verdict, and a VOICES line when the Oracle changed masks along the way.
"""

from __future__ import annotations

import textwrap
from datetime import datetime

from oracle.personalities import DEFAULT_HEARD_NOTE, Personality


def _center(text: str, width: int) -> str:
    return text.center(width).rstrip()


def _block(text: str, width: int) -> list[str]:
    return [_center(line, width) for line in textwrap.wrap(text, width)]


def format_reading(
    reading,
    personality: Personality | None,
    voices: list[str],
    width: int = 32,
    now: datetime | None = None,
) -> str:
    now = now or datetime.now()
    rule, dash = "=" * width, "-" * width
    out = [rule, *_block(reading.title.upper(), width), rule]
    out += _block(personality.name if personality else "THE ORACLE", width)
    out.append(_center(now.strftime("%Y-%m-%d %H:%M"), width))
    if len(voices) > 1:
        out += _block("VOICES: " + " > ".join(v.upper() for v in voices), width)
    out.append(dash)
    if reading.heard:
        out.append("WHAT YOU SAID")
        out += textwrap.wrap(personality.heard_note if personality else DEFAULT_HEARD_NOTE, width)
        for said in reading.heard:
            out += textwrap.wrap(f"- {said}", width, subsequent_indent="  ")
        out.append(dash)
    out += textwrap.wrap(personality.verdict_header if personality else "READING", width)
    for line in reading.reading:
        out += textwrap.wrap(line, width) or [""]
    if reading.footer:
        out.append(dash)
        out += textwrap.wrap(reading.footer, width)
    if reading.fine_print:
        out.append("")
        out += _block(reading.fine_print, width)
    out.append(rule)
    return "\n".join(out) + "\n"
