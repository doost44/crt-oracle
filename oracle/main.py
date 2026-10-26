"""Command-line entry point: python -m oracle [--demo]"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

from oracle.camera import MockCamera, MockDetector, make_camera_and_detector
from oracle.config import load_config
from oracle.crt import Quit
from oracle.display import ConsoleDisplay, make_display
from oracle.inputs import KeyboardInput, ScriptedInput
from oracle.interrupter import Interrupter
from oracle.personalities import load_personalities
from oracle.receipt import FileReceiptPrinter, make_printer
from oracle.runner import run_session
from oracle.session import Session
from oracle.story import Story

DEMO_INPUT = ["1", "I once fixed a stranger's bike", "I worry I peaked in school", "", "", ""]


class _EchoInput:
    """Scripted answers that also appear on the CRT, as if someone typed them."""

    def __init__(self, display, lines: list[str]) -> None:
        self.display = display
        self.scripted = ScriptedInput(lines)

    def read_line(self, prompt: str = "> ") -> str:
        line = self.scripted.read_line(prompt)
        self.display.show_input(prompt, line)
        return line


class _FakeClock:
    """Moves 3 seconds per call, so the demo reaches an interruption quickly."""

    def __init__(self, step: float = 3.0) -> None:
        self.now = -step
        self.step = step

    def __call__(self) -> float:
        self.now += self.step
        return self.now


def _resolve(base: Path, value: str) -> str:
    path = Path(value)
    return str(path if path.is_absolute() else base / path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oracle", description="CRT Oracle")
    parser.add_argument("--config", default="config.yaml", help="path to config.yaml")
    parser.add_argument("--demo", action="store_true", help="scripted run with no hardware")
    parser.add_argument("--seed", type=int, default=None, help="fix the randomness")
    parser.add_argument("--display", choices=["console", "crt"], help="override display.backend")
    parser.add_argument("--window", action="store_true", help="CRT display in a window, not full screen")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    if args.display:
        cfg["display"]["backend"] = args.display
    if args.window:
        cfg["display"]["fullscreen"] = False
    crt = cfg["display"]["backend"] == "crt"
    base = Path(args.config).resolve().parent
    story = Story.load(_resolve(base, cfg["story"]["path"]))
    personalities = load_personalities(_resolve(base, cfg["story"]["personalities_dir"]))
    art_dir = _resolve(base, cfg["story"]["art_dir"])
    cfg["printer"]["out_dir"] = _resolve(base, cfg["printer"]["out_dir"])

    rng = random.Random(args.seed if args.seed is not None else (7 if args.demo else None))
    session = Session(story, personalities, rng=rng, mishear_rate=cfg["story"]["mishear_rate"])
    interrupter = Interrupter(
        cfg["face"]["min_face_seconds"], cfg["face"]["min_gap_seconds"], cfg["face"]["enabled"]
    )

    if args.demo:
        if crt:
            display = make_display(cfg)
            inputs = _EchoInput(display, DEMO_INPUT)
        else:
            display = ConsoleDisplay(cols=cfg["display"]["cols"], typewriter_delay=0)
            inputs = ScriptedInput(DEMO_INPUT)
        camera, detector = MockCamera(), MockDetector([True])
        printer = FileReceiptPrinter(cfg["printer"]["out_dir"])
        clock = _FakeClock()
    else:
        display = make_display(cfg)
        inputs = display if crt else KeyboardInput()
        camera, detector = make_camera_and_detector(cfg)
        printer = make_printer(cfg)
        clock = None

    kwargs = {"clock": clock} if clock else {}
    try:
        result = run_session(
            session, display, inputs, art_dir, printer,
            camera=camera, detector=detector, interrupter=interrupter,
            receipt_width=cfg["printer"]["width"], **kwargs,
        )
        if crt and args.demo:
            display.glitch(3.0)
        elif crt:
            display.read_line("[press Enter] ")
    except Quit:
        return 0
    finally:
        if crt:
            display.close()
    print(f"\n[receipt: {result}]")
    return 0
