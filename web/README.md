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

### Clean demo (`clean.html`)

The same visit in a plain terminal look: white background and blue text for the
boot screen and all three personalities, heavier type, no glow, colour bleed or
vignette, and only a hint of scanlines. The static and tracking wobble are gone
from the face scene (and cut to a quarter in the hallway), and the 3D figures are
drawn smaller, fully on screen and centred above the terminal. Open
`clean.html` instead of `index.html`; the controls are the same. It is switched
on by `window.ORACLE_LOOK = "clean"` before the scripts load, plus `css/clean.css`.

### Glitch look (`talk-glitch.html`, `readout-glitch.html`, `glitch.html`)

A third look: an old computer on a hazy CRT, slowly falling apart. The
white-and-blue clean pages stay as they are; these sit beside them.

It starts as white phosphor on black under curved, scanlined glass, with a soft
bloom, the colours a little apart and a faint streak of snow. Then it decays.
Rows smear sideways from one stuck pixel, and columns drip down the screen.
Blocks of the last picture stick and slide (the datamosh look), and blocks die
into bands of flat colour. Near the end the picture loses its vertical hold and
rolls. The colours it breaks into follow the mask speaking (pinks and ambers for
Sugar, purples and mustard for Weary, blues and greens for Clinical). The page
text wavers and splits along with it.

- **How fast:** it creeps up on its own (about half broken after three
  minutes), every answer on the spoken Oracle wears it down further, and when the
  Oracle is done with you it gives out completely. A new visit brings the screen
  back clean, with a degauss wobble. A mask switch or a command jolts it.
- `talk-glitch.html` is the spoken Oracle. Its start screen is a boot prompt with
  the machine's memory scrolling past. **Second screen** opens
  `readout-glitch.html`, which falls apart in step with it.
- `glitch.html` is the typed visit (like `clean.html`); F9 opens
  `readout-glitch.html`.
- **Preview the decay:** `?decay=0.8` starts that broken, and **Alt+D** steps it
  up by a fifth (from fully broken, back to fresh).

The effect is `js/signal.js`, run on each page's canvas after it has drawn, plus
an SVG filter and `css/glitch.css` for the text and the glass. For the ghosts and
stuck blocks it keeps the last picture shown in memory for one frame (on the
camera screen, the live picture); nothing is saved or sent. Test:
`LOOK=glitch node web/tests/talk_readout.e2e.js face.jpg`.

### Drawing look (`talk-plan.html`, `readout-plan.html`)

The glitch look's failing machine on the clean look's white paper and blue ink,
with the menu centred. Behind everything, technical drawings in coloured inks
(dash-dot grids, double-walled rooms, fat translucent pipe runs, labels) are
stacked floor on floor like an exploded axonometric and turn slowly. As it decays
the floors pull apart and slip out of register, more of them arrive, red frames
rise off the top, and handwritten notes in clouds pile up on the glass. The
decay itself works the other way round on white: ink trails instead of ghosts,
ink bleed instead of bloom, and the white tinting blue. Things die into the
drawings' inks. The camera screen prints the picture in blue ink over a fainter
copy of the drawings.

The drawings are made up when the page loads (`js/plans.js`); `css/plan.css`
does the paper. `?decay=` and Alt+D work as in the glitch look. Test:
`LOOK=plan node web/tests/talk_readout.e2e.js face.jpg`.

### Console look (`talk-console.html`, `readout-console.html`)

