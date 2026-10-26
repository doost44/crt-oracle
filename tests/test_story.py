import pytest

from oracle.story import Story, StoryError


def test_default_story_loads_and_validates(story):
    assert story.start == "welcome"
    assert any(n.type == "end" for n in story.nodes.values())


def test_every_choice_option_names_a_personality_and_art(story):
    for node in story.nodes.values():
        if node.type == "choice":
            for option in node.options:
                assert option.personality
                assert option.art


def test_missing_target_is_rejected():
    bad = {
        "start": "a",
        "nodes": {
            "a": {"type": "say", "text": "hi", "next": "nowhere"},
            "z": {"type": "end"},
        },
    }
    with pytest.raises(StoryError, match="missing node"):
        Story.from_dict(bad)


def test_unknown_type_is_rejected():
    with pytest.raises(StoryError, match="unknown type"):
        Story.from_dict({"start": "a", "nodes": {"a": {"type": "dance"}}})


def test_story_without_end_is_rejected():
    with pytest.raises(StoryError, match="no 'end'"):
        Story.from_dict({"start": "a", "nodes": {"a": {"type": "say", "text": "x", "next": "a"}}})


BRANCHES = {0: "sun", 1: "rock", 2: "tree"}  # pick_symbol option index -> branch prefix


def _branch_asks(story, first):
    """Follow `next` links from `first` until the shared wake node; return the ask nodes."""
    asks, node_id = [], first
    while node_id != "wake":
        node = story.nodes[node_id]
        if node.type == "ask":
            asks.append(node)
        node_id = node.next
    return asks


def test_symbols_map_to_personalities_and_art(story):
    options = story.nodes["pick_symbol"].options
    assert [(o.art, o.personality) for o in options] == [
        ("sun", "sugar"),
        ("rock", "weary"),
        ("tree", "clinical"),
    ]


def test_every_question_is_a_placeholder(story):
    # Intentional guard while the questions are placeholders. Once the real
    # questions land in content/story.yaml, this test will fail: delete it then.
    asks = [n for n in story.nodes.values() if n.type == "ask"]
    assert len(asks) == 9
    for node in asks:
        assert "PLACEHOLDER" in str(node.text), node.id


def test_each_branch_asks_proud_worry_wish_in_order(story):
    for option in story.nodes["pick_symbol"].options:
        asks = _branch_asks(story, option.next)
        assert [n.key for n in asks] == ["proud", "worry", "wish"], option.next


def test_wake_is_a_three_press_mash_before_the_verdict(story):
    wake = story.nodes["wake"]
    assert wake.type == "mash" and wake.count == 3
    assert story.nodes[wake.next].type == "end"
