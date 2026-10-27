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
    # backend stays "mock" here so tests and --demo never need a camera;
    # config.yaml switches it to "opencv" for the real thing.
    "camera": {
        "backend": "mock",
        "device_index": 0,
        "api": "auto",  # auto | dshow | msmf | avfoundation | v4l2 | any
        "preview": "feed",  # feed | box | off
        "detect_fps": 10.0,  # face detections per second on the live feed
        "detect_width": 640,  # shrink wider frames to this before detecting (0 = never)
        "min_face_size": 40,  # smallest face worth noticing, in camera pixels
        "detector": "yunet",  # yunet (neural net, better) | haar (the old classic)
        "score_threshold": 0.6,  # yunet only: lower finds more faces, and more false ones
    },
    "face": {"enabled": True, "min_face_seconds": 4.0, "min_gap_seconds": 20.0},
    "printer": {
        "backend": "file",
        "width": 32,
        "out_dir": "out",
        "lp_destination": "",
    },
    # The live conversation (python -m oracle.server). See docs/LIVE_ORACLE.md.
    "live": {
        "brain": "auto",  # auto (Claude when ANTHROPIC_API_KEY is set) | claude | mock
        "model": "claude-opus-5-5",
        "effort": "low",  # low keeps replies quick; medium/high think longer
        "max_tokens": 4000,  # per reply, thinking included
        "fallbacks": True,  # retry declined requests on a fallback model (Claude API only)
        "timeout_seconds": 30,
        "max_turns": 8,  # visitor answers before the Oracle closes the conversation
        "receipt_width": 32,
        "prompts_dir": "content/oracle",
        "log_dir": "out/sessions",
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
