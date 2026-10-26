"""Live camera mode, tested with fakes: no webcam, no window, no real threads where avoidable."""

import io
import random
import threading
from pathlib import Path

import numpy as np
import pytest

from oracle.camera.base import CameraOpenError, FaceBox
from oracle.config import load_config
from oracle.display import ConsoleDisplay
from oracle.inputs import ScriptedInput
from oracle.interrupter import Interrupter
from oracle.live import (
    CameraWatcher,
    LockedDisplay,
    PromptTrackingInput,
    Snapshot,
    camera_check,
    render_preview,
    run_live,
)
from oracle.receipt import FileReceiptPrinter
from oracle.session import Session
from oracle.story import Story

TINY_STORY = """
start: pick
nodes:
  pick:
    type: choice
    text: "Pick."
    options:
      - {label: "A sun", personality: sugar, next: q1}
  q1: {type: ask, key: proud, text: "Proud of?", next: q2}
  q2: {type: ask, key: worry, text: "Worried about?", next: wake}
  wake: {type: mash, count: 3, text: "Press Enter three times.", next: verdict}
  verdict: {type: end}
"""
TINY_INPUT = ["1", "my bike", "my job", "", "", ""]


class FakeCamera:
    def __init__(self, fail_open=False, shape=(120, 160, 3)):
        self.fail_open = fail_open
        self.shape = shape
        self.opened = self.closed = 0
        self.reads = 0

    def open(self):
        self.opened += 1
        if self.fail_open:
            raise CameraOpenError("no camera here")

    def read(self):
        self.reads += 1
        return np.full(self.shape, self.reads % 255, dtype=np.uint8)

    def close(self):
        self.closed += 1


class FakeDetector:
    """Scripted faces: one entry per call (True = one face), the last repeats."""

    def __init__(self, script=(True,), error_on=()):
        self.script = list(script)
        self.error_on = set(error_on)
        self.calls = 0

    def detect(self, frame):
        n = self.calls
        self.calls += 1
        if n in self.error_on:
            raise RuntimeError("detector exploded")
        return [FaceBox(10, 20, 30, 40)] if self.script[min(n, len(self.script) - 1)] else []


class FakeWindow:
    def __init__(self, keys=()):
        self.keys = list(keys)
        self.hidden = False
        self.closed = False
        self.images = []

    def show(self, image):
        self.images.append(image)
        return self.keys.pop(0) if self.keys else -1

    def hide(self):
        self.hidden = True

    def close(self):
        self.closed = True


@pytest.fixture
def tiny_story(tmp_path):
    path = tmp_path / "story.yaml"
    path.write_text(TINY_STORY, encoding="utf-8")
    return Story.load(path)


@pytest.fixture
def chosen_session(make_session, personalities):
    session = make_session()
    session.personality = personalities["sugar"]
    return session


def _watcher(session, out, interrupter=None, detector=None, inputs=None, log=None):
    display = LockedDisplay(ConsoleDisplay(out=out, typewriter_delay=0))
    return CameraWatcher(
        FakeCamera(), detector or FakeDetector(), interrupter or Interrupter(4, 20),
        session=session, display=display, inputs=inputs, detect_fps=0,
        log=log or io.StringIO(), label_rng=random.Random(1),
    ), display


def test_fires_through_locked_display_after_min_face_seconds(chosen_session):
    out = io.StringIO()
    watcher, _ = _watcher(chosen_session, out)
    for t in range(4):
        watcher.step(t)
    assert out.getvalue() == ""
    watcher.step(4)
    assert watcher.spoken == 1 and out.getvalue().strip()
    watcher.step(5)  # min_gap_seconds keeps it quiet
    assert watcher.spoken == 1


def test_interruption_waits_for_the_display_lock(chosen_session):
    out = io.StringIO()
    watcher, display = _watcher(chosen_session, out, interrupter=Interrupter(0, 20))
    with display.lock:
        worker = threading.Thread(target=watcher.step, args=(0,))
        worker.start()
        worker.join(0.2)
        assert worker.is_alive() and out.getvalue() == ""  # blocked behind the story's text
    worker.join(2)
    assert watcher.spoken == 1


def test_suspended_interrupter_stays_quiet(chosen_session):
    out = io.StringIO()
    interrupter = Interrupter(0, 0)
    interrupter.suspended = True
    watcher, _ = _watcher(chosen_session, out, interrupter=interrupter)
    for t in range(10):
        watcher.step(t)
    assert out.getvalue() == "" and watcher.spoken == 0


