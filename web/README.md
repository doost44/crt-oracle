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
| Ctrl+M | Mute or unmute the sound |
| Alt+1, Alt+2, Alt+3 | Preview: hand the screen to Sugar, Weary or Clinical (Alt+0: back to the sun face) |
| F9 | Open the readout screen in a new window |

## Sound

`js/sound.js` synthesises every sound with Web Audio (no audio files): the CRT's
mains hum and flyback whine, a degauss thump on the boot screen, tape hiss in the
hallway, a tick per character the Oracle types, key clicks, and the thermal
printer when the receipt feeds. Browsers keep it silent until the first key
press or click. `?volume=0.5` sets the level (0 to 1), `?sound=0` starts muted.

## Exhibit mode

`?kiosk=1` hides the cursor, blocks right-click and text selection, and sends the
Oracle back to the boot screen after 90 seconds with no input (`?idle=60` to
change). The Windows launcher in `kiosk/` opens it fullscreen; see
`kiosk/README.md`.

A click or tap also starts the visit and skips the hallway.

## The look

A VHS-tinted CRT that is quietly watching: cobalt blue until someone picks, a red colour bleed,
scanlines, a blinking REC and a camcorder date stamp. The hallway drifts down a
corridor that bends, bulges and sags, its rows wobbling like bad tracking while
static creeps in from the edges. The painted sun face greets the visitor; once a
symbol is picked, that personality's own face takes the centre and the whole
screen re-tints:

| Personality | Face | Tint |
| --- | --- | --- |
| (nobody yet) | the painted sun | cobalt blue, white characters |
| Sugar | the sun: beaming, blushing, rays | warm amber |
| Weary | the rock: lumpy, cracked, heavy lids | washed-out green |
| Clinical | the tree: ringed eyes with scanning crosshairs | cold blue-white |

The palettes are in `js/theme.js`; the faces in `js/personas.js` are 2D
placeholders until the 3D models.

## Files

```
web/
  index.html        the page: loads data, then the scripts in order
  css/oracle.css    colour variables, CRT glow and bleed, the REC and date stamp, layout
  css/terminal.css  the conversation panel and the receipt
  data/content.js   GENERATED by tools/export_web.py from content/ (don't edit)
  data/face.js      GENERATED from assets/oracle-face/ (don't edit)
  js/sound.js       hum, clicks and printer, synthesised with Web Audio
  js/theme.js       the palette per personality, and the flickery switch between them
  js/grid.js        the character screen: one canvas, a grid of cells
  js/hallway.js     the ASCII hallway drift, and the VHS wobble and edge static
  js/face.js        the painted sun face, lit from the height and sculpt maps
  js/personas.js    Sugar, Weary and Clinical's faces (2D placeholders)
  js/story.js       the story engine (same rules as oracle/story.py)
  js/terminal.js    typewriter text, menus, input, the receipt
  js/main.js        the flow of one visit: boot, hallway, face, receipt
  js/kiosk.js       exhibit mode (?kiosk=1): no cursor, idle reset
  tests/e2e.js      browser test (Playwright): node web/tests/e2e.js
  tests/story.test.js  story engine test: node web/tests/story.test.js
  tests/kiosk.test.js  exhibit mode and sound (Playwright): node web/tests/kiosk.test.js
  js/ascii3d.js     3D to ASCII: off-screen render, brightness, Bayer-dithered glyphs
  js/figures.js     the sun, rock and tree models, colours, lean and switching
  figures.html      demo page for the 3D personalities
  vendor/three.min.js  three.js r149 (MIT, see vendor/three.LICENSE.txt)
  tests/ascii3d.test.js  glyph/dither test: node web/tests/ascii3d.test.js
  tests/figures.e2e.js   3D figures browser test (Playwright)
  js/live.js        the live conversation (only with python -m oracle.server)
  data/live.js      stub; the server replaces it to switch the live conversation on
  operator.html     the hidden operator panel (js/operator.js, css/operator.css)
  tests/live_e2e.js    live conversation in mock mode, with the operator panel
  js/camera.js      picks the real camera by name (skips NVIDIA Broadcast)
  js/vision.js      loads the face tracker (web/vendor/ or a CDN)
  js/face-reading.js  landmarks -> position, turn, nod, eyes, mood, labels
  js/presence.js    always-on camera + tracker, shared between the two screens
  js/watching.js    the REC mark; tells the readout what the Oracle is doing
  readout.html      the second monitor
  js/readout.js     draws the readout
  vendor/mediapipe/ the face tracker (tools/fetch_vision.py; not in git)
  tests/presence.test.js  camera picker and face reading: node web/tests/presence.test.js
  tests/readout.e2e.js    camera + readout in Chromium: node web/tests/readout.e2e.js [face.jpg]
```

