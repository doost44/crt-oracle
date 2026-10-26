"""Shared camera types.

A camera needs open(), read() and close(). A detector needs detect(frame),
returning a list of FaceBox. Anything with those methods can be swapped in.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

EMOTION_GUESSES = ["unimpressed", "suspicious", "hopeful", "frowning", "guilty", "smug"]


@dataclass
class FaceBox:
    x: int
    y: int
    w: int
    h: int


def loose_emotion(rng: random.Random | None = None) -> str:
    """A deliberately unreliable emotion label. The Oracle states it with full confidence."""
    return (rng or random).choice(EMOTION_GUESSES)
