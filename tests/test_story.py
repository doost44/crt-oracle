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