`readout.e2e.js` gives Chromium a fake camera showing the picture you pass (any
photo of a face) and checks the tracker finds it on both screens. Without a
picture it shows a test card and checks the readout says NO SUBJECT.

`node web/tests/e2e.js` plays one whole visit in headless Chromium and saves
screenshots (to `$env:E2E_SCREENSHOTS`, or a temp folder). It needs Playwright
(`npm install playwright` and `npx playwright install chromium`).

## 3D personalities (demo: `figures.html`)

Sugar, Weary and Clinical as turning 3D figures drawn in ASCII: the sun, the rock
and the tree. Open http://localhost:8000/figures.html with the server above (the
page loads three.js from `web/vendor/`, so it works offline; double-clicking it
works too).

| Key | What it does |
| --- | --- |
| 1, 2, 3 | Sugar (sun, amber), Weary (rock, green), Clinical (tree, blue-white) |
| T | Talking on/off (the mouth moves) |
| C | Cycle through the three every 7 seconds |
| Mouse | Stands in for the participant's face: the figure leans toward it |

URL options: `?p=weary` starts on a personality, `?talk=1` starts talking,
`?cycle=1` starts cycling, `?rows=40` sets how many rows of text tall it is
(fewer rows = chunkier glyphs), `?still=3` freezes the clock at 3 s.

How it works, the same way as the chair on the CharlieCilla home page:

1. Each figure is built in code from three.js shapes (`js/figures.js`). The faces
   are tubes pressed onto the surface, in pure black.
2. The scene is rendered off-screen at one pixel per character cell (2 x 2 pixels
   per cell, averaged).
3. Each cell's brightness picks a glyph from ` .:-=+*#%@`, with a 4 x 4 Bayer
   pattern deciding between two neighbouring glyphs, so shading comes out as an
   even texture instead of bands (`js/ascii3d.js`). Pure black cells are left
   blank, so the eyes and mouths are cut out of the figure.
4. Dense glyphs get the personality's bright colour, middling ones its mid
   colour, light ones its dim colour (`PERSONALITIES` in `js/figures.js`).

Using it from the game: `Oracle.scenes.figure.frame(grid, t, opts)` takes the
same options as the current face scene (`region`, `personality`, `mood`,
`reveal`) plus `look`, so swapping it into `js/main.js` is one line (and adding
the three script tags to `index.html`). For the webcam, call
`Oracle.scenes.figure.figures.setLook({ x, y })` with the participant's face
centre in -1..1 (x to the right as the oracle sees it, y up), or `setLook(null)`
when nobody is there.

Tests: `node web/tests/ascii3d.test.js` (the glyph and dithering maths, no
browser) and `node web/tests/figures.e2e.js` (draws all three in headless
Chromium and checks faces, colours, switching, lean and talking).

## Later stages

- **Live Claude conversation (draft).** `python -m oracle.server` serves this
  page with an open conversation instead of the scripted story: Claude (or an
  offline mock) plays the Oracle, switches masks, and writes the receipt. The API
  key stays in that server, never in `web/`. See
  [docs/LIVE_ORACLE.md](../docs/LIVE_ORACLE.md).
- **Physical actions.** The Oracle asks the participant to look left, close their
  eyes or come closer, and checks with `Oracle.presence`.
