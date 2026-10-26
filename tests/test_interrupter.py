from oracle.interrupter import Interrupter


def test_needs_face_for_minimum_time():
    i = Interrupter(min_face_seconds=4, min_gap_seconds=20)
    assert not i.update(0, 1)
    assert not i.update(3, 1)
    assert i.update(4, 1)


def test_gap_between_interruptions():
    i = Interrupter(min_face_seconds=1, min_gap_seconds=20)
    i.update(0, 1)
    assert i.update(1, 1)
    assert not i.update(10, 1)
    assert i.update(21, 1)


def test_face_leaving_resets_timer():
    i = Interrupter(min_face_seconds=4, min_gap_seconds=0)
    i.update(0, 1)
    i.update(3, 0)  # face gone
    assert not i.update(5, 1)  # timer restarted at 5
    assert i.update(9, 1)


def test_suspended_and_disabled_never_fire():
    i = Interrupter(min_face_seconds=0, min_gap_seconds=0)
    i.suspended = True
    assert not i.update(100, 1)
    off = Interrupter(enabled=False, min_face_seconds=0)
    assert not off.update(100, 1)
