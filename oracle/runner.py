"""Runs one visitor through the story, start to printed verdict."""

from __future__ import annotations

import time
from typing import Callable

from oracle.camera.base import loose_emotion
from oracle.display import load_art
from oracle.receipt import build_receipt
from oracle.session import Session


def _read_choice(display, inputs, count: int) -> int:
    while True:
        raw = inputs.read_line("> ").strip()
        if raw.isdigit() and 1 <= int(raw) <= count:
            return int(raw) - 1
        display.say("THAT WAS NOT AN OPTION. I WILL ASK AGAIN.")


def _poll_camera(session, display, camera, detector, interrupter, clock) -> None:
    """Between nodes, check the camera and interrupt the visitor if the rules say so."""
    if not (camera and detector and interrupter) or session.personality is None:
        return
    faces = detector.detect(camera.read())
    if interrupter.update(clock(), len(faces)):
        display.say(session.interruption(loose_emotion(session.rng)))


def run_session(
    session: Session,
    display,
    inputs,
    art_dir,
    printer,
    camera=None,
    detector=None,
    interrupter=None,
    clock: Callable[[], float] = time.monotonic,
    receipt_width: int = 32,
) -> str:
    """Play the story. Returns whatever the printer returns (a file path, for the file printer)."""
    while True:
        node = session.node
        if node.type != "end":
            _poll_camera(session, display, camera, detector, interrupter, clock)

        if node.type == "say":
            display.say(session.text())
            session.advance()

        elif node.type == "choice":
            display.say(session.text())
            display.menu([o.label for o in node.options])
            index = _read_choice(display, inputs, len(node.options))
            option = node.options[index]
            if option.art:
                display.art(load_art(art_dir, option.art))
            session.choose(index)

        elif node.type == "ask":
            display.say(session.text())
            heard, misheard = session.answer(inputs.read_line("> "))
            if misheard:
                display.say(session.personality.mishear_line(heard))
            else:
                reaction = session.reaction()
                if reaction:
                    display.say(reaction)

        elif node.type == "mash":
            display.say(session.text())
            for _ in range(node.count):
                inputs.read_line("[press Enter] ")
            session.advance()

        elif node.type == "end":
            if interrupter:
                interrupter.suspended = True
            if session.personality:
                display.say(session.personality.verdict_header)
            for line in session.verdict_lines():
                display.say(line)
            result = printer.print(build_receipt(session, receipt_width))
            display.say("YOUR RECEIPT IS PRINTING. DO NOT READ IT IN FRONT OF ME.")
            return result
