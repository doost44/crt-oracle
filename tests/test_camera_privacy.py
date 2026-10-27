"""Camera privacy rule: frames are never saved. This fails if code that saves,
encodes or records images appears anywhere in oracle/ or tools/."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN = re.compile(r"imwrite|VideoWriter|imencode|np\.save")


def test_no_code_saves_camera_frames():
    offenders = []
    files = sorted((ROOT / "oracle").rglob("*.py")) + sorted((ROOT / "tools").rglob("*.py"))
    assert files
    for path in files:
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if FORBIDDEN.search(line):
                offenders.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
    assert not offenders, "frames must never be saved:\n" + "\n".join(offenders)
