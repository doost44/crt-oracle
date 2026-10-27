import pytest


def test_choosing_a_symbol_sets_personality(make_session):
    s = make_session()
    s.advance()  # welcome -> pick_symbol
    s.choose(1)  # rock
    assert s.personality.id == "weary"
    assert s.node_id == "rock_intro"


def test_answers_are_stored_and_story_advances(make_session):
    s = make_session()
    s.advance()
    s.choose(0)
    s.advance()  # sun_intro -> sun_q1
    heard, misheard = s.answer("my bike")
    assert (heard, misheard) == ("my bike", False)
    assert s.answers["proud"] == "my bike"
    assert s.node_id == "sun_q2"


def test_mishear_rate_one_always_twists(make_session):
    s = make_session(mishear_rate=1.0)
    s.advance()
    s.choose(2)  # tree / clinical
    s.advance()  # tree_intro -> tree_q1
    heard, misheard = s.answer("I fixed a bike")
    assert misheard and heard != "I fixed a bike"
    assert s.answers["proud"] == "I fixed a bike"  # the visitor's real answer is kept
    assert s.heard["proud"] == heard


def test_wake_text_varies_by_personality(make_session):
    s = make_session()
    s.advance()
    s.choose(1)  # weary
    s.advance()  # rock_intro
    s.answer("a")
    s.answer("b")
    s.answer("c")
    assert s.node_id == "wake"
    assert "Not that it matters" in s.text()


@pytest.mark.parametrize(
    "index, branch, pid",
    [(0, "sun", "sugar"), (1, "rock", "weary"), (2, "tree", "clinical")],
)
def test_each_branch_walks_to_the_end(make_session, index, branch, pid):
    s = make_session()
    s.advance()  # welcome -> pick_symbol
    s.choose(index)
    assert s.personality.id == pid
    assert s.node_id == f"{branch}_intro"
    assert s.text()  # intro speaks in this personality's voice
    s.advance()
    for key in ("proud", "worry", "wish"):
        assert s.node.type == "ask" and s.node.key == key
        assert "PLACEHOLDER" in s.text()  # visible on screen too
        s.answer(f"my {key}")
    assert s.node_id == "wake"
    s.advance()  # wake -> verdict
    assert s.finished
    assert s.answers == {"proud": "my proud", "worry": "my worry", "wish": "my wish"}
    assert s.path == ["welcome", "pick_symbol", f"{branch}_intro",
                      f"{branch}_q1", f"{branch}_q2", f"{branch}_q3", "wake"]
