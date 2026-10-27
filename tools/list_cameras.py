"""Hardware bring-up: find which camera index is the webcam or the capture adapter.

Run: python tools/list_cameras.py [--api auto|dshow|msmf|avfoundation|v4l2|any] [--max 6]
Then set camera.device_index (and camera.api, if you changed it) in config.yaml.
It opens each camera with the same capture API the Oracle uses. One frame is read
to report the size; it is not saved.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # works without pip install -e

try:
    import cv2
except ImportError:
    raise SystemExit("OpenCV is not installed. Run: pip install -e .[camera]")

from oracle.camera.opencv_backend import API_NAMES, open_capture  # noqa: E402

parser = argparse.ArgumentParser(description="List the cameras OpenCV can open.")
parser.add_argument("--api", default="auto", choices=["auto", *API_NAMES], help="capture API")
parser.add_argument("--max", type=int, default=6, help="how many indexes to try")
args = parser.parse_args()

try:  # probing indexes that don't exist is expected; hide OpenCV's warnings about it
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)
except AttributeError:
    pass

found = False
for index in range(args.max):
    cap, api = open_capture(cv2, index, args.api)
    if cap is None:
        continue
    ok, frame = cap.read()
    size = f"{frame.shape[1]}x{frame.shape[0]}" if ok else "opens, but no frame yet"
    print(f"camera {index}: {size} (api: {api})")
    found = True
    frame = None
    cap.release()
if not found:
    print(
        "No cameras opened. Check the camera is plugged in and not in use by another app, "
        "and that this terminal is allowed to use the camera (macOS: System Settings > "
        "Privacy & Security > Camera; Windows: Settings > Privacy & security > Camera)."
    )