def test_no_interruption_before_a_personality_is_chosen(make_session, personalities):
    session = make_session()
    out = io.StringIO()
    watcher, _ = _watcher(session, out)
    for t in range(10):
        watcher.step(t)
    assert watcher.fired == 0 and out.getvalue() == ""
    session.personality = personalities["sugar"]
    watcher.step(10)  # the face timer starts now, not at 0
    watcher.step(13)
    assert watcher.fired == 0
    watcher.step(14)
    assert watcher.spoken == 1


def test_survives_a_detector_exception_and_logs_once(chosen_session):
    out, log = io.StringIO(), io.StringIO()
    detector = FakeDetector([True], error_on={1, 2, 3})
    watcher, _ = _watcher(chosen_session, out, detector=detector, log=log)
    for t in range(10):
        watcher.step(t)
    assert log.getvalue().count("face detector failed") == 1
    assert watcher.spoken == 1  # faces again from call 4 (t=4); fires 4 s later


def test_survives_camera_read_errors(chosen_session):
    class BrokenCamera(FakeCamera):
        def read(self):
            raise OSError("unplugged")

    log = io.StringIO()
    watcher, _ = _watcher(chosen_session, io.StringIO(), log=log)
    watcher.camera = BrokenCamera()
    for t in range(40):
        watcher.step(t)
    assert log.getvalue().count("camera read failed") == 1
    assert watcher.camera.opened >= 1  # it tried to reopen


def test_prompt_is_shown_again_after_an_interruption(chosen_session):
    out = io.StringIO()
    console = ConsoleDisplay(out=out, typewriter_delay=0)
    display = LockedDisplay(console)
    inputs = PromptTrackingInput(ScriptedInput([]), display)
    watcher = CameraWatcher(
        FakeCamera(), FakeDetector(), Interrupter(0, 20), session=chosen_session,
        display=display, inputs=inputs, detect_fps=0, log=io.StringIO(),
    )
    inputs.prompt = "> "  # as if the story were waiting in read_line
    watcher.step(0)
    text = out.getvalue()
    assert text.startswith("\n") and text.endswith("> ") and len(text.strip()) > 2


def test_prompt_tracking_input_writes_prompt_and_clears_state():
    out = io.StringIO()
    display = LockedDisplay(ConsoleDisplay(out=out, typewriter_delay=0))
    seen = []

    class Spy:
        def read_line(self, prompt):
            seen.append((prompt, tracked.prompt))
            return "hello"

    tracked = PromptTrackingInput(Spy(), display)
    assert tracked.read_line("[press Enter] ") == "hello"
    assert seen == [("", "[press Enter] ")] and tracked.prompt is None
    assert out.getvalue() == "[press Enter] "


def test_detect_fps_limits_detection_but_keeps_latest_frame(chosen_session):
    detector = FakeDetector([False])
    watcher = CameraWatcher(FakeCamera(), detector, detect_fps=10, log=io.StringIO())
    for i in range(10):
        watcher.step(i * 0.033)  # ~30 frames per second
    assert detector.calls == 3  # t = 0, 0.132, 0.264 (at least 0.1 s apart)
    assert watcher.snapshot(0.3).frame is not None


def test_snapshot_reports_face_seconds_and_label():
    watcher = CameraWatcher(FakeCamera(), FakeDetector([False, True]), detect_fps=0, log=io.StringIO())
    watcher.step(0)
    assert watcher.snapshot(0).boxes == [] and watcher.snapshot(0).label is None
    watcher.step(1)
    snap = watcher.snapshot(3.5)
    assert snap.boxes and snap.label and snap.face_seconds == pytest.approx(2.5)


def test_stop_releases_camera_and_forgets_the_frame():
    camera = FakeCamera()
    watcher = CameraWatcher(camera, FakeDetector(), detect_fps=0, read_fps=200, log=io.StringIO())
    watcher.start()
    try:
        for _ in range(100):
            if watcher.snapshot().frame is not None:
                break
            threading.Event().wait(0.01)
    finally:
        watcher.stop()
    assert camera.closed == 1 and not watcher.running
    assert watcher.snapshot().frame is None


def test_runner_sources_report_latest_faces():
    watcher = CameraWatcher(FakeCamera(), FakeDetector([True]), detect_fps=0, log=io.StringIO())
    camera, detector = watcher.runner_sources()
    assert detector.detect(camera.read()) == []
    watcher.step(0)
    assert detector.detect(camera.read()) == [FaceBox(10, 20, 30, 40)]


