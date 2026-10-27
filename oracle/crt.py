"""Full-screen CRT display: an 80x24 phosphor text screen drawn with pygame.

CrtDisplay holds the text grid and the typing logic, and talks to a `screen`
that draws it. PygameScreen is the real one; tests use a fake. CrtDisplay
also reads the keyboard (read_line), so it serves as both display and input.

While text types out, and while the visitor is typing, the display calls the
interrupt hook every `hook_interval` seconds. If the hook returns a line, the
Oracle breaks off mid-sentence, says it, and carries on.
"""

from __future__ import annotations

import random
import time
from typing import Callable, Protocol

PHOSPHOR = {"green": (51, 255, 102), "amber": (255, 176, 0), "none": (220, 220, 220)}


class TextGrid:
    """A fixed cols x rows character screen that scrolls up when full."""

    def __init__(self, cols: int = 80, rows: int = 24) -> None:
        self.cols = cols
        self.rows = rows
        self.clear()

    def clear(self) -> None:
        self.lines = [""] * self.rows
        self.row = 0
        self.col = 0

    def newline(self) -> None:
        self.col = 0
        if self.row < self.rows - 1:
            self.row += 1
        else:
            self.lines = self.lines[1:] + [""]

    def put(self, char: str) -> None:
        if char == "\n":
            self.newline()
            return
        if self.col >= self.cols:
            self.newline()
        line = self.lines[self.row].ljust(self.col)
        self.lines[self.row] = line[: self.col] + char + line[self.col + 1 :]
        self.col += 1

    def backspace(self) -> None:
        if self.col > 0:
            self.col -= 1
            self.lines[self.row] = self.lines[self.row][: self.col]

    def text(self) -> str:
        return "\n".join(line.rstrip() for line in self.lines).rstrip("\n")


class Screen(Protocol):
    def render(self, grid: TextGrid, cursor: bool, glitch: float) -> None: ...
    def poll(self) -> list[tuple[str, str]]: ...
    def close(self) -> None: ...


class Quit(Exception):
    """The operator closed the window or pressed Ctrl+Q."""


