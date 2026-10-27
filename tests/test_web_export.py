"""The web version's data: tools/export_web.py and the committed web/data files.

If test_content_js_is_up_to_date fails, run `python tools/export_web.py` and
commit web/data/.
"""

import base64
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = WEB / "data"
FACE_MAPS = ("height", "sculpt", "mask", "luma", "color")


@pytest.fixture(scope="module")
def export_web():
    spec = importlib.util.spec_from_file_location("export_web", ROOT / "tools" / "export_web.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_js_data(path: Path, name: str):
    """Parse a generated `window.NAME = {...};` file back into Python data."""
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"window\.{name} = (.*);\s*$", text, re.S)
    assert match, f"{path.name} does not assign window.{name}"
    return json.loads(match.group(1))


# --- build_content -------------------------------------------------------------


def test_build_content_has_story_personalities_and_art(export_web):
    content = export_web.build_content()

    story = content["story"]
    assert story["start"] in story["nodes"]

    personalities = content["personalities"]
    assert set(personalities) == {"sugar", "weary", "clinical"}
    for pid, p in personalities.items():
        assert p["id"] == pid
        assert p["receipt"]["title"].strip()
        assert p["receipt"]["lines"]
        assert p["reactions"]

    assert {"sun", "rock", "tree"} <= set(content["art"])
    assert all(art.strip() for art in content["art"].values())

    assert 0 <= content["config"]["mishear_rate"] <= 1
    assert content["config"]["receipt_width"] > 0


def test_every_symbol_leads_to_a_known_personality(export_web):
    content = export_web.build_content()
    choices = [n for n in content["story"]["nodes"].values() if n["type"] == "choice"]
    picked = {o["personality"] for n in choices for o in n["options"] if "personality" in o}
    assert picked == set(content["personalities"])
    for node in choices:
        for option in node["options"]:
            if "art" in option:
                assert option["art"] in content["art"]


# --- committed files -------------------------------------------------------------


def test_content_js_is_up_to_date(export_web, tmp_path, monkeypatch):
    """The committed web/data/content.js must equal a fresh export.

    Fails when content/ (or config.yaml) changed but nobody re-ran the exporter:
    run `python tools/export_web.py` and commit web/data/.
    """
    fresh = export_web.build_content()
    monkeypatch.setattr(export_web, "ROOT", tmp_path)  # write_js prints paths relative to ROOT
    export_web.write_js(tmp_path / "content.js", "ORACLE_CONTENT", fresh)
    # read_text uses universal newlines, so a Windows CRLF checkout compares equal.
    expected = (tmp_path / "content.js").read_text(encoding="utf-8")
    committed = (DATA / "content.js").read_text(encoding="utf-8")
    assert committed == expected, (
        "web/data/content.js is stale: run `python tools/export_web.py` and commit web/data/"
    )


def test_committed_face_maps_decode_to_w_times_h_bytes():
    face = read_js_data(DATA / "face.js", "ORACLE_FACE")
    w, h = face["w"], face["h"]
    assert w > 0 and h > 0
    for name in FACE_MAPS:
        raw = base64.b64decode(face[name], validate=True)
        assert len(raw) == w * h, f"face.{name}: {len(raw)} bytes, expected {w * h}"
    mask = base64.b64decode(face["mask"])
    assert any(mask), "the face mask is empty"
    colors = set(base64.b64decode(face["color"]))
    assert colors <= set(face["classes"].values())


def test_fresh_face_export_matches_committed(export_web):
    pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    fresh = export_web.build_face()
    committed = read_js_data(DATA / "face.js", "ORACLE_FACE")
    assert (fresh["w"], fresh["h"]) == (committed["w"], committed["h"])
    assert fresh["classes"] == committed["classes"]
    for name in FACE_MAPS:
        a = np.frombuffer(base64.b64decode(fresh[name]), np.uint8)
        b = np.frombuffer(base64.b64decode(committed[name]), np.uint8)
        assert a.size == fresh["w"] * fresh["h"]
        assert a.shape == b.shape
        if name != "color":  # colour classes are categories, compared below
            # Different OpenCV builds can round a pixel differently; allow that,
            # but not a different picture.
            diff = np.abs(a.astype(int) - b.astype(int)).mean()
            assert diff < 2, f"face.{name} differs from a fresh export (mean diff {diff:.2f})"
    a = np.frombuffer(base64.b64decode(fresh["color"]), np.uint8)
    b = np.frombuffer(base64.b64decode(committed["color"]), np.uint8)
    assert (a != b).mean() < 0.02, "face colour classes differ from a fresh export"


@pytest.mark.parametrize("page", ["index.html", "readout.html"])
def test_page_files_exist(page):
    """Every script and stylesheet a page loads is in web/ (so Pages serves it)."""
    html = (WEB / page).read_text(encoding="utf-8")
    refs = re.findall(r'<(?:script[^>]*\bsrc|link[^>]*\bhref)="([^"]+)"', html)
    assert refs
    missing = [r for r in refs if "://" not in r and not (WEB / r).is_file()]
    assert not missing, f"web/{page} loads files that don't exist: {missing}"


def test_vision_versions_match():
    """tools/fetch_vision.py downloads the tracker version that web/js/vision.js asks for."""
    tool = (ROOT / "tools" / "fetch_vision.py").read_text(encoding="utf-8")
    js = (WEB / "js" / "vision.js").read_text(encoding="utf-8")
    py_version = re.search(r'^VERSION = "([^"]+)"', tool, re.M).group(1)
    js_version = re.search(r'VISION_VERSION = "([^"]+)"', js).group(1)
    assert py_version == js_version
