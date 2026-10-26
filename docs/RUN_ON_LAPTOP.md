# Running the outline prototype on your laptop

This walks through the whole visit with the laptop's built-in webcam (OpenCV, camera 0), typed answers in the terminal, the console display with placeholder ASCII art, and the receipt written to a text file in `out/`.

Frames are never saved. The webcam picture is only held in memory, one frame at a time, for the preview window.

## macOS (Terminal)

```bash
git clone -b claude/project-thread-jiy3de https://github.com/doost44/crt-oracle.git
cd crt-oracle
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,camera]"
python -m pytest                 # all tests, no camera needed
python -m oracle --demo          # scripted visit, no camera; receipt goes to out/
python -m oracle --camera-check  # webcam + face boxes only, q quits
python -m oracle                 # the real walk-through with the webcam
```

The first time, macOS asks whether Terminal may use the camera. Allow it, then run the command again (the first run often fails while the prompt is up). If it was refused earlier: System Settings > Privacy & Security > Camera, switch on Terminal (or iTerm / VS Code), then quit and reopen that app.

## Windows (PowerShell)

```powershell
git clone -b claude/project-thread-jiy3de https://github.com/doost44/crt-oracle.git
cd crt-oracle
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev,camera]"
python -m pytest
python -m oracle --demo
python -m oracle --camera-check
python -m oracle
```

If PowerShell refuses `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. If the camera won't open: Settings > Privacy & security > Camera, turn on "Let desktop apps access your camera", and close Teams or Zoom. If the picture is black, set `camera.api: msmf` in `config.yaml`.

Every new terminal: `cd crt-oracle` and activate the venv again (`source .venv/bin/activate` or `.\.venv\Scripts\Activate.ps1`).

## What you should see

1. A window titled **CRT Oracle camera** opens with your webcam and a green box around your face, labelled with a (deliberately wrong) mood. **The window takes keyboard focus: click back into the terminal to type.**
2. In the terminal: the welcome line, the sun / rock / tree menu, the ASCII art, then three questions marked `[PLACEHOLDER ...]`.
3. Keep your face in view. After 4 seconds the Oracle interrupts in its own voice, even while you're typing (your half-typed answer is kept; just carry on and press Enter). It won't interrupt more than once every 20 seconds, and never during the verdict.
4. Sometimes it "mishears" an answer and swaps a word.
5. Press Enter three times to wake it, read the verdict, and find the receipt in `out/receipt-....txt`.

## Useful switches

| Command | What it does |
| --- | --- |
| `python -m oracle --preview box` | Face boxes on black, no picture of you (the privacy-friendly gallery option) |
| `python -m oracle --preview off` | No window at all; interruptions still work |
| `python -m oracle --no-camera` | Play without a webcam |
| `python -m oracle --seed 3` | Same mishearings and lines every time |
| `camera.detector: haar` in `config.yaml` | Switch back to the old detector (the default `yunet` finds tilted, dim and distant faces much better) |
| `python tools/list_cameras.py` | List camera indexes (when the capture adapter arrives) |

Timings live in `config.yaml` under `face:` (`min_face_seconds`, `min_gap_seconds`); camera settings under `camera:`. Press q or Esc in the preview window to hide it; Ctrl+C in the terminal stops everything and releases the camera.
