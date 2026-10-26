import random

from oracle.personalities import Personality


def test_three_personalities_loaded(personalities):
    assert set(personalities) == {"sugar", "weary", "clinical"}


def test_each_personality_has_content(personalities):
    for p in personalities.values():
        assert p.reactions and p.interruptions and p.verdict_lines
        assert p.mishear_words


def test_verdict_fills_answers_and_defaults_missing_keys(personalities):
    verdict = personalities["sugar"].verdict({"proud": "my bike"})
    joined = " ".join(verdict)
    assert "my bike" in joined
    assert "nothing" in joined  # {worry} was missing


def test_mishear_changes_one_word(personalities):
    p: Personality = personalities["weary"]
    rng = random.Random(3)
    out = p.mishear("I fixed a bike", rng)
    assert out != "I fixed a bike"
    assert len(out.split()) == 4


def test_interruption_inserts_emotion(personalities):
    rng = random.Random(0)
    lines = {personalities["clinical"].interruption(rng, "smug") for _ in range(20)}
    assert any("smug" in line for line in lines)
    assert not any("{" in line for line in lines)
