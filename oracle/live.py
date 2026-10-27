"""Live camera: watch the webcam in the background while the visitor plays.

PRIVACY RULE: camera frames are never saved. Nothing here (or anywhere in
oracle/ or tools/) writes a frame to disk, encodes it, records video, pickles
it, sends it anywhere or keeps a history of frames. The watcher holds only the
most recent frame, in memory, so the preview window can show it, and drops it
when it stops. tests/test_camera_privacy.py fails if a saving call appears.

Threading model
---------------
* CameraWatcher runs one background thread: read a frame, detect faces (at
  `camera.detect_fps`), keep the latest boxes, feed the Interrupter. When the
  Interrupter fires (and a personality is chosen, and the verdict hasn't
  started), the watcher makes the Oracle interrupt right away.
* All story text goes through LockedDisplay, one lock around say/art/menu/clear,
  so the watcher's interruption never interleaves with the typewriter text.
  PromptTrackingInput knows when the story waits at a prompt, so after an
  interruption the watcher shows the prompt again. Whatever the visitor had
  half-typed stays in the terminal's line buffer; Enter still sends it.
* The runner gets camera=None, detector=None (it must not read the camera too)
  but still gets the Interrupter, so its end node suspends interruptions during
  the verdict.
* Preview window (camera.preview: feed | box | off): OpenCV windows must run on
  the main thread on macOS, so with a preview the story runs in a worker thread
  and the main thread runs the preview loop until the story ends. Without a
  preview the story runs on the main thread.
* A display that interrupts by itself (it has set_interrupt_hook, like the
  planned full-screen CRT display) owns the main thread, so it gets no preview
  and no watcher speech: the runner reads the watcher's latest boxes instead.
"""

from __future__ import annotations

import os
import random
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, TextIO

from oracle.camera.base import EMOTION_GUESSES, FaceBox
from oracle.runner import run_session

PREVIEW_MODES = ("feed", "box", "off")
QUIT_KEYS = (ord("q"), ord("Q"), 27)  # q, Q, Esc
BOX_COLOR = (0, 255, 0)  # BGR green
LABEL_SECONDS = 4.0  # the Oracle changes its mind about your mood this often


# --- display and input wrappers --------------------------------------------


class LockedDisplay:
    """Forwards to a display under one lock, so two threads never type over each other."""

    def __init__(self, display, lock: threading.RLock | None = None) -> None:
        self._display = display
        self.lock = lock or threading.RLock()

    def say(self, text: str) -> None:
        with self.lock:
            self._display.say(text)

    def art(self, art: str) -> None:
        with self.lock:
            self._display.art(art)

    def menu(self, labels: list[str]) -> None:
        with self.lock:
            self._display.menu(labels)

    def clear(self) -> None:
        with self.lock:
            self._display.clear()

    def write_raw(self, text: str) -> None:
        """Write text as-is (no typewriter, no wrapping): prompts and line breaks."""
        with self.lock:
            out = getattr(self._display, "out", None) or sys.stdout
            out.write(text)
            out.flush()

    def __getattr__(self, name):
        return getattr(self._display, name)


class PromptTrackingInput:
    """Wraps an input source and remembers the prompt while the story waits for a line."""

    def __init__(self, inputs, display: LockedDisplay) -> None:
        self._inputs = inputs
        self._display = display
        self.prompt: str | None = None

    def read_line(self, prompt: str = "> ") -> str:
        # Write the prompt ourselves, under the display lock, so "waiting at a prompt"
        # and "the prompt is on screen" are always true together.
        with self._display.lock:
            self._display.write_raw(prompt)
            self.prompt = prompt
        try:
            return self._inputs.read_line("")
        finally:
            with self._display.lock:
                self.prompt = None


# --- the watcher -------------------------------------------------------------


@dataclass
class Snapshot:
    frame: object = None  # the latest frame (numpy array) or None; never stored elsewhere
    boxes: list[FaceBox] = field(default_factory=list)
    label: str | None = None  # the Oracle's deliberately unreliable emotion guess
    face_seconds: float = 0.0  # how long a face has been in view