# --- preview rendering ---------------------------------------------------------


def test_box_mode_contains_no_visitor_pixels():
    rng = np.random.default_rng(0)
    boxes = [FaceBox(20, 30, 50, 60)]
    frames = [rng.integers(0, 256, (120, 160, 3), dtype=np.uint8) for _ in range(2)]
    images = [render_preview(Snapshot(f, boxes, "smug"), "box") for f in frames]
    assert images[0].shape == frames[0].shape
    assert np.array_equal(images[0], images[1])  # nothing of the frame gets through
    colours = {tuple(px) for px in images[0].reshape(-1, 3)}
    assert (0, 0, 0) in colours and (0, 255, 0) in colours
    assert all(b == 0 and r == 0 for b, _, r in colours)  # only black and shades of the box green
    assert images[0][100:, 100:].max() == 0  # far from the box: pure black


def test_feed_mode_draws_on_a_copy():
    frame = np.full((120, 160, 3), 77, dtype=np.uint8)
    image = render_preview(Snapshot(frame, [FaceBox(20, 30, 50, 60)], "hopeful"), "feed", "status")
    assert frame.max() == 77 and frame.min() == 77  # the frame itself is untouched
    assert image[110, 150].tolist() == [77, 77, 77]  # the feed shows through
    assert image[30, 40].tolist() == [0, 255, 0]  # top edge of the box


def test_preview_without_a_frame_is_black():
    image = render_preview(Snapshot(None, []), "feed")
    assert image.shape == (480, 640, 3) and image.max() == 0


# --- whole runs, with fakes ---------------------------------------------------------


def _live_args(tiny_story, personalities, tmp_path, root, lines, camera=None, detector=None):
    cfg = load_config(None)
    session = Session(tiny_story, personalities, rng=random.Random(3), mishear_rate=0)
    out = io.StringIO()
    display = ConsoleDisplay(out=out, typewriter_delay=0)
    interrupter = Interrupter(0, 0)
    args = (
        cfg, session, display, ScriptedInput(lines), root / "content" / "art",
        FileReceiptPrinter(tmp_path), camera or FakeCamera(), detector or FakeDetector([True]),
        interrupter,
    )
    return args, out, interrupter


def test_live_run_with_preview_off(tiny_story, personalities, tmp_path, root, capsys):
    args, out, interrupter = _live_args(tiny_story, personalities, tmp_path, root, TINY_INPUT)
    args[0]["camera"]["preview"] = "off"
    assert run_live(*args, log=io.StringIO()) == 0
    assert "RECEIPT IS PRINTING" in out.getvalue()
    assert interrupter.suspended  # the runner's end node still suspends interruptions
    assert args[6].closed == 1
    assert "[receipt:" in capsys.readouterr().out
    assert list(tmp_path.glob("receipt-*.txt"))


def test_live_run_story_in_worker_thread_with_preview(tiny_story, personalities, tmp_path, root):
    args, out, _ = _live_args(tiny_story, personalities, tmp_path, root, TINY_INPUT)
    args[0]["camera"]["preview"] = "box"
    shown_twice = threading.Event()

    class GatedWindow(FakeWindow):
        def show(self, image):
            key = super().show(image)
            if len(self.images) == 2:
                shown_twice.set()
            return key

    class GatedInput(ScriptedInput):
        def read_line(self, prompt="> "):
            assert shown_twice.wait(5)
            return super().read_line(prompt)

    args = args[:3] + (GatedInput(TINY_INPUT),) + args[4:]
    window = GatedWindow(keys=[-1, ord("q")])  # q hides the preview; the story carries on
    assert run_live(*args, window_factory=lambda: window, log=io.StringIO()) == 0
    assert "RECEIPT IS PRINTING" in out.getvalue()
    assert window.hidden and window.closed and len(window.images) == 2
    assert args[6].closed == 1


def test_live_run_eof_exits_cleanly(tiny_story, personalities, tmp_path, root, capsys):
    args, _, _ = _live_args(tiny_story, personalities, tmp_path, root, ["1"])
    window = FakeWindow()
    assert run_live(*args, window_factory=lambda: window, log=io.StringIO()) == 0
    assert "[input closed]" in capsys.readouterr().out
    assert window.closed and args[6].closed == 1


