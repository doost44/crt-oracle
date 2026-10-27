"""Download MediaPipe's face tracker into web/vendor/ so the physical actions work offline.

Run once from the repo root on the exhibit laptop (about 40 MB):

    python tools/fetch_vendor.py

The web page looks in web/vendor/mediapipe/ first and falls back to the CDN when the
files aren't there, so this is only needed for running without internet. The files
are not committed (web/vendor/ is in .gitignore). Standard library only.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "vendor" / "mediapipe"

# Keep in step with MP_VERSION in web/js/facetrack.js.
MP_VERSION = "0.10.35"
PACKAGE = f"https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-{MP_VERSION}.tgz"
MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
KEEP = {
    "package/vision_bundle.mjs": "vision_bundle.mjs",
    "package/wasm/vision_wasm_internal.js": "wasm/vision_wasm_internal.js",
    "package/wasm/vision_wasm_internal.wasm": "wasm/vision_wasm_internal.wasm",
    "package/wasm/vision_wasm_nosimd_internal.js": "wasm/vision_wasm_nosimd_internal.js",
    "package/wasm/vision_wasm_nosimd_internal.wasm": "wasm/vision_wasm_nosimd_internal.wasm",
}


def fetch(url: str) -> bytes:
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def package_integrity() -> str:
    """The sha512 the npm registry publishes for this version."""
    meta = json.loads(fetch(f"https://registry.npmjs.org/@mediapipe/tasks-vision/{MP_VERSION}"))
    return meta["dist"]["integrity"]


def main() -> int:
    integrity = package_integrity()
    tgz = fetch(PACKAGE)
    algo, _, want = integrity.partition("-")
    got = base64.b64encode(hashlib.new(algo, tgz).digest()).decode()
    if got != want:
        print(f"the package download doesn't match the registry's checksum ({integrity})", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "wasm").mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tgz), mode="r:gz") as tar:
        for member in tar.getmembers():
            target = KEEP.get(member.name)
            if target and member.isfile():
                data = tar.extractfile(member).read()
                (OUT / target).write_bytes(data)
                print(f"  wrote web/vendor/mediapipe/{target} ({len(data) // 1024} KB)")

    model = fetch(MODEL)
    (OUT / "face_landmarker.task").write_bytes(model)
    print(f"  wrote web/vendor/mediapipe/face_landmarker.task ({len(model) // 1024} KB)")
    print("done: the physical actions now work without internet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
