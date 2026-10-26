"""Hardware bring-up: find which camera index is the capture adapter.

Run: python tools/list_cameras.py
Then set camera.device_index in config.yaml to the one that shows the camcorder.
"""

try:
    import cv2
except ImportError:
    raise SystemExit("OpenCV is not installed. Run: pip install -e .[camera]")

found = False
for index in range(6):
    cap = cv2.VideoCapture(index)
    if cap.isOpened():
        ok, frame = cap.read()
        size = f"{frame.shape[1]}x{frame.shape[0]}" if ok else "no frame"
        print(f"camera {index}: opens, {size}")
        found = True
    cap.release()
if not found:
    print("No cameras opened. Check the capture adapter is plugged in.")
