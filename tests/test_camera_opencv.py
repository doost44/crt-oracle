"""OpenCV backend logic, with OpenCV's camera and cascade replaced by fakes."""

import numpy as np
import pytest

from oracle.camera import make_camera_and_detector
from oracle.camera.base import CameraOpenError, FaceBox
from oracle.camera.opencv_backend import HaarFaceDetector, OpenCVCamera, api_candidates


def test_api_auto_per_platform():
    assert api_candidates("auto", "win32") == ["dshow", "any"]
    assert api_candidates("auto", "darwin") == ["avfoundation"]
    assert api_candidates("auto", "linux") == ["any"]
    assert api_candidates("MSMF", "win32") == ["msmf"]
    with pytest.raises(ValueError):
        api_candidates("quicktime", "darwin")


class FakeCapture:
    def __init__(self, index, api, works):
        self.index, self.api, self.works = index, api, works
        self.released = False
        self.props = {}

    def isOpened(self):
        return self.works

    def set(self, prop, value):
        self.props[prop] = value

    def read(self):
        return True, np.zeros((4, 4, 3), np.uint8)

    def release(self):
        self.released = True


def _fake_videocapture(monkeypatch, working_apis):
    import cv2

    made = []

    def factory(index, api=cv2.CAP_ANY):
        cap = FakeCapture(index, api, api in working_apis)
        made.append(cap)
        return cap

    monkeypatch.setattr(cv2, "VideoCapture", factory)
    return cv2, made


def test_windows_tries_directshow_then_falls_back(monkeypatch):
    import cv2

    _, made = _fake_videocapture(monkeypatch, {cv2.CAP_ANY})
    camera = OpenCVCamera(0, api="auto", platform="win32")
    camera.open()
    assert [c.api for c in made] == [cv2.CAP_DSHOW, cv2.CAP_ANY]
    assert made[0].released and camera.api_used == "any"
    assert camera.read() is not None
    camera.close()
    assert made[1].released


def test_windows_uses_directshow_when_it_works(monkeypatch):
    import cv2

    _, made = _fake_videocapture(monkeypatch, {cv2.CAP_DSHOW})
    camera = OpenCVCamera(0, platform="win32")
    camera.open()
    assert len(made) == 1 and camera.api_used == "dshow"
    assert made[0].props == {cv2.CAP_PROP_BUFFERSIZE: 1}


def test_open_failure_raises_camera_open_error(monkeypatch):
    _fake_videocapture(monkeypatch, set())
    with pytest.raises(CameraOpenError, match="could not open camera 3"):
        OpenCVCamera(3, platform="darwin").open()


def test_bad_api_setting_fails_early():
    with pytest.raises(ValueError):
        OpenCVCamera(0, api="nope")


class FakeCascade:
    def __init__(self, found):
        self.found = found
        self.calls = []

    def detectMultiScale(self, gray, scaleFactor, minNeighbors, minSize):
        self.calls.append((gray.shape, minSize))
        return self.found


def test_downscaled_detection_maps_boxes_back():
    detector = HaarFaceDetector(detect_width=640, min_face_size=60)
    detector._cascade = FakeCascade([(100, 50, 40, 40)])
    frame = np.zeros((720, 1280, 3), np.uint8)  # 1280 wide: detected at half size
    boxes = detector.detect(frame)
    assert detector._cascade.calls == [((360, 640), (30, 30))]
    assert boxes == [FaceBox(200, 100, 80, 80)]


def test_small_frames_are_not_rescaled():
    detector = HaarFaceDetector(detect_width=640, min_face_size=60)
    detector._cascade = FakeCascade([(10, 20, 30, 40)])
    assert detector.detect(np.zeros((480, 640, 3), np.uint8)) == [FaceBox(10, 20, 30, 40)]
    assert detector._cascade.calls == [((480, 640), (60, 60))]
    assert detector.detect(None) == []


def test_real_cascade_runs_on_a_blank_frame():
    assert HaarFaceDetector().detect(np.zeros((480, 640, 3), np.uint8)) == []


def test_factory_passes_camera_settings():
    cfg = {"camera": {"backend": "opencv", "device_index": 2, "api": "msmf",
                      "detect_width": 320, "min_face_size": 40}}
    camera, detector = make_camera_and_detector(cfg)
    assert (camera.device_index, camera.api) == (2, "msmf")
    assert (detector.detect_width, detector.min_face_size) == (320, 40)
