"""Download the Oracle's room voices (meSpeak, eSpeak in the browser) into web/vendor/mespeak/.

    python tools/fetch_voices.py

The spoken Oracle (web/talk.html) puts its voices through reverb and echo. The
browser's own voices can't be routed through effects, so the room voices come
from meSpeak, which speaks into a sound buffer the page can process. Without
these files the page falls back to the browser's voices, with no effects.

meSpeak and eSpeak are GPL software, by Norbert Landsteiner and the eSpeak
authors; the files are used unmodified (the two source files are only wrapped so
a plain <script> can load them). Source: https://github.com/mikolalysenko/mespeak
About 5.6 MB. The package is checked against a pinned SHA-256. The folder is
ignored by git.
"""

from __future__ import annotations

import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "2.0.2"  # keep in step with VOICES_VERSION in web/js/roomvoice.js
PACKAGE_URL = f"https://registry.npmjs.org/mespeak/-/mespeak-{VERSION}.tgz"
PACKAGE_SHA256 = "e7bf9285dd555ba921e975e944f451a0c2cde82f6f8b6072d5a162b0daa93a53"

OUT = Path(__file__).resolve().parent.parent / "web" / "vendor" / "mespeak"

# The package is CommonJS (two files, no other dependencies). This wraps them so
# the browser gets window.meSpeak from one plain script.
WRAPPER = """/* meSpeak {version} (GPL), wrapped for a plain <script> by tools/fetch_voices.py.
 * Source: https://github.com/mikolalysenko/mespeak */
(function () {{
var espeak = {{ exports: {{}} }};
(function (module, exports) {{
{espeak}
}})(espeak, espeak.exports);
var mespeak = {{ exports: {{}} }};
(function (module, exports, require) {{
{index}
}})(mespeak, mespeak.exports, function () {{ return espeak.exports; }});
window.meSpeak = mespeak.exports;
}})();
"""


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
    with tarfile.open(fileobj=io.BytesIO(package), mode="r:gz") as tar:
        # Latin-1: ESpeak.js has a few non-UTF-8 bytes, all of them in comments.
        read = lambda name: tar.extractfile(f"package/{name}").read().decode("latin-1")  # noqa: E731
        script = WRAPPER.format(version=VERSION, espeak=read("src/ESpeak.js"), index=read("src/index.js"))
        files = {
            "mespeak.js": script,
            "mespeak_config.json": read("src/mespeak_config.json"),
            "en.json": read("voices/en/en.json"),
        }
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (OUT / name).write_text(text, encoding="utf-8", newline="\n")
    (OUT / "VERSION").write_text(VERSION + "\n", encoding="utf-8")
    print(f"ok: meSpeak {VERSION} in {OUT}")


if __name__ == "__main__":
    main()