def test_live_run_camera_that_will_not_open(tiny_story, personalities, tmp_path, root):
    args, out, _ = _live_args(
        tiny_story, personalities, tmp_path, root, TINY_INPUT, camera=FakeCamera(fail_open=True)
    )
    log = io.StringIO()
    assert run_live(*args, log=log) == 2
    assert "Could not open camera 0" in log.getvalue() and "--no-camera" in log.getvalue()
    assert out.getvalue() == ""


def test_hook_display_gets_runner_sources_and_no_preview(tiny_story, personalities, tmp_path, root):
    args, out, interrupter = _live_args(tiny_story, personalities, tmp_path, root, TINY_INPUT)

    class HookDisplay(ConsoleDisplay):
        def set_interrupt_hook(self, hook):
            self.hook = hook

    display = HookDisplay(out=out, typewriter_delay=0)
    args = args[:2] + (display,) + args[3:]
    assert run_live(*args, window_factory=lambda: pytest.fail("no preview"), log=io.StringIO()) == 0
    assert "RECEIPT IS PRINTING" in out.getvalue()


def test_camera_check_quits_on_q():
    cfg = load_config(None)
    camera = FakeCamera()
    window = FakeWindow(keys=[-1, -1, 27])
    out = io.StringIO()
    assert camera_check(cfg, camera, FakeDetector([True]), window_factory=lambda: window, out=out) == 0
    assert len(window.images) == 3 and window.closed and camera.closed == 1
    assert "Camera released" in out.getvalue()


def test_camera_check_text_fallback_without_a_window():
    cfg = load_config(None)
    out = io.StringIO()

    def no_window():
        raise RuntimeError("no display")

    code = camera_check(
        cfg, FakeCamera(), FakeDetector([True]), window_factory=no_window, out=out, max_seconds=0.05
    )
    assert code == 0 and "no preview window" in out.getvalue()


# --- the command line -----------------------------------------------------------


def _config_with_tiny_story(tmp_path, root, backend):
    (tmp_path / "story.yaml").write_text(TINY_STORY, encoding="utf-8")
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        f"story: {{path: story.yaml, personalities_dir: '{root / 'content' / 'personalities'}', "
        f"art_dir: '{root / 'content' / 'art'}'}}\n"
        f"display: {{typewriter_delay: 0}}\n"
        f"camera: {{backend: {backend}}}\n",
        encoding="utf-8",
    )
    return cfg


def _no_real_camera(monkeypatch):
    import cv2

    def boom(*a, **k):
        raise AssertionError("tried to open a real camera")

    monkeypatch.setattr(cv2, "VideoCapture", boom)


def test_demo_never_opens_a_camera_even_with_opencv_configured(tmp_path, root, monkeypatch, capsys):
    from oracle import main as main_module

    _no_real_camera(monkeypatch)
    monkeypatch.setattr(main_module, "DEMO_INPUT", TINY_INPUT)
    cfg = _config_with_tiny_story(tmp_path, root, "opencv")
    assert main_module.main(["--config", str(cfg), "--demo"]) == 0
    assert "RECEIPT IS PRINTING" in capsys.readouterr().out


def test_no_camera_flag_plays_without_a_camera(tmp_path, root, monkeypatch, capsys):
    from oracle import main as main_module

    _no_real_camera(monkeypatch)
    monkeypatch.setattr(main_module, "KeyboardInput", lambda: ScriptedInput(TINY_INPUT))
    cfg = _config_with_tiny_story(tmp_path, root, "opencv")
    assert main_module.main(["--config", str(cfg), "--no-camera"]) == 0
    assert "RECEIPT IS PRINTING" in capsys.readouterr().out


def test_opencv_backend_goes_live(tmp_path, root, monkeypatch):
    from oracle import live
    from oracle import main as main_module

    calls = {}

    def fake_run_live(cfg, *args):
        calls["preview"] = cfg["camera"]["preview"]
        calls["camera"] = type(args[5]).__name__
        return 0

    monkeypatch.setattr(live, "run_live", fake_run_live)
    cfg = _config_with_tiny_story(tmp_path, root, "opencv")
    assert main_module.main(["--config", str(cfg), "--preview", "box"]) == 0
    assert calls == {"preview": "box", "camera": "OpenCVCamera"}


def test_shipped_config_uses_the_webcam(root):
    cfg = load_config(Path(root) / "config.yaml")
    assert cfg["camera"]["backend"] == "opencv" and cfg["camera"]["device_index"] == 0
    assert cfg["camera"]["preview"] in ("feed", "box", "off")
    assert load_config(None)["camera"]["backend"] == "mock"  # defaults stay hardware-free
