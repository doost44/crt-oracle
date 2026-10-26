import random
from pathlib import Path

import pytest

from oracle.personalities import load_personalities
from oracle.session import Session
from oracle.story import Story

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def root() -> Path:
    return ROOT


@pytest.fixture
def story() -> Story:
    return Story.load(ROOT / "content" / "story.yaml")


@pytest.fixture
def personalities():
    return load_personalities(ROOT / "content" / "personalities")


@pytest.fixture
def make_session(story, personalities):
    def _make(seed: int = 1, mishear_rate: float = 0.0) -> Session:
        return Session(story, personalities, rng=random.Random(seed), mishear_rate=mishear_rate)

    return _make
