import io

import pytest

from oracle.camera import MockCamera, MockDetector
from oracle.display import ConsoleDisplay
from oracle.inputs import ScriptedInput
from oracle.interrupter import Interrupter
from oracle.receipt import FileReceiptPrinter
from oracle.runner import run_session


def _run(make_session, root, tmp_path, lines, detector=None, clock=None, mishear_rate=0.0):
    out = io.StringIO()
    session = make_session(mishear_rate=mishear_rate)
    kwargs = {}
    if detector:
        kwargs = dict(
            camera=MockCamera(),
            detector=detector,
            interrupter=Interrupter(min_face_seconds=4, min_gap_seconds=20),
            clock=clock,
        )
    result = run_session(
        session,
        ConsoleDisplay(out=out, typewriter_delay=0),
        ScriptedInput(lines),
        root / "content" / "art",
        FileReceiptPrinter(tmp_path),
        **kwargs,
    )
    return out.getvalue(), result


def test_full_run_prints_a_receipt(make_session, root, tmp_path):
    output, path = _run(make_session, root, tmp_path, ["2", "my bike", "my job", "", "", ""])
    assert "Welcome" in output
    assert "RECEIPT IS PRINTING" in output
    assert "WEARY" in open(path).read()


def test_invalid_menu_choice_is_asked_again(make_session, root, tmp_path):
    output, _ = _run(make_session, root, tmp_path, ["9", "x", "1", "a", "b", "", "", ""])
    assert output.count("NOT AN OPTION") == 2


def test_face_triggers_interruption_before_verdict(make_session, root, tmp_path):
    ticks = iter(range(0, 100, 3))
    output, _ = _run(
        make_session, root, tmp_path, ["1", "a", "b", "", "", ""],
        detector=MockDetector([True]), clock=lambda: next(ticks),
    )
    # At least one sun-flavoured interruption line appears
    assert any(w in output for w in ("Sweetie", "Smile!", "still here"))


def test_script_running_out_raises(make_session, root, tmp_path):
    with pytest.raises(EOFError):
        _run(make_session, root, tmp_path, ["1"])
