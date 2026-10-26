from datetime import datetime

from oracle.display import load_art
from oracle.receipt import FileReceiptPrinter, build_receipt


def test_receipt_fits_width_and_names_personality(make_session):
    s = make_session()
    s.advance()
    s.choose(0)
    s.answer("a very long answer that has to be wrapped onto several lines of a narrow receipt")
    s.answer("short")
    s.advance()
    text = build_receipt(s, width=32, now=datetime(2026, 10, 26, 12, 0))
    assert "SUGAR" in text and "2026-10-26 12:00" in text
    assert all(len(line) <= 32 for line in text.splitlines())


def test_file_printer_writes_receipt(tmp_path):
    path = FileReceiptPrinter(tmp_path).print("hello\n")
    assert (tmp_path / path.split("/")[-1]).read_text() == "hello\n"


def test_every_personality_symbol_has_art_that_fits_a_crt(root, personalities):
    for p in personalities.values():
        art = load_art(root / "content" / "art", p.symbol)
        lines = art.splitlines()
        assert 0 < len(lines) <= 24
        assert max(len(line) for line in lines) <= 80
