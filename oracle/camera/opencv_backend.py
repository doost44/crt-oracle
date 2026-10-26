"""Real camera and face detection using OpenCV (install with: pip install -e .[camera]).

Privacy: frames only pass through memory here. Nothing in this module stores them.
"""

from __future__ import annotations

import sys

from oracle.camera.base import CameraOpenError, FaceBox

# camera.api values -> OpenCV capture API constant names
API_NAMES = {
    "any": "CAP_ANY",
    "dshow": "CAP_DSHOW",
    "msmf": "CAP_MSMF",
    "avfoundation": "CAP_AVFOUNDATION",
    "v4l2": "CAP_V4L2",
}


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("OpenCV is not installed. Run: pip install -e .[camera]") from exc
    return cv2


def api_candidates(api: str = "auto", platform: str | None = None) -> list[str]:
    """Which capture APIs to try, in order, for a camera.api setting.

    auto: DirectShow first on Windows (Media Foundation is often slow to open or
    gives black frames on built-in webcams), AVFoundation on macOS, the default elsewhere.
    """
    platform = platform or sys.platform
    api = (api or "auto").lower()
    if api == "auto":
        if platform.startswith("win"):
            return ["dshow", "any"]
        if platform == "darwin":
            return ["avfoundation"]
        return ["any"]
    if api not in API_NAMES:
        raise ValueError(f"camera.api must be auto or one of {', '.join(API_NAMES)}, not {api!r}")
    return [api]


def open_capture(cv2, device_index: int, api: str = "auto", platform: str | None = None):
    """Open a VideoCapture with the first capture API that works. Returns (cap, api) or (None, None)."""
    for name in api_candidates(api, platform):
        flag = getattr(cv2, API_NAMES[name], None)
        if flag is None:
            continue
        cap = cv2.VideoCapture(device_index, flag)
        if cap is not None and cap.isOpened():
            return cap, name
        if cap is not None:
            cap.release()
    return None, None


class OpenCVCamera:
    """Reads frames from a video device: a built-in webcam or a USB capture adapter."""

    def __init__(self, device_index: int = 0, api: str = "auto", platform: str | None = None) -> None:
        self.device_index = device_index
        self.api = api
        self.platform = platform or sys.platform
        self.api_used: str | None = None
        self._cap = None
        api_candidates(api, self.platform)  # fail early on a bad camera.api value

    def open(self) -> None:
        cv2 = _cv2()
        self._cap, self.api_used = open_capture(cv2, self.device_index, self.api, self.platform)
        if self._cap is None:
            raise CameraOpenError(
                f"could not open camera {self.device_index} (camera.api: {self.api}). "
                "Try tools/list_cameras.py to find the right index."
            )
        # Keep the driver's queue short, so frames are fresh even if we read slowly.
        # Not every backend supports this; it is harmless where it doesn't.
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def read(self):
        if self._cap is None:
            self.open()
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


class HaarFaceDetector:
    """OpenCV's bundled frontal-face detector. Simple and fast; swap it out later if needed.

    Frames wider than `detect_width` are shrunk before detection (much faster on a
    720p/1080p webcam) and the boxes are scaled back to the full frame.
    `min_face_size` is the smallest face, in full-frame pixels, worth reporting.
    """

    def __init__(self, detect_width: int = 640, min_face_size: int = 60) -> None:
        cv2 = _cv2()
        if not hasattr(cv2, "CascadeClassifier"):
            raise RuntimeError(
                f"OpenCV {cv2.__version__} has no CascadeClassifier. "
                "Install a 4.x release: pip install 'opencv-python>=4.8,<5'"
            )
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._cascade = cv2.CascadeClassifier(path)
        if self._cascade.empty():
            raise RuntimeError(f"could not load the face detector from {path}")
        self._cv2 = cv2
        self.detect_width = int(detect_width or 0)
        self.min_face_size = int(min_face_size or 0)

    def detect(self, frame) -> list[FaceBox]:
        if frame is None:
            return []
        cv2 = self._cv2
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        height, width = gray.shape[:2]
        scale = 1.0
        if self.detect_width and width > self.detect_width:
            scale = self.detect_width / width
            gray = cv2.resize(
                gray, (self.detect_width, max(1, round(height * scale))), interpolation=cv2.INTER_AREA
            )
        gray = cv2.equalizeHist(gray)
        min_side = max(1, round(self.min_face_size * scale)) if self.min_face_size else 1
        found = self._cascade.detectMultiScale(
            gray, scaleFactor=1.2, minNeighbors=5, minSize=(min_side, min_side)
        )
        return [
            FaceBox(round(x / scale), round(y / scale), round(w / scale), round(h / scale))
            for (x, y, w, h) in found
        ]
