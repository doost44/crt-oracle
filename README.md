# CRT Oracle

A deceptive little oracle for a gallery installation. A Panasonic camcorder is its eye, an early-2000s CRT is its face, and a receipt printer delivers its verdict. Visitors pick a symbol (sun, rock or tree), answer questions, and are gently misled by a passive-aggressive character that is never quite responsive.

This is the starter repo: the story engine, three personalities, the camera and face-box logic, a console display and a file-based receipt printer. It runs with **no hardware**, so you can build the content and logic first and add the hardware step by step.

## Web version

A browser version of the Oracle lives in [web/](web/): static HTML, CSS and JavaScript that reads the same `content/` files. It runs locally with `py -m http.server 8000 -d web` and publishes to GitHub Pages at https://doost44.github.io/crt-oracle/. How to run, re-export the content and publish: [web/README.md](web/README.md).

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,camera]"   # camera = OpenCV, for the webcam
python -m pytest                 # no hardware needed
python -m oracle --demo          # scripted run: prints a receipt into out/
python -m oracle --camera-check  # webcam with face boxes, no story (q quits)
python -m oracle                 # play it yourself, watched by the webcam
python -m oracle --no-camera     # play it without a webcam
```

Step-by-step for macOS and Windows, and what to expect: [docs/RUN_ON_LAPTOP.md](docs/RUN_ON_LAPTOP.md).

Requires Python 3.10 or newer.

## How it works

```
oracle/
  main.py          command line entry point (--demo, --config, --seed)
  config.py        defaults + config.yaml
  story.py         loads and checks content/story.yaml (the branching graph)
  personalities.py loads the three voices from content/personalities/
  session.py       one visitor's state: choices, answers, what the Oracle "heard"
  runner.py        plays a session: display, input, camera, interruptions, receipt
  display.py       ConsoleDisplay (typewriter text, ASCII art, menus)
  inputs.py        KeyboardInput, ScriptedInput, SpeechInput (placeholder)
  interrupter.py   rules for when the Oracle interrupts a watched face
  live.py          live webcam: background watcher, face-box preview window
  receipt.py       receipt formatting + printers (file, lp)
  camera/          MockCamera/MockDetector, plus OpenCV camera and face detector
content/
  story.yaml       questions and branching (all placeholders for now)
  personalities/   sugar.yaml, weary.yaml, clinical.yaml
  art/             sun.txt, rock.txt, tree.txt (placeholder ASCII)
tests/             pytest suite
tools/list_cameras.py   finds the capture adapter's camera index
docs/PLAN.md       the project plan
docs/WINDOWS_SETUP.md  installing and running on the Windows laptop
```

Everything the visitor reads lives in `content/` as plain text, so you can change the writing without touching Python. After editing `story.yaml`, run `python -m pytest`: it catches broken `next:` links.

### Writing the story

Node types (details in `oracle/story.py`): `say`, `choice`, `ask`, `mash` (press Enter N times) and `end`. Text can insert earlier answers as `{proud}`, `{worry}` or `{wish}`, and can vary by personality:

```yaml
wake:
  type: mash
  count: 3
  text:
    default: "Press Enter three times."
    weary: "Press Enter three times. Not that it matters."
  next: verdict
```

### The three personalities

Proposed pairing, easy to change in `story.yaml`: **sun = Sugar** (cheerful, cruel), **rock = Weary** (flat, tired), **tree = Clinical** (cold, lab-report). Each personality file holds its reactions, interruptions, mishearing words and receipt text. What sets them apart: [docs/PERSONALITIES.md](docs/PERSONALITIES.md). The questions are all placeholders for now: [docs/QUESTIONS.md](docs/QUESTIONS.md).

### Mishearing and interruptions

- `story.mishear_rate` in `config.yaml` is the chance the Oracle swaps one word of a typed answer. The visitor's real answer is kept; the receipt shows what the Oracle "heard".
- With a face in view for `min_face_seconds`, and at least `min_gap_seconds` since the last one, the Oracle interrupts with a line from its personality. The emotion shown is a deliberately unreliable guess. Interruptions never fire during the verdict.
- With the webcam (`camera.backend: opencv`), `oracle/live.py` watches the camera in a background thread, so the Oracle interrupts as soon as the rules allow, even while the visitor is typing. A preview window shows the face box (`camera.preview: feed`, `box` for boxes on black, or `off`). Frames are never saved; `tests/test_camera_privacy.py` guards that.
- With `--no-camera` or `--demo`, interruptions are checked **between** story steps.

## Adding the hardware

1. **Capture adapter.** Plug it in, then `pip install -e ".[camera]"` and run `python tools/list_cameras.py`. Set `camera.backend: opencv` and `camera.device_index` in `config.yaml`. The camcorder's yellow RCA plug carries the video.
2. **CRT.** The CRT takes VGA. Make the laptop's display output reach it (a VGA port or an active HDMI-to-VGA adapter) and check which resolution it accepts. Layouts assume an 80 by 24 character grid.
3. **Printer.** Set `printer.backend: lp` and `printer.lp_destination` to a CUPS printer name. A USB thermal receipt printer is the usual choice. Until then, receipts are written to `out/`.

OpenCV is pinned below version 5 because OpenCV 5 dropped the classic face detector this repo uses. The camera extra installs a compatible version.

## Not built yet

- Full-screen CRT display with the phosphor look (replaces ConsoleDisplay)
- Speech input (`SpeechInput` is a stub; it only needs a `read_line()` method)
- Final questions, ASCII art from your images, and polished personality scripts
- Attract screen, reset between visitors, auto restart

The camera never saves frames. If you add recording, put a sign up.

## Privacy

The piece uses a camera to find faces. Frames are processed in memory and not stored. Tell visitors the camera is on.