An old computer's plain console text, blue on a white tube: everything in one
small blocky font (VT323, from Google Fonts; without it the system's monospace),
uppercase, a little out of register like a real CRT. The start screen is a menu
like a VCR's on-screen one: `--------- MENU ---------`, a highlighted line you
move with the arrow keys (or the pointer), and Enter (or the right arrow) to pick.

Through it shows a strange digital space, made only of tiny characters: patches
of odd glyphs, runs of words and hex, box-drawn tables, hatching, flat blocks of
blue and highlighter lime, bars, shards, streaks running down, rows torn
sideways, most of them mirrored across the middle of the screen. The title is
drawn the same way, in dense tiny glyphs. Each patch lives a few seconds and is
replaced, so the screen drifts by itself, over about a minute and a half, from
nearly clean to nearly gone and back. Letters of the menu turn into odd ones now
and then, more the worse it gets.

- **How broken:** the drift is always there. Every answer wears it down further
  (its calm moments stop being calm), and when the Oracle is done with you it
  stays near the worst. A new visit starts clean. A mask switch or a command
  jolts it. The field leaves the answer box and buttons alone.
- **The camera screen** draws the camera picture in tiny glyphs too, levelled on
  the face so the eyes and mouth come through, with the same field over it.
- `?decay=` and Alt+D work as in the glitch look.

The field is `js/console.js` (a canvas over the page, redrawn about 15 times a
second from random characters; nothing is kept), and it takes the place of
`js/signal.js` on these pages with the same calls; the menu's keys are
`js/menu.js`. `css/console.css` does the text and the glass. Test: `LOOK=console node web/tests/talk_readout.e2e.js face.jpg`.

### Text-mode look (`talk-text.html`, `readout-text.html`)

Just a console, like an old home computer's or a crash screen: pale blue letters
on a blue screen, in one square blocky font (Press Start 2P, from Google Fonts;
without it the system's monospace) at one small size for everything, set on
whole lines under curved, scanlined glass. The start screen is a boot screen
(`**** THE ORACLE BASIC V2 ****`, `READY.`, a blinking cursor) with the same
VCR-style menu as the console look, worked with the arrow keys and Enter. The
figure is drawn in the same characters at the same size as the text, and the
conversation runs underneath it as console lines (`SUGAR: ...`, `YOU: ...`, the
Oracle's notes as `REM`). Nothing falls apart in this one. The camera screen is
the same console, with the camera picture drawn in its characters.

`css/text.css` does the page; grid.js and readout.js switch font and colours on
`window.ORACLE_LOOK = "text"`. Test: `LOOK=text node web/tests/talk_readout.e2e.js face.jpg`.

## Voice answers and physical actions

Switched on from the address bar, so the plain visit stays exactly as it was:

| Address | What it does |
| --- | --- |
| `index.html?voice=1` | Answer by speaking. Words appear in the answer line as they're heard; the answer goes in when you stop talking. Menus take "the rock", "two" or "the last one". Typing still works and takes over. |
| `index.html?speak=1` | The Oracle reads its lines aloud, in a different voice per personality. |
| `index.html?actions=1` | Before every second question the Oracle asks for a physical action (look left, close your eyes, come closer, hold still...) and watches the webcam to check. |
| `?actions=look_left,close_eyes` | Only ask for these. `?every=1` asks before every question. `?camera=Logitech` picks the camera whose name contains that. |

Everything together: http://localhost:8000/?voice=1&speak=1&actions=1

On the main page the actions use the always-on camera (`js/presence.js`), so
the webcam is only opened once; `facetrack.js` opens its own camera only when
that one isn't running (on the lab page). `?camera=off` switches the camera,
and so the actions, off.

**Try each part on its own first** at http://localhost:8000/lab.html: a camera
view with the face landmarks and live readings, a button per action, a listen
button and the three voices.

Needs Chrome or Edge, and the page served (`py -m http.server 8000 -d web`): the
camera and microphone don't work from a double-clicked file. The browser asks
for the camera and microphone once.

**Offline at the exhibit.** The face model loads from the internet unless it's
in `web/vendor/`. Download it once (about 13 MB, not committed; the same download
the webcam and readout use):

```powershell
.\.venv\Scripts\python.exe tools\fetch_vision.py
```

Speech recognition runs on the laptop itself in newer Chrome versions when the
language pack is installed; otherwise Chrome sends the audio to Google to
transcribe. The lab page says which one it used.

**Privacy.** No frame or sound is recorded, saved or sent by this code. Camera
frames only exist in the `<video>` element and in the face model for one
detection; the actions keep a handful of numbers (head turn, eye openness, face
size) for a few seconds. The camera light goes off when the visit ends.

Tests: `node web/tests/senses.test.js` (the action checks and voice matching,
with fake faces) and `node web/tests/senses.e2e.js` (a whole visit answered by
"voice" with a stand-in microphone; set `FACE_VIDEO` to a `.y4m` video of a face
to run the real face model on it).

## Spoken Oracle (`talk.html`)

A conversation with no typing: you talk, Claude answers as the Oracle, and the
Oracle says each line out loud. Claude picks the mask every turn (Sugar when you
open up, Weary when you deflect, Clinical when you push back), and the figure, the
mask row and the voice all change with it. Each mask gets its own system voice
where the computer has enough of them, on top of voice.js's pitch and rate.

- The prompt is the live Oracle's own (`content/oracle/`), exported to
  `web/data/oracle_prompt.js` by `tools/export_web.py`, plus a short note that the
  conversation is spoken and there is no camera.
- Claude is reached through the claude.ai artifact runtime, so the page works as a
  published claude.ai artifact (the viewer allows it once; it uses their account).
  Opened anywhere else, a small canned Oracle answers so the flow can be tried.
- Listening is the browser's speech recognition (Chrome, Edge, Safari). Where the
  microphone isn't allowed, a text box takes the answers instead. The camera is
  never used, and nothing is recorded or saved.

**Second monitor.** The readout screen (`readout.html`, below) is the spoken
Oracle's eye. Open it with **Second screen** on the talk page (or in another
window of the same browser) and drag it to the other monitor. Once its camera is
live:

- it shows who is speaking, what the visitor just said, and Claude's private note
  on each turn ("Weary: one-word answers, going through the motions") in its
  ANALYSIS log;
- the Oracle can give physical commands. Claude may set a `command` (look left,
  close your eyes, hold still, smile...) at most once every three turns and says
  it out loud; the instruction appears over the picture with a progress bar, the
  face landmarks check it (`js/actions.js`), and COMPLIED or FAILED goes back to
  the Oracle, which reacts before the conversation carries on.

Without the readout (or without a camera) the Oracle gives no commands. Only words
and measurements pass between the two windows, never pictures.

Tests: `node web/tests/talk.e2e.js` (Claude and the voices stubbed, answers typed)
and `node web/tests/talk_readout.e2e.js face.jpg` (both screens, a fake camera
showing the photo, a scripted "hold still" command checked by the tracker).

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
  js/signal.js      the glitch look's failing screen: haze, smears, drips, stuck blocks, roll
  js/plans.js       the drawing look's turning stack of technical drawings
  js/console.js     the console look's drifting field of tiny glyphs
  js/menu.js        the console and text-mode looks' VCR-style start menu (arrow keys)
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
  js/actions.js     physical actions: face landmarks in, "did they do it?" out (no DOM)
  js/voice.js       speech-to-text and the Oracle's spoken voice
  js/facetrack.js   webcam + MediaPipe FaceLandmarker, feeding actions.js
  js/senses.js      plugs voice and actions into the terminal and the visit
  css/senses.css    the listening and action lines in the terminal
  lab.html          test bench for voice and actions
  tests/senses.test.js action checks and voice matching: node web/tests/senses.test.js
  tests/senses.e2e.js  a visit by voice with actions, in Chromium
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

In the game: once a personality takes over, its 3D figure fills the centre of
the screen (`Oracle.scenes.figure` in `js/main.js`), with its glyphs in the
theme's colours. It turns toward the participant's face from the webcam; with
no face in view it follows the mouse while the mouse moves (handy on a laptop),
and otherwise looks around the room by itself. Alt+1, Alt+2 and Alt+3 show each
one. A browser without WebGL gets the flat faces from `js/personas.js` instead.

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
