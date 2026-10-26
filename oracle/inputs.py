"""Input sources. Typing works now; speech is a placeholder for later."""

from __future__ import annotations

from typing import Callable


class KeyboardInput:
    """Reads lines from the keyboard (or any `read` callable)."""

    def __init__(self, read: Callable[[str], str] = input) -> None:
        self._read = read

    def read_line(self, prompt: str = "> ") -> str:
        return self._read(prompt)


class ScriptedInput:
    """Replays a fixed list of answers. Used by tests and `--demo`."""

    def __init__(self, lines: list[str]) -> None:
        self._lines = list(lines)

    def read_line(self, prompt: str = "> ") -> str:
        if not self._lines:
            raise EOFError("scripted input ran out")
        return self._lines.pop(0)


class SpeechInput:
    """Placeholder. Milestone 7: add a speech-to-text engine here.

    It only needs the same method as the others: read_line() returning text.
    """

    def read_line(self, prompt: str = "> ") -> str:
        raise NotImplementedError("speech input is not built yet")