class CameraWatcher:
    def __init__(
        self,
        camera,
        detector,
        interrupter=None,
        *,
        session=None,
        display: LockedDisplay | None = None,
        inputs: PromptTrackingInput | None = None,
        detect_fps: float = 10.0,
        read_fps: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
        log: TextIO | None = None,
        label_rng: random.Random | None = None,
        reopen_after: int = 30,
        reopen_every: float = 2.0,
    ) -> None:
        self.camera = camera
        self.detector = detector
        self.interrupter = interrupter
        self.session = session
        self.display = display
        self.inputs = inputs
        self.detect_period = 1.0 / detect_fps if detect_fps and detect_fps > 0 else 0.0
        self.read_period = 1.0 / read_fps if read_fps and read_fps > 0 else 0.0
        self.clock = clock
        self.log = log
        self.label_rng = label_rng or random.Random()
        self.reopen_after = reopen_after
        self.reopen_every = reopen_every

        self.fired = 0  # times the interrupter said "now"
        self.spoken = 0  # interruptions actually shown
        self.interrupter_lock = threading.Lock()
        self._state = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._frame = None
        self._boxes: list[FaceBox] = []
        self._label: str | None = None
        self._label_at = 0.0
        self._face_since: float | None = None
        self._last_detect: float | None = None
        self._misses = 0
        self._last_reopen = float("-inf")
        self._warned: set[str] = set()

    # -- lifecycle

    def start(self) -> None:
        """Open the camera (in the calling thread; raises if it can't) and start watching."""
        self.camera.open()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="oracle-camera", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        """Stop the thread, release the camera and forget the last frame."""
        self._stop.set()
        thread_done = True
        if self._thread is not None:
            self._thread.join(timeout)
            thread_done = not self._thread.is_alive()
        if thread_done:  # never release the camera while the thread may still be reading it
            try:
                self.camera.close()
            except Exception as exc:  # pragma: no cover - driver trouble at exit
                self._warn("close", f"could not release the camera cleanly: {exc}")
        with self._state:
            self._frame = None
            self._boxes = []

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self.step()
            except Exception as exc:  # keep watching whatever happens
                self._warn("step", f"camera loop error ({type(exc).__name__}: {exc}); carrying on")
            self._stop.wait(max(0.0, self.read_period - (time.monotonic() - started)))

    # -- one tick (tests call this directly)

    def step(self, now: float | None = None) -> None:
        now = self.clock() if now is None else now
        frame = self._read(now)
        if self._last_detect is not None and now - self._last_detect < self.detect_period:
            with self._state:
                self._frame = frame  # keep the preview smooth between detections
            return
        self._last_detect = now
        boxes = self._detect(frame)
        with self._state:
            self._frame = frame
            self._boxes = boxes
            if boxes:
                if self._face_since is None:
                    self._face_since = now
                    self._new_label(now)
                elif now - self._label_at >= LABEL_SECONDS:
                    self._new_label(now)
            else:
                self._face_since = None
                self._label = None
        self._feed_interrupter(now, len(boxes))

    def snapshot(self, now: float | None = None) -> Snapshot:
        now = self.clock() if now is None else now
        with self._state:
            since = self._face_since
            return Snapshot(
                frame=self._frame,
                boxes=list(self._boxes),
                label=self._label,
                face_seconds=max(0.0, now - since) if since is not None else 0.0,
            )

    def runner_sources(self):
        """(camera, detector) stand-ins for run_session that report the watcher's latest
        faces without touching the real camera. Used for displays that interrupt by
        themselves (set_interrupt_hook); create the watcher with interrupter=None then."""
        return _NoFrameCamera(), _LatestFaces(self)

    # -- internals

    def _new_label(self, now: float) -> None:
        self._label = self.label_rng.choice(EMOTION_GUESSES)
        self._label_at = now

    def _read(self, now: float):
        try:
            frame = self.camera.read()
        except Exception as exc:
            self._warn("read", f"camera read failed ({exc}); still trying")
            frame = None
        if frame is not None:
            self._misses = 0
            return frame
        self._misses += 1
        if self._misses >= self.reopen_after:
            self._warn("frames", "the camera stopped sending frames; trying to reopen it")
            if now - self._last_reopen >= self.reopen_every:
                self._last_reopen = now
                try:
                    self.camera.close()
                    self.camera.open()
                except Exception:
                    pass  # try again later
        return None

    def _detect(self, frame) -> list[FaceBox]:
        try:
            return list(self.detector.detect(frame))
        except Exception as exc:
            self._warn("detect", f"face detector failed ({type(exc).__name__}: {exc}); carrying on")
            return []

    def _feed_interrupter(self, now: float, count: int) -> None:
        if self.interrupter is None:
            return
        if self.session is not None and self.session.personality is None:
            return  # like the runner: nobody to interrupt with until a symbol is chosen
        with self.interrupter_lock:
            fire = self.interrupter.update(now, count)
        if fire:
            self.fired += 1
            self._speak()

    def _speak(self) -> None:
        session, display = self.session, self.display
        if session is None or display is None:
            return
        with display.lock:
            # Re-check under the lock: the verdict may have started while we waited.
            if self.interrupter.suspended or session.personality is None:
                return
            line = session.interruption(self._label or self.label_rng.choice(EMOTION_GUESSES))
            if not line:
                return
            prompt = getattr(self.inputs, "prompt", None)
            if prompt is not None:
                display.write_raw("\n")  # step off the visitor's half-typed line
            display.say(line)
            if prompt is not None:
                display.write_raw(prompt)
            self.spoken += 1

    def _warn(self, key: str, message: str) -> None:
        if key in self._warned:
            return
        self._warned.add(key)
        out = self.log or sys.stderr
        try:
            out.write(f"[camera] {message}\n")
            out.flush()
        except Exception:  # pragma: no cover
            pass


