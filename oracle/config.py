"""Config loading: defaults, overridden by config.yaml."""

from __future__ import annotations

import copy
from pathlib import Path

import yaml

DEFAULTS: dict = {
    "story": {
        "path": "content/story.yaml",
        "personalities_dir": "content/personalities",
        "art_dir": "content/art",
        "mishear_rate": 0.25,
    },
    "display": {
        "backend": "console",
        "cols": 80,
        "rows": 24,
        "typewriter_delay": 0.02,
        "color": "green",
        # Settings for the "crt" backend only:
        "fullscreen": True,
        "window": [1024, 768],
        "font": "",
        "scanlines": True,
        "glow": True,
        "flicker": 0.03,
    },
    "camera": {"backend": "mock", "device_index": 0},
    "face": {"enabled": True, "min_face_seconds": 4.0, "min_gap_seconds": 20.0},
    "printer": {
        "backend": "file",
        "width": 32,
        "out_dir": "out",
        "lp_destination": "",
    },
}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | Path | None = None) -> dict:
    """Return the defaults, overridden by the YAML file at `path` if it exists."""
    if path is None:
        return copy.deepcopy(DEFAULTS)
    path = Path(path)
    if not path.exists():
        return copy.deepcopy(DEFAULTS)
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return _merge(DEFAULTS, data)
