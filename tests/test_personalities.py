import random
from itertools import combinations

import pytest

from oracle.personalities import Personality, load_personality

IDS = ["sugar", "weary", "clinical"]


def test_three_personalities_loaded(personalities):
    assert set(personalities) == set(IDS)
    assert {p.id: p.symbol for p in personalities.values()} == {
        "sugar": "sun",
        "weary": "rock",
        "clinical": "tree",
    }


@pytest.mark.parametrize("pid", IDS)
def test_each_personality_meets_minimum_counts(personalities, pid):
    p = personalities[pid]
    assert len(p.reactions) >= 8
    assert len(p.interruptions) >= 8
    assert len(p.mishear_lines) >= 5
    assert len(p.mishear_words) >= 10
    assert len(p.verdict_lines) >= 3
    assert p.verdict_footer and p.fine_print
    assert p.receipt_title and p.receipt_title != "THE ORACLE HAS SPOKEN"


def _all_lines(p: Personality) -> set[str]:
    return set(
        p.reactions
        + p.interruptions
        + p.mishear_lines
        + p.mishear_words
        + p.verdict_lines
        + p.fine_print
        + [p.verdict_footer, p.verdict_header, p.receipt_title, p.heard_note]
    )


def test_no_two_personalities_share_a_line(personalities):
    for a, b in combinations(personalities.values(), 2):
        shared = _all_lines(a) & _all_lines(b)
        assert not shared, f"{a.id} and {b.id} share {shared}"


def test_no_duplicates_within_a_personality(personalities):
    for p in personalities.values():
        for group in (p.reactions, p.interruptions, p.mishear_lines, p.mishear_words):
            assert len(group) == len(set(group)), p.id


@pytest.mark.parametrize("pid", IDS)
def test_every_interruption_formats_with_emotion(personalities, pid):
    for line in personalities[pid].interruptions:
        assert "{emotion}" in line
        assert not line.startswith("{")  # test_runner matches on the text before "{"
        out = line.format(emotion="smug")
        assert "smug" in out and "{" not in out


@pytest.mark.parametrize("pid", IDS)
def test_every_mishear_line_uses_heard(personalities, pid):
    for line in personalities[pid].mishear_lines:
        out = line.format(heard="pickles")
        assert "pickles" in out and "{" not in out


def test_mishear_line_with_and_without_rng(personalities):
    p = personalities["sugar"]
    assert "ponies" in p.mishear_line("ponies")  # runner calls it with no rng
    a = [p.mishear_line("x y", random.Random(5)) for _ in range(3)]
    assert len(set(a)) == 1  # same seed, same line
    seen = {p.mishear_line("x y", random.Random(seed)) for seed in range(50)}
    assert len(seen) > 1  # it really does choose between lines


def test_old_single_template_schema_still_loads(tmp_path):
    path = tmp_path / "old.yaml"
    path.write_text(
        "id: old\nname: OLD\nsymbol: sun\nreactions: [hi]\ninterruptions: ['{emotion}?']\n"
        "mishear:\n  template: \"Heard '{heard}'.\"\n  words: [moss]\n"
        "verdict:\n  header: H\n  lines: ['{proud}']\n  footer: F\n",
        encoding="utf-8",
    )
    p = load_personality(path)
    assert p.mishear_lines == ["Heard '{heard}'."]
    assert p.mishear_line("moss") == "Heard 'moss'."
    assert p.receipt_title == "THE ORACLE HAS SPOKEN"
    assert p.verdict_header == "H" and p.verdict_footer == "F"


def test_verdict_fills_answers_and_defaults_missing_keys(personalities):
    for p in personalities.values():
        joined = " ".join(p.verdict({"proud": "my bike", "worry": "rain"}))
        assert "my bike" in joined and "rain" in joined
        assert "nothing" in joined  # {wish} was missing
        assert "{" not in joined


def test_verdict_uses_all_three_answer_keys(personalities):
    for p in personalities.values():
        raw = " ".join(p.verdict_lines)
        assert "{proud}" in raw and "{worry}" in raw and "{wish}" in raw


def test_mishear_changes_one_word(personalities):
    for p in personalities.values():
        rng = random.Random(3)
        out = p.mishear("I fixed a bike", rng)
        assert out != "I fixed a bike"
        assert any(w in out for w in p.mishear_words)


def test_interruption_inserts_emotion(personalities):
    rng = random.Random(0)
    lines = {personalities["clinical"].interruption(rng, "smug") for _ in range(20)}
    assert any("smug" in line for line in lines)
    assert not any("{" in line for line in lines)
