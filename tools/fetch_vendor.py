"""Download MediaPipe's face tracker into web/vendor/mediapipe/ so the webcam,
the readout and the physical actions work offline.

The always-on webcam and the physical actions share one copy of the tracker, so
this now just runs tools/fetch_vision.py (kept so the old command still works):

    python tools/fetch_vendor.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_vision import main  # noqa: E402

if __name__ == "__main__":
    main()
