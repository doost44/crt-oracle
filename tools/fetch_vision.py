"""Download the browser face tracker (MediaPipe Face Landmarker) into web/vendor/mediapipe/.

    python tools/fetch_vision.py

The web version loads the tracker from web/vendor/mediapipe/ when it is there and
from a CDN when it is not. Run this once on the exhibit laptop so the Oracle works
with no internet, and before publishing (the GitHub Pages workflow runs it too).
About 13 MB. Every file is checked against a pinned SHA-256 before it is written.
The folder is ignored by git.
"""

from __future__ import annotations

import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "0.10.21"  # keep in step with VISION_VERSION in web/js/vision.js
PACKAGE_URL = f"https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-{VERSION}.tgz"
PACKAGE_SHA256 = "343736570f433c0100ffc360dbe70f09cc502a5fc573f5cd95954692edc9cfde"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

# Files taken from the npm package -> where they go under web/vendor/mediapipe/
PACKAGE_FILES = {
    "package/vision_bundle.mjs": "vision_bundle.mjs",
    "package/wasm/vision_wasm_internal.js": "wasm/vision_wasm_internal.js",
    "package/wasm/vision_wasm_internal.wasm": "wasm/vision_wasm_internal.wasm",
}

OUT = Path(__file__).resolve().parent.parent / "web" / "vendor" / "mediapipe"


def download(url: str, sha256: str) -> bytes:
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as res:
        data = res.read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha256:
        sys.exit(f"checksum mismatch for {url}\n  expected {sha256}\n  got      {got}")
    return data


def main() -> None:
    package = download(PACKAGE_URL, PACKAGE_SHA256)
    model = download(MODEL_URL, MODEL_SHA256)
    with tarfile.open(fileobj=io.BytesIO(package), mode="r:gz") as tar:
        for member, dest in PACKAGE_FILES.items():
            target = OUT / dest
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(tar.extractfile(member).read())
    (OUT / "face_landmarker.task").write_bytes(model)
    (OUT / "VERSION").write_text(VERSION + "\n", encoding="utf-8")
    print(f"ok: MediaPipe tasks-vision {VERSION} in {OUT}")


if __name__ == "__main__":
    main()
