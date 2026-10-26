"""Command-line entry point: python -m oracle [--demo] [--no-camera] [--camera-check]"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

from oracle.camera import MockCamera, MockDetector, make_camera_and_detector
from oracle.config import load_config
from oracle.display import ConsoleDisplay, make_display
from oracle.inputs import KeyboardInput, ScriptedInput
from oracle.interrupter import Interrupter
from oracle.personalities import load_personalities
from oracle.receipt import FileReceiptPrinter, make_printer
from oracle.runner import run_session
from oracle.session import Session
from oracle.story import Story

DEMO_INPUT = [
    "1", "I once fixed a stranger's bike", "I worry I peaked in school", "a quiet week off", "", "", "",
]


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
    parser.add_argument("--no-camera", action="store_true", help="play without a camera (mock)")
    parser.add_argument(
        "--camera-check", action="store_true", help="show the webcam with face boxes; no story"
    )
    parser.add_argument("--preview", choices=["feed", "box", "off"], help="override camera.preview")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    if args.no_camera:
        cfg["camera"]["backend"] = "mock"
    if args.preview:
        cfg["camera"]["preview"] = args.preview
    if args.camera_check:
        from oracle.live import camera_check

        return camera_check(cfg)
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
        display = ConsoleDisplay(cols=cfg["display"]["cols"], typewriter_delay=0)
        inputs = ScriptedInput(DEMO_INPUT)
        camera, detector = MockCamera(), MockDetector([True])
        printer = FileReceiptPrinter(cfg["printer"]["out_dir"])
        clock = _FakeClock()
    else:
        display = make_display(cfg)
        inputs = KeyboardInput()
        try:
            camera, detector = make_camera_and_detector(cfg)
        except RuntimeError as exc:  # OpenCV missing or too new
            raise SystemExit(f"{exc}\nOr play without a camera: python -m oracle --no-camera")
        printer = make_printer(cfg)
        clock = None

    if not args.demo and cfg["camera"]["backend"] == "opencv":
        from oracle.live import run_live  # webcam watched in a background thread

        return run_live(cfg, session, display, inputs, art_dir, printer, camera, detector, interrupter)

    kwargs = {"clock": clock} if clock else {}
    result = run_session(
        session, display, inputs, art_dir, printer,
        camera=camera, detector=detector, interrupter=interrupter,
        receipt_width=cfg["printer"]["width"], **kwargs,
    )
    print(f"\n[receipt: {result}]")
    return 0
