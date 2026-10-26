"""Decides when the Oracle interrupts the visitor, based on how long a face has been in view."""

from __future__ import annotations


class Interrupter:
    def __init__(
        self,
        min_face_seconds: float = 4.0,
        min_gap_seconds: float = 20.0,
        enabled: bool = True,
    ) -> None:
        self.min_face_seconds = min_face_seconds
        self.min_gap_seconds = min_gap_seconds
        self.enabled = enabled
        self.suspended = False  # set True during the verdict
        self._face_since: float | None = None
        self._last_fired: float | None = None

    def update(self, now: float, face_count: int) -> bool:
        """Call every frame. Returns True when the Oracle should interrupt now."""
        if face_count <= 0:
            self._face_since = None
            return False
        if self._face_since is None:
            self._face_since = now
        if not self.enabled or self.suspended:
            return False
        if now - self._face_since < self.min_face_seconds:
            return False
        if self._last_fired is not None and now - self._last_fired < self.min_gap_seconds:
            return False
        self._last_fired = now
        return True