class CrtDisplay:
    def __init__(
        self,
        screen: Screen,
        cols: int = 80,
        rows: int = 24,
        typewriter_delay: float = 0.02,
        hook_interval: float = 0.5,
        max_input: int = 60,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.screen = screen
        self.grid = TextGrid(cols, rows)
        self.delay = typewriter_delay
        self.hook_interval = hook_interval
        self.max_input = max_input
        self.sleep = sleep
        self.clock = clock
        self._hook: Callable[[], str | None] | None = None
        self._last_hook = clock()
        self._in_hook = False
        self._glitch_until = 0.0

    # --- the display interface the runner uses --------------------------

    def clear(self) -> None:
        self.grid.clear()
        self._draw()

    def art(self, art: str) -> None:
        for line in art.rstrip("\n").split("\n"):
            for char in line[: self.grid.cols]:
                self.grid.put(char)
            self.grid.newline()
            self._frame()
        self.grid.newline()
        self._draw()

    def say(self, text: str) -> None:
        self._type(text)
        self._end_paragraph()

    def menu(self, labels: list[str]) -> None:
        for number, label in enumerate(labels, start=1):
            self._type(f"  {number}) {label}")
            self.grid.newline()
        self.grid.newline()
        self._draw()

    def glitch(self, seconds: float = 0.4) -> None:
        self._glitch_until = self.clock() + seconds
        while self.clock() < self._glitch_until:
            self._frame()
            self.sleep(1 / 60)

    def set_interrupt_hook(self, hook: Callable[[], str | None] | None) -> None:
        self._hook = hook

    # --- input ------------------------------------------------------------

    def read_line(self, prompt: str = "> ") -> str:
        self._start_line()
        self._write_now(prompt)
        self._draw(cursor=True)
        typed = ""
        while True:
            for kind, value in self.screen.poll():
                if kind == "quit":
                    raise Quit()
                if kind == "enter":
                    self.grid.newline()
                    self._draw()
                    return typed
                if kind == "backspace" and typed:
                    typed = typed[:-1]
                    self.grid.backspace()
                elif kind == "text" and len(typed) < self.max_input:
                    typed += value
                    self._write_now(value)
            line = self._check_hook()
            if line:
                # Interrupt the visitor, then give them their half-typed answer back.
                self.grid.newline()
                self._say_interruption(line)
                self._write_now(prompt + typed)
            self._frame(cursor=True)

    def show_input(self, prompt: str, text: str) -> None:
        """Show an answer that came from somewhere else (the scripted demo)."""
        self._start_line()
        self._write_now(prompt)
        for char in text:
            self._type_char(char)
        self.grid.newline()
        self._draw()

    def close(self) -> None:
        self.screen.close()

    # --- internals --------------------------------------------------------

    def _type(self, text: str) -> None:
        """Type text with word wrap, checking the interrupt hook between words."""
        for paragraph_index, paragraph in enumerate(text.split("\n")):
            if paragraph_index:
                self.grid.newline()
            for word_index, word in enumerate(paragraph.split(" ")):
                if word_index and self.grid.col + 1 + len(word) > self.grid.cols:
                    self.grid.newline()
                elif word_index:
                    self._type_char(" ")
                for char in word:
                    self._type_char(char)
                line = self._check_hook()
                if line:
                    self._type_char("-")
                    self.grid.newline()
                    self._say_interruption(line)

    def _say_interruption(self, line: str) -> None:
        self._in_hook = True
        try:
            self.glitch(0.15)
            self._type(line)
            self.grid.newline()
        finally:
            self._in_hook = False

    def _check_hook(self) -> str | None:
        if self._hook is None or self._in_hook:
            return None
        now = self.clock()
        if now - self._last_hook < self.hook_interval:
            return None
        self._last_hook = now
        return self._hook()

    def _type_char(self, char: str) -> None:
        self.grid.put(char)
        if self.delay:
            self._frame()
            self.sleep(self.delay)

    def _write_now(self, text: str) -> None:
        for char in text:
            self.grid.put(char)
        self._draw()

    def _start_line(self) -> None:
        if self.grid.col:
            self.grid.newline()

    def _end_paragraph(self) -> None:
        self._start_line()
        self.grid.newline()
        self._draw()

    def _frame(self, cursor: bool = False) -> None:
        """Draw while the Oracle is talking, discarding keys pressed meanwhile (except quit)."""
        if not cursor:
            for kind, _ in self.screen.poll():
                if kind == "quit":
                    raise Quit()
        self._draw(cursor)
        if cursor:
            self.sleep(1 / 30)

    def _draw(self, cursor: bool = False) -> None:
        glitch = max(0.0, self._glitch_until - self.clock())
        self.screen.render(self.grid, cursor, glitch)


class PygameScreen:
    """Draws a TextGrid as a glowing phosphor CRT. Needs `pip install -e .[crt]`."""

    def __init__(
        self,
        cols: int = 80,
        rows: int = 24,
        color: str = "green",
        fullscreen: bool = True,
        window: tuple[int, int] = (1024, 768),
        font: str = "",
        scanlines: bool = True,
        glow: bool = True,
        flicker: float = 0.03,
        rng: random.Random | None = None,
    ) -> None:
        import pygame

        self.pg = pygame
        pygame.display.init()
        pygame.font.init()
        pygame.display.set_caption("CRT Oracle")
        if fullscreen:
            self.window = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
            pygame.mouse.set_visible(False)
        else:
            self.window = pygame.display.set_mode(window)
        pygame.key.start_text_input()

        self.cols, self.rows = cols, rows
        self.fg = PHOSPHOR.get(color, PHOSPHOR["green"])
        self.glow = glow
        self.flicker = flicker
        self.rng = rng or random.Random()
        win_w, win_h = self.window.get_size()
        # The text fills most of the screen, leaving a margin for the CRT's curved edges.
        self.target = (int(win_w * 0.94), int(win_h * 0.92))
        self.offset = ((win_w - self.target[0]) // 2, (win_h - self.target[1]) // 2)
        self.font = self._fit_font(font, *self.target)
        self.cell_w, self.cell_h = self.font.size("M")[0], self.font.get_linesize()
        self.surface = pygame.Surface((self.cell_w * cols, self.cell_h * rows))
        self.scanlines = self._make_scanlines(win_w, win_h) if scanlines else None
        self._glyphs: dict[str, object] = {}

    def _fit_font(self, name: str, win_w: int, win_h: int):
        names = name or "consolas,lucidaconsole,couriernew,dejavusansmono,liberationmono,monospace"
        best = self.pg.font.SysFont(names, 8)
        for size in range(8, 200):
            font = self.pg.font.SysFont(names, size)
            if font.size("M")[0] * self.cols > win_w or font.get_linesize() * self.rows > win_h:
                break
            best = font
        return best

    def _make_scanlines(self, w: int, h: int):
        lines = self.pg.Surface((w, h), self.pg.SRCALPHA)
        for y in range(0, h, 3):
            self.pg.draw.line(lines, (0, 0, 0, 90), (0, y), (w, y))
        return lines

    def _glyph(self, char: str):
        if char not in self._glyphs:
            self._glyphs[char] = self.font.render(char, True, self.fg)
        return self._glyphs[char]

    def render(self, grid: TextGrid, cursor: bool, glitch: float) -> None:
        pg = self.pg
        self.surface.fill((0, 0, 0))
        for y, line in enumerate(grid.lines):
            for x, char in enumerate(line):
                if char != " ":
                    self.surface.blit(self._glyph(char), (x * self.cell_w, y * self.cell_h))
        if cursor and int(time.monotonic() * 2) % 2 == 0:
            rect = (grid.col * self.cell_w, grid.row * self.cell_h, self.cell_w, self.cell_h)
            pg.draw.rect(self.surface, self.fg, rect)

        frame = self.surface
        if glitch > 0:
            frame = self._tear(frame)
        # Stretch the grid to fill the screen, like old text modes did: tall, narrow letters.
        frame = pg.transform.smoothscale(frame, self.target)

        self.window.fill((0, 0, 0))
        self.window.blit(frame, self.offset)
        if self.glow:
            w, h = frame.get_size()
            blur = pg.transform.smoothscale(pg.transform.smoothscale(frame, (w // 6, h // 6)), (w, h))
            blur.set_alpha(110)
            self.window.blit(blur, self.offset, special_flags=pg.BLEND_ADD)
        if self.scanlines is not None:
            self.window.blit(self.scanlines, (0, 0))
        if self.flicker and self.rng.random() < 0.5:
            dim = int(255 * (1 - self.rng.random() * self.flicker))
            self.window.fill((dim, dim, dim), special_flags=pg.BLEND_MULT)
        pg.display.flip()

    def _tear(self, frame):
        """Shift random bands sideways, like a bad sync."""
        torn = frame.copy()
        w, h = frame.get_size()
        for _ in range(self.rng.randint(2, 6)):
            top = self.rng.randrange(0, h)
            height = self.rng.randint(2, max(3, h // 12))
            shift = self.rng.randint(-w // 10, w // 10)
            band = frame.subsurface((0, top, w, min(height, h - top))).copy()
            torn.fill((0, 0, 0), (0, top, w, band.get_height()))
            torn.blit(band, (shift, top))
        return torn

    def poll(self) -> list[tuple[str, str]]:
        pg = self.pg
        events: list[tuple[str, str]] = []
        for event in pg.event.get():
            if event.type == pg.QUIT:
                events.append(("quit", ""))
            elif event.type == pg.KEYDOWN:
                if event.key == pg.K_q and event.mod & pg.KMOD_CTRL:
                    events.append(("quit", ""))
                elif event.key in (pg.K_RETURN, pg.K_KP_ENTER):
                    events.append(("enter", ""))
                elif event.key == pg.K_BACKSPACE:
                    events.append(("backspace", ""))
            elif event.type == pg.TEXTINPUT:
                events.extend(("text", char) for char in event.text if char.isprintable())
        return events

    def close(self) -> None:
        self.pg.quit()


def make_crt_display(cfg: dict) -> CrtDisplay:
    d = cfg["display"]
    try:
        screen = PygameScreen(
            cols=d["cols"],
            rows=d["rows"],
            color=d["color"],
            fullscreen=d["fullscreen"],
            window=tuple(d["window"]),
            font=d["font"],
            scanlines=d["scanlines"],
            glow=d["glow"],
            flicker=d["flicker"],
        )
    except ImportError:
        raise SystemExit('The CRT display needs pygame. Run: pip install -e ".[crt]"')
    return CrtDisplay(screen, cols=d["cols"], rows=d["rows"], typewriter_delay=d["typewriter_delay"])
