"""Camera and face detection. Real OpenCV classes load only when asked for."""

from oracle.camera.base import FaceBox
from oracle.camera.mock import MockCamera, MockDetector


def make_camera_and_detector(cfg: dict):
    """Build (camera, detector) for the configured backend."""
    if cfg["camera"]["backend"] == "opencv":
        from oracle.camera.opencv_backend import HaarFaceDetector, OpenCVCamera

        return OpenCVCamera(cfg["camera"]["device_index"]), HaarFaceDetector()
    return MockCamera(), MockDetector()


__all__ = ["FaceBox", "MockCamera", "MockDetector", "make_camera_and_detector"]
