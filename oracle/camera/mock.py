"""Stand-ins that need no hardware, for development, tests and the demo."""

from __future__ import annotations

from oracle.camera.base import FaceBox


class MockCamera:
    def open(self) -> None:
        pass

    def read(self):
        return None

    def close(self) -> None:
        pass


class MockDetector:
    """Reports a face according to a script: one entry (face present or not) per call.

    The last entry repeats once the script runs out.
    """

    def __init__(self, script: list[bool] | None = None) -> None:
        self.script = list(script) if script else [False]
        self._calls = 0

    def detect(self, frame) -> list[FaceBox]:
        index = min(self._calls, len(self.script) - 1)
        self._calls += 1
        return [FaceBox(100, 80, 120, 120)] if self.script[index] else []
