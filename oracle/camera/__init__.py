"""Camera and face detection. Real OpenCV classes load only when asked for."""

from oracle.camera.base import CameraOpenError, FaceBox
from oracle.camera.mock import MockCamera, MockDetector


def make_camera_and_detector(cfg: dict):
    """Build (camera, detector) for the configured backend."""
    cam = cfg["camera"]
    if cam["backend"] == "opencv":
        from oracle.camera.opencv_backend import OpenCVCamera, make_face_detector

        return (
            OpenCVCamera(cam["device_index"], api=cam.get("api", "auto")),
            make_face_detector(cam),
        )
    return MockCamera(), MockDetector()


__all__ = ["CameraOpenError", "FaceBox", "MockCamera", "MockDetector", "make_camera_and_detector"]
