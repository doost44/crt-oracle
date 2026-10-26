"""Displays. ConsoleDisplay prints to a terminal; the full-screen CRT display is in crt.py."""

from __future__ import annotations

import sys
import textwrap
import time
from pathlib import Path
from typing import Callable, TextIO

ANSI = {"green": "\033[32m", "amber": "\033[33m"}
RESET = "\033[0m"


class ConsoleDisplay:
    def __init__(
        self,
        out: TextIO | None = None,
        cols: int = 80,
        typewriter_delay: float = 0.02,
        color: str = "green",
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.out = out or sys.stdout
        self.cols = cols
        self.delay = typewriter_delay
        self.sleep = sleep
        isatty = getattr(self.out, "isatty", lambda: False)()
        self.color = ANSI.get(color, "") if isatty else ""

    def _write(self, text: str) -> None:
        self.out.write(text)
        self.out.flush()

    def clear(self) -> None:
        self._write("\033[2J\033[H" if self.color else "\n" * 2)

    def art(self, art: str) -> None:
        self._write((self.color or "") + art.rstrip("\n") + (RESET if self.color else "") + "\n\n")

    def say(self, text: str) -> None:
        lines = textwrap.wrap(text, self.cols) or [""]
        if self.color:
            self._write(self.color)
        for line in lines:
            for char in line:
                self._write(char)
                if self.delay:
                    self.sleep(self.delay)
            self._write("\n")
        if self.color:
            self._write(RESET)
        self._write("\n")

    def menu(self, labels: list[str]) -> None:
        for number, label in enumerate(labels, start=1):
            self._write(f"  {number}) {label}\n")
        self._write("\n")


def load_art(art_dir: str | Path, name: str) -> str:
    return (Path(art_dir) / f"{name}.txt").read_text(encoding="utf-8")


def make_display(cfg: dict):
    d = cfg["display"]
    if d["backend"] == "crt":
        from oracle.crt import make_crt_display

        return make_crt_display(cfg)
    return ConsoleDisplay(cols=d["cols"], typewriter_delay=d["typewriter_delay"], color=d["color"])
