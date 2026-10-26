def test_choosing_a_symbol_sets_personality(make_session):
    s = make_session()
    s.advance()  # welcome -> pick_symbol
    s.choose(1)  # rock
    assert s.personality.id == "weary"
    assert s.node_id == "rock_q1"


def test_answers_are_stored_and_story_advances(make_session):
    s = make_session()
    s.advance()
    s.choose(0)
    heard, misheard = s.answer("my bike")
    assert (heard, misheard) == ("my bike", False)
    assert s.answers["proud"] == "my bike"
    assert s.node_id == "sun_q2"


def test_mishear_rate_one_always_twists(make_session):
    s = make_session(mishear_rate=1.0)
    s.advance()
    s.choose(2)  # tree / clinical
    heard, misheard = s.answer("I fixed a bike")
    assert misheard and heard != "I fixed a bike"
    assert s.answers["proud"] == "I fixed a bike"  # the visitor's real answer is kept
    assert s.heard["proud"] == heard


def test_wake_text_varies_by_personality(make_session):
    s = make_session()
    s.advance()
    s.choose(1)  # weary
    s.answer("a")
    s.answer("b")
    assert s.node_id == "wake"
    assert "Not that it matters" in s.text()


def test_full_walk_reaches_end(make_session):
    s = make_session()
    s.advance()
    s.choose(0)
    s.answer("a")
    s.answer("b")
    s.advance()  # wake -> verdict
    assert s.finished