class _NoFrameCamera:
    def open(self) -> None:
        pass

    def read(self):
        return None

    def close(self) -> None:
        pass


class _LatestFaces:
    def __init__(self, watcher: CameraWatcher) -> None:
        self.watcher = watcher

    def detect(self, frame) -> list[FaceBox]:
        return self.watcher.snapshot().boxes


# --- preview -----------------------------------------------------------------


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("OpenCV is not installed. Run: pip install -e .[camera]") from exc
    return cv2


def render_preview(snap: Snapshot, mode: str = "feed", status: str | None = None):
    """Draw the operator's view. "feed": the camera image with face boxes.
    "box": face boxes on black, the size of the frame, with no image of the visitor.
    Returns a new image; the frame itself is never drawn on."""
    import numpy as np

    cv2 = _cv2()
    frame = snap.frame
    if frame is not None and getattr(frame, "ndim", 0) == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    height, width = (frame.shape[:2] if frame is not None else (480, 640))
    if mode == "feed" and frame is not None:
        canvas = frame.copy()
    else:
        canvas = np.zeros((height, width, 3), dtype=np.uint8)
    for box in snap.boxes:
        cv2.rectangle(canvas, (box.x, box.y), (box.x + box.w, box.y + box.h), BOX_COLOR, 2)
        if snap.label:
            cv2.putText(
                canvas, snap.label.upper(), (box.x, max(16, box.y - 8)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, BOX_COLOR, 2,
            )
    if status:
        cv2.putText(
            canvas, status, (10, height - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, BOX_COLOR, 1
        )
    return canvas


class PreviewWindow:
    """An OpenCV window. Create, show and close it on the main thread only (macOS rule)."""

    def __init__(self, title: str = "CRT Oracle camera") -> None:
        self.cv2 = _cv2()
        self.title = title
        self.hidden = False
        self._shown = False
        self.cv2.namedWindow(title, self.cv2.WINDOW_NORMAL)

    def show(self, image) -> int:
        """Show an image and wait ~30 ms for a key. Returns the key code, or -1."""
        if self.hidden:
            time.sleep(0.03)
            return -1
        cv2 = self.cv2
        cv2.imshow(self.title, image)
        key = cv2.waitKey(30)
        if self._shown and cv2.getWindowProperty(self.title, cv2.WND_PROP_VISIBLE) < 1:
            self.hidden = True  # closed with the window's close button
            return -1
        self._shown = True
        return key & 0xFF if key != -1 else -1

    def hide(self) -> None:
        if not self.hidden:
            self.cv2.destroyWindow(self.title)
            self.cv2.waitKey(1)
            self.hidden = True

    def close(self) -> None:
        self.hidden = True
        self.cv2.destroyAllWindows()
        self.cv2.waitKey(1)


def preview_loop(
    watcher: CameraWatcher,
    window,
    mode: str,
    done: Callable[[], bool],
    status: Callable[[Snapshot], str | None] | None = None,
    quit_ends: bool = False,
) -> None:
    """Show the preview until done(). q/Esc (or closing the window) hides it; with
    quit_ends it returns instead. Either way the story is never stopped from here."""
    while not done():
        if window.hidden:
            if quit_ends:
                return
            time.sleep(0.05)
            continue
        snap = watcher.snapshot()
        key = window.show(render_preview(snap, mode, status(snap) if status else None))
        if key in QUIT_KEYS:
            if quit_ends:
                return
            window.hide()


# --- running it --------------------------------------------------------------


def camera_help(device_index: int, platform: str | None = None) -> str:
    platform = platform or sys.platform
    lines = [f"Could not open camera {device_index}."]
    if platform == "darwin":
        lines.append(
            "- macOS: System Settings > Privacy & Security > Camera, switch on the app you run "
            "this from (Terminal, iTerm, VS Code...), then quit and reopen that app. The very "
            "first run may only show the permission prompt: allow it and run again."
        )
    elif platform.startswith("win"):
        lines.append(
            "- Windows: Settings > Privacy & security > Camera: turn on Camera access and "
            "'Let desktop apps access your camera'. If it still fails, try camera.api: msmf "
            "in config.yaml."
        )
    lines += [
        "- Close other apps that may be using the camera (Zoom, Teams, FaceTime, a browser tab).",
        "- Try another index: python tools/list_cameras.py, then set camera.device_index in config.yaml.",
        "- Or play without a camera: python -m oracle --no-camera",
    ]
    return "\n".join(lines)


def _preview_mode(cfg: dict) -> str:
    mode = str(cfg["camera"].get("preview", "feed")).lower()
    if mode not in PREVIEW_MODES:
        raise ValueError(f"camera.preview must be one of {', '.join(PREVIEW_MODES)}, not {mode!r}")
    return mode


def _open_window(factory, log: TextIO):
    try:
        return (factory or PreviewWindow)()
    except Exception as exc:
        log.write(f"[camera] no preview window ({exc}); carrying on without one\n")
        return None


def run_live(
    cfg: dict,
    session,
    display,
    inputs,
    art_dir,
    printer,
    camera,
    detector,
    interrupter,
    *,
    window_factory: Callable[[], object] | None = None,
    log: TextIO | None = None,
    hard_exit: Callable[[int], None] = os._exit,
) -> int:
    """Play one session with the live camera. Returns the process exit code."""
    log = log or sys.stderr
    cam = cfg["camera"]
    mode = _preview_mode(cfg)
    fps = cam.get("detect_fps", 10.0)

    if hasattr(display, "set_interrupt_hook"):
        # This display interrupts mid-sentence by itself and owns the main thread.
        watcher = CameraWatcher(camera, detector, None, detect_fps=fps, log=log)
        story_display, story_inputs = display, inputs
        run_camera, run_detector = watcher.runner_sources()
        mode = "off"
    else:
        story_display = LockedDisplay(display)
        story_inputs = PromptTrackingInput(inputs, story_display)
        watcher = CameraWatcher(
            camera, detector, interrupter, session=session, display=story_display,
            inputs=story_inputs, detect_fps=fps, log=log,
        )
        run_camera = run_detector = None  # the watcher owns the camera

    try:
        watcher.start()
    except Exception as exc:
        log.write(f"{camera_help(cam.get('device_index', 0))}\n({exc})\n")
        return 2

    def story():
        return run_session(
            session, story_display, story_inputs, art_dir, printer,
            camera=run_camera, detector=run_detector, interrupter=interrupter,
            receipt_width=cfg["printer"]["width"],
        )

    outcome: dict = {}
    window = _open_window(window_factory, log) if mode != "off" else None
    worker = None
    try:
        if window is None:
            outcome["result"] = story()
        else:
            def work() -> None:
                try:
                    outcome["result"] = story()
                except BaseException as exc:  # handed to the main thread
                    outcome["error"] = exc

            worker = threading.Thread(target=work, name="oracle-story", daemon=True)
            worker.start()
            try:
                preview_loop(watcher, window, mode, done=lambda: not worker.is_alive())
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                log.write(f"[camera] preview stopped ({exc}); the story carries on\n")
                while worker.is_alive():
                    worker.join(0.1)
    except KeyboardInterrupt:
        outcome["error"] = KeyboardInterrupt()
    except EOFError as exc:
        outcome["error"] = exc
    finally:
        if window is not None:
            try:
                window.close()
            except Exception:
                pass
        watcher.stop()

    error = outcome.get("error")
    if isinstance(error, KeyboardInterrupt):
        sys.stdout.write("\n[stopped]\n")
        sys.stdout.flush()
        if worker is not None and worker.is_alive():
            hard_exit(130)  # the story thread is stuck in input(); camera is already released
        return 130
    if isinstance(error, EOFError):
        sys.stdout.write("\n[input closed]\n")
        return 0
    if error is not None:
        raise error
    print(f"\n[receipt: {outcome['result']}]")
    return 0


def camera_check(
    cfg: dict,
    camera=None,
    detector=None,
    *,
    window_factory: Callable[[], object] | None = None,
    out: TextIO | None = None,
    max_seconds: float | None = None,
) -> int:
    """Open the webcam and show face boxes and a face-in-view counter until q/Esc. No story."""
    from oracle.interrupter import Interrupter

    out = out or sys.stdout
    cam = cfg["camera"]
    if camera is None or detector is None:
        from oracle.camera import make_camera_and_detector

        camera, detector = make_camera_and_detector({**cfg, "camera": {**cam, "backend": "opencv"}})
    face = cfg["face"]
    interrupter = Interrupter(face["min_face_seconds"], face["min_gap_seconds"], True)
    watcher = CameraWatcher(camera, detector, interrupter, detect_fps=cam.get("detect_fps", 10.0), log=out)
    try:
        watcher.start()
    except Exception as exc:
        out.write(f"{camera_help(cam.get('device_index', 0))}\n({exc})\n")
        return 2

    def status(snap: Snapshot) -> str:
        seen = (
            f"face in view for {snap.face_seconds:4.1f} s" if snap.boxes else "no face"
        )
        return (
            f"{seen} | interrupts after {face['min_face_seconds']:g} s | "
            f"interruptions: {watcher.fired} | q quits"
        )

    mode = _preview_mode(cfg)
    if mode == "off":
        mode = "feed"
    api = getattr(camera, "api_used", None)
    out.write(
        f"Camera {cam.get('device_index', 0)} open{f' ({api})' if api else ''}. "
        "Press q or Esc in the preview window to quit (Ctrl+C here also works).\n"
    )
    deadline = None if max_seconds is None else time.monotonic() + max_seconds
    done = (lambda: False) if deadline is None else (lambda: time.monotonic() >= deadline)
    window = _open_window(window_factory, out)
    try:
        if window is not None:
            preview_loop(watcher, window, mode, done, status=status, quit_ends=True)
        else:
            out.write("Printing to the terminal instead, once a second.\n")
            while not done():
                out.write(status(watcher.snapshot()).replace(" | q quits", "") + "\n")
                out.flush()
                time.sleep(1.0 if deadline is None else max(0.0, min(1.0, deadline - time.monotonic())))
    except KeyboardInterrupt:
        pass
    finally:
        if window is not None:
            try:
                window.close()
            except Exception:
                pass
        watcher.stop()
    out.write("Camera released.\n")
    return 0
