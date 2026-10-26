"""Camera and face detection. Real OpenCV classes load only when asked for."""

from oracle.camera.base import CameraOpenError, FaceBox
from oracle.camera.mock import MockCamera, MockDetector


def make_camera_and_detector(cfg: dict):
    """Build (camera, detector) for the configured backend."""
    cam = cfg["camera"]
    if cam["backend"] == "opencv":
        from oracle.camera.opencv_backend import HaarFaceDetector, OpenCVCamera

        return (
            OpenCVCamera(cam["device_index"], api=cam.get("api", "auto")),
            HaarFaceDetector(
                detect_width=cam.get("detect_width", 640), min_face_size=cam.get("min_face_size", 60)
            ),
        )
    return MockCamera(), MockDetector()


__all__ = ["CameraOpenError", "FaceBox", "MockCamera", "MockDetector", "make_camera_and_detector"]
