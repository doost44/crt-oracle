import pytest

from oracle.crt import CrtDisplay, Quit, TextGrid
from oracle.camera import MockCamera, MockDetector
from oracle.interrupter import Interrupter
from oracle.receipt import FileReceiptPrinter
from oracle.runner import run_session


class FakeScreen:
    """Stands in for pygame: records frames and replays key events.

    Like a real visitor, it only types while the cursor is showing, unless
    `impatient` is set.
    """

    def __init__(self, events=()):
        self.events = list(events)
        self.frames = 0
        self.closed = False
        self.waiting = False
        self.impatient = False

    def render(self, grid, cursor, glitch):
        self.frames += 1
        self.waiting = cursor

    def poll(self):
        # Hand out one event per poll, so typing happens over several frames.
        if not (self.waiting or self.impatient) or not self.events:
            return []
        return [self.events.pop(0)]

    def close(self):
        self.closed = True


class FakeClock:
    def __init__(self, step=0.1):
        self.now = 0.0
        self.step = step

    def __call__(self):
        self.now += self.step
        return self.now


def keys(text, enter=True):
    events = [("text", c) for c in text]
    return events + [("enter", "")] if enter else events


def make(events=(), clock=None, cols=80, rows=24):
    screen = FakeScreen(events)
    display = CrtDisplay(
        screen, cols=cols, rows=rows, typewriter_delay=0,
        sleep=lambda s: None, clock=clock or FakeClock(),
    )
    return display, screen


def test_grid_wraps_and_scrolls():
    grid = TextGrid(cols=5, rows=2)
    for c in "abcdefghijk":
        grid.put(c)
    assert grid.lines == ["fghij", "k"]


def test_say_word_wraps_at_80_columns():
    display, _ = make()
    display.say("word " * 30)
    lines = [line for line in display.grid.lines if line]
    assert len(lines) == 2
    assert all(len(line) <= 80 for line in lines)
    assert not lines[1].startswith(" ")


def test_read_line_collects_typing_and_backspace():
    display, _ = make(keys("cax", enter=False) + [("backspace", "")] + keys("t"))
    assert display.read_line("> ") == "cat"
    assert "> cat" in display.grid.text()


def test_keys_pressed_while_typing_out_are_ignored():
    display, screen = make()
    display.delay = 0.01
    screen.impatient = True
    screen.events = keys("zzz", enter=False)
    display.say("Hello there.")
    screen.impatient = False
    screen.events += keys("ok")
    assert display.read_line() == "ok"


def test_quit_raises():
    display, _ = make([("quit", "")])
    with pytest.raises(Quit):
        display.read_line()


def test_interruption_breaks_into_a_sentence():
    calls = iter([None, None, "I SEE YOU."] + [None] * 100)
    display, _ = make()
    display.hook_interval = 0
    display.set_interrupt_hook(lambda: next(calls))
    display.say("one two three four five six")
    text = display.grid.text()
    assert "one two three-" in text
    assert "I SEE YOU." in text
    assert text.index("I SEE YOU.") < text.index("four five six")


def test_interruption_while_visitor_types_keeps_their_answer():
    display, screen = make(keys("hello"))
    display.hook_interval = 0
    fired = []

    def hook():
        if not fired and display.grid.lines[display.grid.row] == "> hel":
            fired.append(True)
            return "STOP FIDGETING."
        return None

    display.set_interrupt_hook(hook)
    assert display.read_line("> ") == "hello"
    text = display.grid.text()
    assert "STOP FIDGETING." in text
    assert text.endswith("> hello")


def test_full_run_on_crt_display(make_session, root, tmp_path):
    display, screen = make()
    screen.events = keys("3") + keys("a tree") + keys("a fire") + keys("a quiet week") + keys("") * 3
    session = make_session()
    clock = FakeClock(step=3.0)
    result = run_session(
        session, display, display, root / "content" / "art", FileReceiptPrinter(tmp_path),
        camera=MockCamera(), detector=MockDetector([True]),
        interrupter=Interrupter(min_face_seconds=4, min_gap_seconds=20), clock=clock,
    )
    assert "CLINICAL" in open(result).read().upper()
    assert "RECEIPT IS PRINTING" in display.grid.text()


def test_glitch_flag_loads_from_story():
    from oracle.story import Story

    story = Story.from_dict({
        "start": "a",
        "nodes": {"a": {"type": "say", "text": "x", "next": "b", "glitch": True}, "b": {"type": "end"}},
    })
    assert story.nodes["a"].glitch and not story.nodes["b"].glitch
