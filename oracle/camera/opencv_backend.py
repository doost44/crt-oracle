"""Real camera and face detection using OpenCV (install with: pip install -e .[camera])."""

from __future__ import annotations

from oracle.camera.base import FaceBox


def _cv2():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("OpenCV is not installed. Run: pip install -e .[camera]") from exc
    return cv2


class OpenCVCamera:
    """Reads frames from a video device, including a USB composite capture adapter."""

    def __init__(self, device_index: int = 0) -> None:
        self.device_index = device_index
        self._cap = None

    def open(self) -> None:
        cv2 = _cv2()
        self._cap = cv2.VideoCapture(self.device_index)
        if not self._cap.isOpened():
            raise RuntimeError(
                f"could not open camera {self.device_index}. "
                "Try tools/list_cameras.py to find the right index."
            )

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
    """OpenCV's bundled frontal-face detector. Simple and fast; swap it out later if needed."""

    def __init__(self) -> None:
        cv2 = _cv2()
        if not hasattr(cv2, "CascadeClassifier"):
            raise RuntimeError(
                f"OpenCV {cv2.__version__} has no CascadeClassifier. "
                "Install a 4.x release: pip install 'opencv-python>=4.8,<5'"
            )
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._cascade = cv2.CascadeClassifier(path)
        self._cv2 = cv2

    def detect(self, frame) -> list[FaceBox]:
        if frame is None:
            return []
        gray = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2GRAY)
        found = self._cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5)
        return [FaceBox(int(x), int(y), int(w), int(h)) for (x, y, w, h) in found]
