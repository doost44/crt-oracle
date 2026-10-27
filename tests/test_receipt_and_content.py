from datetime import datetime

import pytest

from oracle.display import load_art
from oracle.receipt import FileReceiptPrinter, build_receipt


def test_receipt_fits_width_and_names_personality(make_session):
    s = make_session()
    s.advance()
    s.choose(0)
    s.advance()
    s.answer("a very long answer that has to be wrapped onto several lines of a narrow receipt")
    s.answer("short")
    s.answer("a boat")
    s.advance()
    text = build_receipt(s, width=32, now=datetime(2026, 10, 26, 12, 0))
    assert "SUGAR" in text and "2026-10-26 12:00" in text
    assert all(len(line) <= 32 for line in text.splitlines())


@pytest.mark.parametrize("option", [0, 1, 2])
@pytest.mark.parametrize("width", [24, 32, 42])
def test_every_personality_receipt_fits_width(make_session, option, width):
    for seed in range(5):
        s = make_session(seed=seed, mishear_rate=0.5)
        s.advance()
        s.choose(option)
        s.advance()
        s.answer("an extraordinarily_long_unbroken_word_that_cannot_wrap_nicely at all")
        s.answer("short")
        s.answer("a boat")
        s.advance()
        text = build_receipt(s, width=width, now=datetime(2026, 10, 26, 12, 0))
        assert all(len(line) <= width for line in text.splitlines()), text


@pytest.mark.parametrize("option", [0, 1, 2])
def test_receipt_uses_personality_title_heard_and_fine_print(make_session, option):
    s = make_session(seed=4, mishear_rate=1.0)
    s.advance()
    s.choose(option)
    s.advance()
    s.answer("my garden")
    s.answer("the dark")
    s.answer("a boat")
    s.advance()
    p = s.personality
    text = build_receipt(s, width=32, now=datetime(2026, 10, 26, 12, 0))
    flat = " ".join(text.split())
    assert " ".join(p.receipt_title.split()) in flat
    assert "THE ORACLE HAS SPOKEN" not in text
    assert "WHAT YOU SAID" in text and p.heard_note in flat
    for heard in s.heard.values():  # shows what the Oracle heard, not what was typed
        assert " ".join(heard.split()) in flat
    assert any(" ".join(f.split()) in flat for f in p.fine_print)
    assert "{" not in text


def test_file_printer_writes_receipt(tmp_path):
    path = FileReceiptPrinter(tmp_path).print("hello\n")
    assert (tmp_path / path.split("/")[-1]).read_text() == "hello\n"


def test_every_personality_symbol_has_art_that_fits_a_crt(root, personalities):
    for p in personalities.values():
        art = load_art(root / "content" / "art", p.symbol)
        lines = art.splitlines()
        assert 0 < len(lines) <= 24
        assert max(len(line) for line in lines) <= 80
