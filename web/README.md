# CRT Oracle: web version

The Oracle as a static browser game: plain HTML, CSS and JavaScript, no build step.
Live at **https://doost44.github.io/crt-oracle/** once it is published (see below).

## Run it locally (Windows PowerShell)

From the repo root:

```powershell
py -m http.server 8000 -d web
```

Then open http://localhost:8000. Press Ctrl+C in PowerShell to stop the server.

Double-clicking `web\index.html` works too: the story and the face are loaded as
plain `<script>` files (`web/data/*.js`), not fetched, so the browser doesn't
need a server.

## After editing the writing

The story, personalities and art live in `content/` (the same files the Python
version uses). The web page reads a copy in `web/data/`, so after editing
anything in `content/` or `assets/oracle-face/`, re-export:

```powershell
.\.venv\Scripts\python.exe tools\export_web.py
```

Commit the changed `web/data/` files with your edit. The tests
(`.\.venv\Scripts\python.exe -m pytest`) and the GitHub deploy both fail if you
forget. The face export needs OpenCV: `pip install -e ".[dev,camera]"`.

## Publish on GitHub Pages

1. On GitHub, open the repo: **Settings > Pages**. Under **Build and deployment**,
   set **Source** to **GitHub Actions**. (Once only.)
2. Merge the web version into `main` (or push to `main`).
3. Open the **Actions** tab and watch **Web version (GitHub Pages)**. It runs the
   tests first, then deploys. You can also start it by hand there with
   **Run workflow**.
4. When it is green, the game is at https://doost44.github.io/crt-oracle/.

The workflow is `.github/workflows/pages.yml`. It publishes the `web/` folder as
it is.

## The camera and the readout screen

The camera turns on as soon as the page opens and stays on for the whole visit.
A face tracker (MediaPipe Face Landmarker) runs in the browser on every frame and
a red **REC** mark in the corner of the Oracle's screen lights up while a face is
in view. Nothing is recorded, stored or sent anywhere: each frame is measured and
thrown away, and the readout is theatre that never identifies anyone.

**Second monitor.** `readout.html` shows the participant's live face under
made-up surveillance readouts: a VHS-tinted picture with a date stamp, head and
face boxes, eye markers, landmark dots and a triangulated mesh, numbered blocks
torn off the picture, "match" slots that never match, and analysis labels that
change with the face's expression. The colours follow whichever personality is
speaking.

1. Once, on the exhibit laptop, fetch the face tracker so it works offline
   (about 13 MB, into `web/vendor/`, which git ignores):

   ```powershell
   .\.venv\Scripts\python.exe tools\fetch_vision.py
   ```

   Without it the page loads the tracker from a CDN, which needs the internet.
2. Run the local server as above (the camera needs `http://localhost`, not a
   double-clicked file) and open http://localhost:8000.
3. Press **F9** on the Oracle's screen to open the readout in a new window. Drag
   it to the second monitor and press **F** (or double-click) for fullscreen.
   Both screens must be in the same Chrome window set, so the readout can hear
   the Oracle. If the Oracle's screen is closed, the readout tracks by itself.

**Picking the camera.** The Oracle never takes the default camera, because on the
laptop that is NVIDIA Broadcast, a virtual camera that breaks face tracking. It
skips virtual cameras (NVIDIA Broadcast, OBS, Snap Camera and the like) and opens
the first real one. To choose:

- press **C** on the readout screen to step through the cameras (the name shows
  in the panel; the pick is remembered and the Oracle's screen follows), or
- add `?camera=` and part of the name to the address, for example
  `http://localhost:8000/?camera=USB%20Video` for the capture adapter.
- `?camera=off` runs the Oracle with no camera.

Chrome asks for camera permission the first time; tick "Allow" and it stays
allowed for localhost. Other code can read the face too: `Oracle.presence.current`
(position, turn, nod, eyes shut, expression scores) and
`Oracle.presence.subscribe(fn)`.

Readout keys: **C** next camera, **F** fullscreen, **M** mirror the picture,
**H** hide the key line.

## Controls

| Key | What it does |
| --- | --- |
| Enter | Start from the boot screen; skip the hallway; continue; submit an answer |
| Typing | Answer the Oracle's questions in the terminal |
| 1, 2, 3 | Pick a symbol (sun, rock, tree) or another numbered option |
| Enter (repeatedly) | When the Oracle asks you to press Enter N times |
| Print / Save | On the receipt: print it (narrow receipt layout) or save it |
| Again | On the receipt: back to the boot screen for the next visitor |
| F9 | Open the readout screen in a new window |

A click or tap also starts the visit and skips the hallway.

## Files

```
web/
  index.html        the page: loads data, then the scripts in order
  css/oracle.css    palette, CRT glow, layout
  css/terminal.css  the conversation panel and the receipt
  data/content.js   GENERATED by tools/export_web.py from content/ (don't edit)
  data/face.js      GENERATED from assets/oracle-face/ (don't edit)
  js/grid.js        the character screen: one canvas, a grid of cells
  js/hallway.js     the ASCII hallway drift
  js/face.js        the Oracle's face, lit from the height and sculpt maps
  js/story.js       the story engine (same rules as oracle/story.py)
  js/terminal.js    typewriter text, menus, input, the receipt
  js/main.js        the flow of one visit: boot, hallway, face, receipt
  js/camera.js      picks the real camera by name (skips NVIDIA Broadcast)
  js/vision.js      loads the face tracker (web/vendor/ or a CDN)
  js/face-reading.js  landmarks -> position, turn, nod, eyes, mood, labels
  js/presence.js    always-on camera + tracker, shared between the two screens
  js/watching.js    the REC mark; tells the readout what the Oracle is doing
  readout.html      the second monitor
  js/readout.js     draws the readout
  vendor/mediapipe/ the face tracker (tools/fetch_vision.py; not in git)
  tests/e2e.js      browser test (Playwright): node web/tests/e2e.js
  tests/story.test.js  story engine test: node web/tests/story.test.js
  tests/presence.test.js  camera picker and face reading: node web/tests/presence.test.js
  tests/readout.e2e.js    camera + readout in Chromium: node web/tests/readout.e2e.js [face.jpg]
```

`readout.e2e.js` gives Chromium a fake camera showing the picture you pass (any
photo of a face) and checks the tracker finds it on both screens. Without a
picture it shows a test card and checks the readout says NO SUBJECT.

`node web/tests/e2e.js` plays one whole visit in headless Chromium and saves
screenshots (to `$env:E2E_SCREENSHOTS`, or a temp folder). It needs Playwright
(`npm install playwright` and `npx playwright install chromium`).

## Later stages

- **Live Claude replies.** The Oracle will answer in character through a small
  serverless proxy (for example a Cloudflare Worker) that holds the API key, with
  rate limits, a token cap and an origin check. Never put an API key in client
  code: anything in `web/` is public. The scripted replies stay as the fallback.
- **Physical actions.** The Oracle asks the participant to look left, close their
  eyes or come closer, and checks with `Oracle.presence`.
