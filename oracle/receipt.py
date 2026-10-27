"""The printed verdict: formatting plus the printer backends."""

from __future__ import annotations

import subprocess
import textwrap
from datetime import datetime
from pathlib import Path

from oracle.session import Session


def _center(text: str, width: int) -> str:
    return text.center(width).rstrip()


def _centered_block(text: str, width: int) -> list[str]:
    return [_center(line, width) for line in textwrap.wrap(text, width)]


def build_receipt(session: Session, width: int = 32, now: datetime | None = None) -> str:
    """Format the visitor's result as plain text no wider than `width`."""
    now = now or datetime.now()
    rule = "=" * width
    p = session.personality
    title = p.receipt_title if p else "THE ORACLE HAS SPOKEN"
    out: list[str] = [rule, *_centered_block(title, width), rule]
    out.extend(_centered_block(p.name if p else "UNCHOSEN", width))
    out.append(_center(now.strftime("%Y-%m-%d %H:%M"), width))
    out.append("-" * width)
    if session.heard:
        out.append("WHAT YOU SAID")
        out.extend(textwrap.wrap(p.heard_note if p else "(as I heard it)", width))
        for key, value in session.heard.items():
            out.extend(textwrap.wrap(f"- {value}", width, subsequent_indent="  "))
        out.append("-" * width)
    out.extend(textwrap.wrap(p.verdict_header if p else "VERDICT", width))
    for line in session.verdict_lines():
        out.extend(textwrap.wrap(line, width) or [""])
    if p and p.verdict_footer:
        out.append("-" * width)
        out.extend(textwrap.wrap(p.verdict_footer, width))
    fine_print = p.fine_print_line(session.rng) if p else ""
    if fine_print:
        out.append("")
        out.extend(_centered_block(fine_print, width))
    out.append(rule)
    return "\n".join(out) + "\n"


class FileReceiptPrinter:
    """Writes each receipt to a text file. Safe stand-in until a printer is attached."""

    def __init__(self, out_dir: str | Path = "out") -> None:
        self.out_dir = Path(out_dir)

    def print(self, text: str) -> str:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        path = self.out_dir / f"receipt-{stamp}.txt"
        path.write_text(text, encoding="utf-8")
        return str(path)


class LpReceiptPrinter:
    """Sends receipts to a CUPS printer with `lp` (macOS and Linux)."""

    def __init__(self, destination: str = "") -> None:
        self.destination = destination

    def print(self, text: str) -> str:
        cmd = ["lp"]
        if self.destination:
            cmd += ["-d", self.destination]
        subprocess.run(cmd, input=text.encode("utf-8"), check=True)
        return self.destination or "default printer"


def make_printer(cfg: dict):
    printer_cfg = cfg["printer"]
    if printer_cfg["backend"] == "lp":
        return LpReceiptPrinter(printer_cfg["lp_destination"])
    return FileReceiptPrinter(printer_cfg["out_dir"])
